/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Host-Prüfung gegen DNS-Rebinding.
 * Abnahmetests REQ-SRV-7 (Entscheidung 9).
 *
 * Wirkungsnachweis über echte HTTP-Anfragen an den echten Server (Schnittstelle startServer wie in
 * api.test.ts beschrieben) mit frei gesetzter `Host`-Kopfzeile bzw. ganz ohne sie (rohe
 * HTTP/1.0- und HTTP/1.1-Anfrage über einen Socket). Jede Ablehnung hat eine Gegenprobe mit
 * erlaubtem Host; sonst bewiese die Ablehnung nichts. Die Wirkung auf die Datenbank wird über die
 * API (erlaubter Host) und über die Zeilen der Datei geprüft.
 *
 * Die Spec rechnet ihr Beispiel mit P = 8080; hier ist P ein freier Port, `rezepte.local` ohne Port
 * meint also `rezepte.local:P`, und „fremder Port“ ist ein anderer als P.
 *
 * Kanarienvögel (REQ-SARCH-2): „Host-Prüfung entfernt“ töten alle 421-Tests; „Port beim
 * Host-Vergleich ignoriert“ töten die Fälle `localhost`, `rezepte.local` (Port 80),
 * `192.168.178.113:<anderer Port>` und `localhost:<P+1>`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------------------------
// Testgerüst (in jeder Server-Testdatei eigenständig, damit keine Hilfsdatei unter src/server
// mutiert oder von implement geändert wird)
// ---------------------------------------------------------------------------------------------

type Env = Readonly<Record<string, string | undefined>>;
type Output = { readonly stdout: (line: string) => void; readonly stderr: (line: string) => void };
type RunningServer = { readonly close: () => Promise<void> };
type ServerApi = { readonly startServer: (env: Env, output: Output) => Promise<RunningServer> };

const SERVER_MODULE = "./server.js";
const loadServer = async (): Promise<ServerApi> =>
  (await import(/* @vite-ignore */ new URL(SERVER_MODULE, import.meta.url).href)) as ServerApi;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      s.close(() => resolve(port));
    });
  });

type Reply = {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
  readonly json: () => unknown;
};

type CallOptions = {
  readonly host?: string | null; // null: keine Host-Kopfzeile
  readonly body?: unknown; // Objekt → JSON; string/Buffer → roh
  readonly contentType?: string | null; // null: keine Content-Type-Kopfzeile
  readonly headers?: Readonly<Record<string, string>>;
  readonly address?: string;
};

const call = (
  port: number,
  method: string,
  path: string,
  o: CallOptions = {},
  shared?: http.Agent,
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const raw =
      o.body === undefined
        ? undefined
        : typeof o.body === "string" || Buffer.isBuffer(o.body)
          ? Buffer.from(o.body)
          : Buffer.from(JSON.stringify(o.body));
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.host !== null) headers.host = o.host ?? `localhost:${port}`;
    if (raw !== undefined) {
      headers["content-length"] = String(raw.length);
      if (o.contentType !== null) headers["content-type"] = o.contentType ?? "application/json";
    }
    let answered = false;
    // Keep-Alive: der Server schließt die Verbindung nicht direkt nach einer frühen Antwort
    // (413, 421) auf einen noch laufenden Körper; sonst verlöre der Client die Antwort durch ein
    // TCP-Reset. Der Harness reicht je Server einen gemeinsamen Agenten herein (Verbindungen
    // werden wiederverwendet, sonst gehen bei vielen Läufen, etwa unter Stryker, die lokalen Ports
    // aus); ohne ihn eine eigene Verbindung je Anfrage.
    const agent = shared ?? new http.Agent({ keepAlive: true, maxSockets: 1 });
    const done = (): void => {
      if (shared === undefined) agent.destroy();
    };
    const req = http.request(
      {
        host: o.address ?? "127.0.0.1",
        port,
        method,
        path,
        headers,
        setHost: false,
        agent,
      },
      (res) => {
        answered = true;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          done();
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on("error", (e) => {
      done();
      if (!answered) reject(e);
    });
    if (raw !== undefined) req.write(raw);
    req.end();
  });

const enc = encodeURIComponent;

/**
 * Rohe Teilanfrage senden und nur auf die Statuszeile warten (Testnachtrag 2). Liefert den
 * Statuscode oder „zeitueberschreitung“, wenn binnen `ms` keine Antwort kommt.
 */
const firstStatus = (
  port: number,
  text: string,
  ms: number,
): Promise<number | "zeitueberschreitung"> =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let buf = "";
    const done = (v: number | "zeitueberschreitung") => {
      clearTimeout(timer);
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => done("zeitueberschreitung"), ms);
    socket.on("error", () => {});
    socket.on("data", (c: Buffer) => {
      buf += c.toString("latin1");
      const end = buf.indexOf("\r\n");
      if (end >= 0) done(Number(buf.slice(0, end).split(" ")[1]));
    });
    socket.once("connect", () => socket.write(text));
  });

type Harness = {
  readonly port: number;
  readonly dir: string;
  readonly dbPath: string;
  readonly staticDir: string;
  readonly out: string[];
  readonly err: string[];
  readonly call: (method: string, path: string, o?: CallOptions) => Promise<Reply>;
  readonly stop: () => Promise<void>;
  readonly restart: () => Promise<void>;
};

const INDEX_MARKER = "Carrera-Startseite-7f3a";
const harnesses: Harness[] = [];
const tmpDirs: string[] = [];

const startHarness = async (extraEnv: Env = {}): Promise<Harness> => {
  const api = await loadServer();
  const dir = mkdtempSync(join(tmpdir(), "carrera-m3b-"));
  tmpDirs.push(dir);
  const staticDir = join(dir, "static");
  mkdirSync(staticDir);
  writeFileSync(
    join(staticDir, "index.html"),
    `<!doctype html><html><head><title>${INDEX_MARKER}</title></head><body></body></html>`,
  );
  const dbPath = join(dir, "db", "carrera.sqlite");
  const port = await freePort();
  const out: string[] = [];
  const err: string[] = [];
  const env: Env = {
    CARRERA_HOST: "127.0.0.1",
    CARRERA_PORT: String(port),
    CARRERA_DB: dbPath,
    CARRERA_STATIC: staticDir,
    ...extraEnv,
  };
  const bound = env.CARRERA_HOST;
  const bindAddress =
    bound === undefined || bound === "0.0.0.0" || bound === "::" ? "127.0.0.1" : bound;
  const output: Output = { stdout: (l) => out.push(l), stderr: (l) => err.push(l) };
  let running: RunningServer | undefined = await api.startServer(env, output);
  let agent = new http.Agent({ keepAlive: true });
  const h: Harness = {
    port,
    dir,
    dbPath,
    staticDir,
    out,
    err,
    call: (method, path, o) => call(port, method, path, { address: bindAddress, ...o }, agent),
    stop: async () => {
      const r = running;
      running = undefined;
      agent.destroy();
      agent = new http.Agent({ keepAlive: true });
      if (r !== undefined) await r.close();
    },
    restart: async () => {
      await h.stop();
      running = await api.startServer(env, output);
    },
  };
  harnesses.push(h);
  return h;
};

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.stop();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// better-sqlite3 kommt transitiv mit @effect/sql-sqlite-node (keine eigene Abhängigkeit).
type Row = Record<string, unknown>;
type Statement = {
  readonly all: (...p: unknown[]) => Row[];
  readonly run: (...p: unknown[]) => unknown;
};
type Database = { readonly prepare: (sql: string) => Statement; readonly close: () => void };
type DatabaseCtor = new (
  path: string,
  options?: { readonly readonly?: boolean; readonly fileMustExist?: boolean },
) => Database;
const requireHere = createRequire(import.meta.url);
const BetterSqlite = createRequire(requireHere.resolve("@effect/sql-sqlite-node"))(
  "better-sqlite3",
) as DatabaseCtor;

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Tabellen mit Nutzdaten: ohne SQLite-interne und ohne Migrations-Buchführung. */
const userTables = (db: Database): string[] =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => String(r.name))
    .filter((n) => !/migration/i.test(n));

type TableRow = { readonly table: string; readonly row: Row };
const allRows = (dbPath: string): TableRow[] => {
  const db = new BetterSqlite(dbPath, { readonly: true, fileMustExist: true });
  try {
    return userTables(db).flatMap((t) =>
      db
        .prepare(`SELECT * FROM ${quoteIdent(t)}`)
        .all()
        .map((row) => ({ table: t, row })),
    );
  } finally {
    db.close();
  }
};

/** Rohzustand aller Nutzzeilen, sortiert, als Vergleichswert für „Datenbank unverändert“. */
const rawSnapshot = (dbPath: string): string[] =>
  allRows(dbPath)
    .map((r) => JSON.stringify([r.table, Object.entries(r.row).sort()]))
    .sort();

/** Zustand über die API (erlaubter Host): Liste, jeder Stand, Bestand. */
const apiSnapshot = async (h: Harness): Promise<unknown> => {
  const list = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
  const states: unknown[] = [];
  for (const s of list) states.push((await h.call("GET", `/api/layouts/${enc(s.name)}`)).json());
  const bestand = (await h.call("GET", "/api/bestand")).json();
  return { list, states, bestand };
};

/** Rohe Anfrage über einen Socket, z. B. ganz ohne Host-Kopfzeile. Liefert Status und Körper. */
const rawRequest = (port: number, request: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("error", reject);
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const [head = "", ...rest] = text.split("\r\n\r\n");
      const status = Number(head.split(" ")[1]);
      resolve({ status, body: rest.join("\r\n\r\n") });
    });
    socket.write(request);
  });

/** JSON-Objekt aus einem rohen Körper (verträgt chunked Transfer-Encoding). */
const jsonIn = (body: string): unknown => {
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
};

const OVAL = {
  schemaVersion: 1,
  elements: [
    { id: "o1", part: "kurve-1-90", turn: "links" },
    { id: "o2", part: "kurve-1-90", turn: "links" },
    { id: "o3", part: "gerade-342" },
    { id: "o4", part: "kurve-1-90", turn: "links" },
    { id: "o5", part: "kurve-1-90", turn: "links" },
    { id: "o6", part: "gerade-342" },
  ],
} as const;
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gibt-es-nicht": 3 } } as const;
const PART_NAMES = ["kurve-1-90", "gerade-342", "gibt-es-nicht"];

/** Datenbank wie im Wirkungsnachweis: Layout „Oval“ und Bestand, je Version 1. */
const prepared = async (extraEnv: Env = {}): Promise<Harness> => {
  const h = await startHarness(extraEnv);
  const a = await h.call("PUT", "/api/layouts/Oval", {
    body: { expectedVersion: 0, layout: OVAL },
  });
  expect(a.status).toBe(201);
  const b = await h.call("PUT", "/api/bestand", {
    body: { expectedVersion: 0, inventory: BESTAND },
  });
  expect(b.status).toBe(200);
  return h;
};

const expect421 = (r: Reply, host: string | null, label: string): void => {
  expect(r.status, label).toBe(421);
  expect(r.json(), label).toStrictEqual({ _tag: "FremderHost", host });
  expect(r.text, label).not.toContain("Oval");
  for (const p of PART_NAMES) expect(r.text, label).not.toContain(p);
  expect(r.text, label).not.toContain(INDEX_MARKER);
  expect(r.text.toLowerCase(), label).not.toContain("<html");
};

const ALLOWED_EXAMPLE = { CARRERA_ALLOWED_HOSTS: "rezepte.local,192.168.178.113" };

describe("Host-Prüfung", () => {
  test.skip("[REQ-SRV-7] fremder Host: GET auf Liste, Layout, Bestand und Startseite → 421 FremderHost, Körper ohne Oval, Teilenamen und index.html", async () => {
    const h = await prepared(ALLOWED_EXAMPLE);
    const foreign = `evil.example:${h.port}`;
    for (const path of [
      "/api/layouts",
      "/api/layouts/Oval",
      "/api/bestand",
      "/",
      "/index.html",
      "/api/status",
    ]) {
      expect421(await h.call("GET", path, { host: foreign }), foreign, `GET ${path}`);
    }
    // Gegenprobe: dieselben Anfragen mit erlaubtem Host liefern die Daten
    const list = await h.call("GET", "/api/layouts");
    expect(list.status).toBe(200);
    expect(list.text).toContain("Oval");
    const layout = await h.call("GET", "/api/layouts/Oval");
    expect(layout.status).toBe(200);
    expect(layout.text).toContain("kurve-1-90");
    const bestand = await h.call("GET", "/api/bestand");
    expect(bestand.status).toBe(200);
    expect(bestand.text).toContain("gibt-es-nicht");
    const index = await h.call("GET", "/");
    expect(index.status).toBe(200);
    expect(index.text).toContain(INDEX_MARKER);
  });

  test.skip("[REQ-SRV-7] fremder Host: PUT Layout, PUT Bestand und DELETE → 421, Datenbank danach genau wie vorher; Gegenprobe mit erlaubtem Host wirkt", async () => {
    const h = await prepared(ALLOWED_EXAMPLE);
    const foreign = `evil.example:${h.port}`;
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);
    const newLayout = { expectedVersion: 0, layout: OVAL };
    const newBestand = { expectedVersion: 1, inventory: { schemaVersion: 1, counts: {} } };
    expect421(
      await h.call("PUT", "/api/layouts/Neu", { host: foreign, body: newLayout }),
      foreign,
      "PUT Layout",
    );
    expect421(
      await h.call("PUT", "/api/bestand", { host: foreign, body: newBestand }),
      foreign,
      "PUT Bestand",
    );
    expect421(
      await h.call("DELETE", "/api/layouts/Oval?version=1", { host: foreign }),
      foreign,
      "DELETE",
    );
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);

    // Gegenprobe mit erlaubtem Host (aus der Erlaubtliste, nicht nur localhost)
    const allowed = `rezepte.local:${h.port}`;
    const put = await h.call("PUT", "/api/layouts/Neu", { host: allowed, body: newLayout });
    expect(put.status).toBe(201);
    const bestand = await h.call("PUT", "/api/bestand", { host: allowed, body: newBestand });
    expect(bestand.status).toBe(200);
    const del = await h.call("DELETE", "/api/layouts/Oval?version=1", { host: allowed });
    expect(del.status).toBe(204);
    const after = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
    expect(after.map((s) => s.name)).toEqual(["Neu"]);
    expect((await h.call("GET", "/api/bestand")).json()).toMatchObject({ version: 2 });
  });

  test.skip("[REQ-SRV-7] Beispiel: erlaubt rezepte.local:P, REZEPTE.local:P, 192.168.178.113:P, localhost:P, 127.0.0.1:P, [::1]:P", async () => {
    const h = await prepared(ALLOWED_EXAMPLE);
    const P = h.port;
    for (const host of [
      `rezepte.local:${P}`,
      `REZEPTE.local:${P}`,
      `REZEPTE.LOCAL:${P}`,
      `192.168.178.113:${P}`,
      `localhost:${P}`,
      `LocalHost:${P}`,
      `127.0.0.1:${P}`,
      `[::1]:${P}`,
    ]) {
      const r = await h.call("GET", "/api/layouts/Oval", { host });
      expect(r.status, host).toBe(200);
      expect((r.json() as { name: string }).name, host).toBe("Oval");
    }
  });

  test.skip("[REQ-SRV-7] Beispiel: abgelehnt rezepte.local (Port 80), evil.example:P, 192.168.178.113 mit fremdem Port, localhost ohne Port oder mit fremdem Port", async () => {
    const h = await prepared(ALLOWED_EXAMPLE);
    const P = h.port;
    const other = P === 9999 ? 9998 : 9999;
    for (const host of [
      "rezepte.local",
      "rezepte.local:80",
      `evil.example:${P}`,
      `192.168.178.113:${other}`,
      "192.168.178.113",
      "localhost",
      `localhost:${P + 1}`,
      "127.0.0.1",
      `127.0.0.1:${other}`,
      `[::1]:${other}`,
      `rezepte.local.evil.example:${P}`,
      `sub.rezepte.local:${P}`,
      `0.0.0.0:${P}`,
      "",
    ]) {
      expect421(await h.call("GET", "/api/layouts", { host }), host, JSON.stringify(host));
    }
    // Gegenprobe im selben Lauf
    expect((await h.call("GET", "/api/layouts", { host: `rezepte.local:${P}` })).status).toBe(200);
  });

  test.skip("[REQ-SRV-7] fehlende Host-Kopfzeile (HTTP/1.0 und HTTP/1.1) → 421 FremderHost mit host null", async () => {
    const h = await prepared(ALLOWED_EXAMPLE);
    for (const req of [
      "GET /api/status HTTP/1.0\r\n\r\n",
      "GET /api/layouts HTTP/1.0\r\n\r\n",
      "GET /api/layouts HTTP/1.1\r\nConnection: close\r\n\r\n",
      "GET / HTTP/1.0\r\n\r\n",
    ]) {
      const r = await rawRequest(h.port, req);
      expect(r.status, req).toBe(421);
      expect(jsonIn(r.body), req).toStrictEqual({ _tag: "FremderHost", host: null });
      expect(r.body, req).not.toContain("Oval");
      expect(r.body, req).not.toContain(INDEX_MARKER);
    }
    // Gegenprobe: dieselbe rohe Anfrage mit erlaubtem Host
    const ok = await rawRequest(
      h.port,
      `GET /api/layouts HTTP/1.0\r\nHost: localhost:${h.port}\r\n\r\n`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("Oval");
  });

  test.skip("[REQ-SRV-7] die Prüfung kommt vor Routing, Körperlesen und Dateisystem: unbekannte Route, zu großer Körper, falscher Content-Type, Pfad außerhalb → 421", async () => {
    const h = await prepared(ALLOWED_EXAMPLE);
    const foreign = `evil.example:${h.port}`;
    const big = Buffer.alloc(2 * 1024 * 1024, " ");
    const cases: ReadonlyArray<readonly [string, string, CallOptions]> = [
      ["GET", "/api/gibtsnicht", { host: foreign }],
      ["POST", "/api/layouts", { host: foreign, body: "{}" }],
      ["PUT", "/api/layouts/Oval", { host: foreign, body: big }],
      ["PUT", "/api/bestand", { host: foreign, body: "{}", contentType: "text/plain" }],
      [
        "PUT",
        "/api/layouts/%20Oval",
        { host: foreign, body: { expectedVersion: 0, layout: OVAL } },
      ],
      ["GET", "/../package.json", { host: foreign }],
      ["GET", "/gibt-es-nicht.js", { host: foreign }],
      ["OPTIONS", "/api/bestand", { host: foreign, headers: { origin: "http://fremd.example" } }],
    ];
    for (const [method, path, o] of cases) {
      expect421(await h.call(method, path, o), foreign, `${method} ${path}`);
    }
    // Gegenprobe: mit erlaubtem Host bekommen dieselben Anfragen ihre eigenen Antworten
    expect((await h.call("GET", "/api/gibtsnicht")).status).toBe(404);
    expect((await h.call("PUT", "/api/layouts/Oval", { body: big })).status).toBe(413);
    expect(
      (await h.call("PUT", "/api/bestand", { body: "{}", contentType: "text/plain" })).status,
    ).toBe(415);
    expect(
      (
        await h.call("PUT", "/api/layouts/%20Oval", {
          body: { expectedVersion: 0, layout: OVAL },
        })
      ).status,
    ).toBe(400);
  });

  test.skip("[REQ-SRV-7] Host-Angabe ohne Port meint Port 80: ein Eintrag mit :80 erlaubt sie, ein Eintrag mit P nicht", async () => {
    // Testnachtrag 2
    const h = await prepared({ CARRERA_ALLOWED_HOSTS: "pi.local:80" });
    const P = h.port;
    for (const host of ["pi.local", "PI.local", "pi.local:80"]) {
      expect((await h.call("GET", "/api/status", { host })).status, host).toBe(200);
    }
    expect421(await h.call("GET", "/api/status", { host: `pi.local:${P}` }), `pi.local:${P}`, "P");
    // Gegenprobe: ohne :80 in der Liste ist der Host ohne Port fremd
    expect421(await h.call("GET", "/api/status", { host: "localhost" }), "localhost", "localhost");
  });

  test.skip("[REQ-SRV-7] 421 kommt, ohne auf den Körper zu warten: Client kündigt 1000 Byte an und sendet nur 22", async () => {
    // Testnachtrag 2: die Prüfung steht vor dem Körperlesen; sonst hinge die Antwort.
    const h = await prepared(ALLOWED_EXAMPLE);
    const head = (host: string) =>
      `PUT /api/layouts/Neu HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"expectedVersion":0,"`;
    expect(await firstStatus(h.port, head(`evil.example:${h.port}`), 2_000)).toBe(421);
    // Gegenprobe: mit erlaubtem Host wartet der Server auf den Körper (keine Antwort binnen 500 ms)
    expect(await firstStatus(h.port, head(`localhost:${h.port}`), 500)).toBe("zeitueberschreitung");
  });

  test.skip("[REQ-SRV-7] Einträge mit Port gelten genau so, ohne Port mit P; Leerraum am Rand wird entfernt", async () => {
    const h = await prepared({ CARRERA_ALLOWED_HOSTS: "  pi.local:9000 , Tablet.Local  " });
    const P = h.port;
    expect((await h.call("GET", "/api/status", { host: "pi.local:9000" })).status).toBe(200);
    expect((await h.call("GET", "/api/status", { host: "PI.local:9000" })).status).toBe(200);
    expect((await h.call("GET", "/api/status", { host: `tablet.local:${P}` })).status).toBe(200);
    for (const host of [`pi.local:${P}`, "pi.local", "tablet.local:9000", "tablet.local"]) {
      expect421(await h.call("GET", "/api/status", { host }), host, host);
    }
  });

  test.skip("[REQ-SRV-7] ohne CARRERA_ALLOWED_HOSTS gilt nur die Vorgabe-Liste: localhost:P, 127.0.0.1:P, [::1]:P", async () => {
    const h = await prepared();
    const P = h.port;
    for (const host of [`localhost:${P}`, `127.0.0.1:${P}`, `[::1]:${P}`]) {
      expect((await h.call("GET", "/api/bestand", { host })).status, host).toBe(200);
    }
    for (const host of [
      `rezepte.local:${P}`,
      `192.168.178.113:${P}`,
      `evil.example:${P}`,
      `::1:${P}`,
    ]) {
      expect421(await h.call("GET", "/api/bestand", { host }), host, host);
    }
  });

  test.skip("[REQ-SRV-7] CARRERA_HOST 0.0.0.0 erweitert die Liste nicht: Host 0.0.0.0:P → 421", async () => {
    const h = await prepared({ CARRERA_HOST: "0.0.0.0" });
    const P = h.port;
    expect421(
      await h.call("GET", "/api/layouts", { host: `0.0.0.0:${P}` }),
      `0.0.0.0:${P}`,
      "0.0.0.0",
    );
    expect((await h.call("GET", "/api/layouts", { host: `localhost:${P}` })).status).toBe(200);
  });

  test.skip("[REQ-SRV-7] CARRERA_HOST mit bestimmter Adresse (LAN-IP des Rechners) erlaubt <Adresse>:P; ohne diese Einstellung 421", async () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === "IPv4" && !i.internal)?.address;
    expect(
      lan,
      "Testvoraussetzung: der Rechner hat eine IPv4-Adresse außer Loopback",
    ).toBeDefined();
    const ip = lan as string;

    const h = await prepared({ CARRERA_HOST: ip });
    const P = h.port;
    const r = await h.call("GET", "/api/layouts", { host: `${ip}:${P}`, address: ip });
    expect(r.status).toBe(200);
    expect(r.text).toContain("Oval");
    expect421(
      await h.call("GET", "/api/layouts", { host: `evil.example:${P}`, address: ip }),
      `evil.example:${P}`,
      "fremder Host an LAN-IP",
    );
    await h.stop();

    // Gegenprobe: an 127.0.0.1 gebunden ist <LAN-IP>:P nicht erlaubt
    const g = await prepared({ CARRERA_HOST: "127.0.0.1" });
    expect421(
      await g.call("GET", "/api/layouts", { host: `${ip}:${g.port}` }),
      `${ip}:${g.port}`,
      "LAN-IP ohne CARRERA_HOST",
    );
  });

  test.skip("[REQ-SRV-7] ungültiger Eintrag in CARRERA_ALLOWED_HOSTS bricht den Start mit Meldung ab; es lauscht nichts", async () => {
    const api = await loadServer();
    for (const value of [
      "a,,b",
      ",",
      "http://rezepte.local",
      "https://rezepte.local:8080",
      "rezepte.local/pfad",
      "rezepte.local:70000",
      "rezepte.local:0",
      "rezepte.local:65536",
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "carrera-m3b-host-"));
      tmpDirs.push(dir);
      const port = await freePort();
      const err: string[] = [];
      await expect(
        api.startServer(
          {
            CARRERA_HOST: "127.0.0.1",
            CARRERA_PORT: String(port),
            CARRERA_DB: join(dir, "db.sqlite"),
            CARRERA_STATIC: dir,
            CARRERA_ALLOWED_HOSTS: value,
          },
          { stdout: () => {}, stderr: (l) => err.push(l) },
        ),
        value,
      ).rejects.toBeDefined();
      expect(err.join("\n").trim().length, value).toBeGreaterThan(0);
      expect(err.join("\n"), value).toContain("CARRERA_ALLOWED_HOSTS");
      await expect(call(port, "GET", "/api/status"), value).rejects.toThrow();
    }
    // Gegenprobe: gültige Werte starten
    const ok = await startHarness({
      CARRERA_ALLOWED_HOSTS: "rezepte.local, 192.168.178.113:8080",
    });
    expect((await ok.call("GET", "/api/status")).status).toBe(200);
  });
});
