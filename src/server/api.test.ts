/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Endpunkte. Abnahmetests REQ-API-5 bis
 * REQ-API-13, REQ-API-16, REQ-API-17, REQ-SRV-3, REQ-SRV-4, REQ-DB-5 und REQ-SARCH-2.
 *
 * Prüfweg (REQ-SARCH-2): jeder Test startet den echten Server im Testprozess auf einem echten Port
 * mit einer SQLite-Datei in einem frischen tmp-Verzeichnis und spricht ihn über HTTP an
 * (`node:http`, damit die `Host`-Kopfzeile frei setzbar ist). Kein nachgebautes SQL im Server-Pfad;
 * die Datei wird nur für die Wirkungsnachweise (REQ-DB-5, „Datenbank unverändert“, REQ-SRV-4) mit
 * `better-sqlite3` direkt gelesen. Im Testprozess, damit Stryker die Mutanten in src/server sieht.
 *
 * Öffentliche API (von spec-to-tests gewählt; die Spec lässt die Einstiegsstelle offen):
 * - `src/server/server.ts` exportiert
 *     startServer(env, output): Promise<RunningServer>
 *   env: die Umgebungsvariablen (`CARRERA_HOST`, `CARRERA_PORT`, `CARRERA_DB`, `CARRERA_STATIC`,
 *   `CARRERA_ALLOWED_HOSTS`; fehlend = Vorgabe aus REQ-SRV-1). output: { stdout(line), stderr(line) },
 *   wohin der Server seine Zeilen schreibt. Das Promise erfüllt sich, wenn der Server lauscht und
 *   die Datenbank offen und migriert ist; scheitert der Start (REQ-SRV-1, REQ-SRV-7, REQ-DB-3),
 *   wird es verworfen, nachdem die Meldung auf output.stderr steht.
 *   RunningServer: { close(): Promise<void> } — hört auf zu lauschen und schließt die Datenbank.
 * - `src/server/main.ts` (übersetzt nach dist-server/server/main.js) ruft startServer mit
 *   process.env und process.stdout/stderr auf und behandelt SIGINT/SIGTERM (siehe process.test.ts).
 *
 * Kanarienvögel aus REQ-SARCH-2 und die Tests, die sie töten:
 * - Versionsvergleich entfernt, 409 durch 200 ersetzt: REQ-API-8, REQ-API-12 (hier), REQ-API-14/15.
 * - Version + 2 statt + 1: REQ-API-6, REQ-API-7, REQ-API-12.
 * - Schema-Prüfung beim Schreiben entfernt: REQ-API-13.
 * - Schema-Prüfung beim Lesen entfernt: REQ-DB-4 (storage.test.ts).
 * - DELETE ohne Versionsbedingung: REQ-API-10.
 * - Trimmen des Pfadnamens eingebaut: REQ-API-6 (`%20Oval` → 400).
 * - Host-Prüfung entfernt, Port beim Host-Vergleich ignoriert: REQ-SRV-7 (host.test.ts).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
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

const jsonOf = (v: unknown): unknown => {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
};
const deepEqual = (a: unknown, b: unknown): boolean => {
  try {
    expect(a).toStrictEqual(b);
    return true;
  } catch {
    return false;
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

const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------------------------
// Testdaten
// ---------------------------------------------------------------------------------------------

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
const ACHT = {
  schemaVersion: 1,
  elements: [
    { id: "e1", part: "kreuzung" },
    { id: "e2", part: "kurve-1-90", turn: "rechts" },
    { id: "e3", part: "kurve-1-90", turn: "rechts" },
    { id: "e4", part: "kurve-1-90", turn: "rechts" },
    { id: "e5", part: "gerade-114" },
    { id: "e6", crosses: "e1" },
    { id: "e7", part: "anschlussstueck" },
    { id: "e8", part: "kurve-1-90", turn: "links" },
    { id: "e9", part: "kurve-1-90", turn: "links" },
    { id: "e10", part: "kurve-1-90", turn: "links" },
  ],
} as const;
const EMPTY = { schemaVersion: 1, elements: [] } as const;
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gibt-es-nicht": 3 } } as const;

const putLayout = (h: Harness, name: string, expectedVersion: number, layout: unknown) =>
  h.call("PUT", `/api/layouts/${enc(name)}`, { body: { expectedVersion, layout } });

// ---------------------------------------------------------------------------------------------
// REQ-SRV-3 Status
// ---------------------------------------------------------------------------------------------

describe("Status", () => {
  test.skip("[REQ-SRV-3] GET /api/status antwortet 200 {status: ok} als JSON, sobald startServer erfüllt ist", async () => {
    const h = await startHarness();
    const r = await h.call("GET", "/api/status");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(r.json()).toStrictEqual({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-5 Liste
// ---------------------------------------------------------------------------------------------

describe("Layoutliste", () => {
  test.skip("[REQ-API-5] leere Datenbank: GET /api/layouts liefert 200 und []", async () => {
    const h = await startHarness();
    const r = await h.call("GET", "/api/layouts");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(r.json()).toStrictEqual([]);
  });

  test.skip("[REQ-API-5] Übersicht ohne Inhalt, sortiert mit localeCompare „de“ ohne Rücksicht auf Groß-/Kleinschreibung", async () => {
    const h = await startHarness();
    const names = ["zebra", "Oval", "apfel", "Ärger", "kreis", "Bär", "Acht"];
    const created = new Map<string, { version: number; updatedAt: string }>();
    for (const n of names) {
      const r = await putLayout(h, n, 0, OVAL);
      expect(r.status, n).toBe(201);
      const body = r.json() as { version: number; updatedAt: string };
      created.set(n, { version: body.version, updatedAt: body.updatedAt });
    }
    // Oval einmal ändern: die Liste zeigt die aktuelle Version
    const changed = await putLayout(h, "Oval", 1, ACHT);
    expect(changed.status).toBe(200);
    created.set("Oval", changed.json() as { version: number; updatedAt: string });

    const r = await h.call("GET", "/api/layouts");
    expect(r.status).toBe(200);
    const list = r.json() as Array<Record<string, unknown>>;
    expect(list.map((s) => s.name)).toEqual([
      "Acht",
      "apfel",
      "Ärger",
      "Bär",
      "kreis",
      "Oval",
      "zebra",
    ]);
    for (const s of list) {
      const c = created.get(String(s.name));
      expect(s).toStrictEqual({ name: s.name, version: c?.version, updatedAt: c?.updatedAt });
      expect(Object.keys(s).sort()).toEqual(["name", "updatedAt", "version"]);
    }
    expect(list.find((s) => s.name === "Oval")?.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-6 Anlegen
// ---------------------------------------------------------------------------------------------

describe("Anlegen", () => {
  test.skip("[REQ-API-6] PUT mit expectedVersion 0 auf neuen Namen: 201, Version 1, updatedAt; GET liefert genau dieses Layout", async () => {
    const h = await startHarness();
    const before = Date.now();
    const r = await putLayout(h, "Oval", 0, OVAL);
    const after = Date.now();
    expect(r.status).toBe(201);
    expect(r.headers["content-type"]).toMatch(/^application\/json\b/);
    const body = r.json() as { name: string; version: number; updatedAt: string };
    expect(Object.keys(body).sort()).toEqual(["name", "updatedAt", "version"]);
    expect(body.name).toBe("Oval");
    expect(body.version).toBe(1);
    expect(body.updatedAt).toMatch(ISO_MS_Z);
    const t = Date.parse(body.updatedAt);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(after + 1000);

    const g = await h.call("GET", "/api/layouts/Oval");
    expect(g.status).toBe(200);
    expect(g.json()).toStrictEqual({
      name: "Oval",
      version: 1,
      updatedAt: body.updatedAt,
      layout: OVAL,
    });
  });

  test.skip("[REQ-API-6] Acht / groß, kodiert Acht%20%2F%20gro%C3%9F, wird angelegt und unter genau diesem Namen gelistet und geladen", async () => {
    const h = await startHarness();
    const path = "/api/layouts/Acht%20%2F%20gro%C3%9F";
    expect(`/api/layouts/${enc("Acht / groß")}`).toBe(path);
    const r = await h.call("PUT", path, { body: { expectedVersion: 0, layout: ACHT } });
    expect(r.status).toBe(201);
    expect((r.json() as { name: string }).name).toBe("Acht / groß");
    const list = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
    expect(list.map((s) => s.name)).toEqual(["Acht / groß"]);
    const g = await h.call("GET", path);
    expect(g.status).toBe(200);
    expect(g.json()).toMatchObject({ name: "Acht / groß", version: 1, layout: ACHT });
  });

  test.skip("[REQ-API-6] weitere Sonderzeichen im Namen: a:b, 100%, Umlaute, 200 Zeichen", async () => {
    const h = await startHarness();
    const names = ["a:b", "100%", "Große Schleife", "x?y#z&w=1", "a".repeat(200)];
    for (const n of names) {
      const r = await putLayout(h, n, 0, EMPTY);
      expect(r.status, n).toBe(201);
      const g = await h.call("GET", `/api/layouts/${enc(n)}`);
      expect(g.status, n).toBe(200);
      expect((g.json() as { name: string }).name).toBe(n);
    }
    const list = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
    expect(list.map((s) => s.name).sort()).toEqual([...names].sort());
  });

  test.skip("[REQ-API-6] der Name im Pfad wird nicht still getrimmt: %20Oval und Oval%20 → 400, nichts angelegt", async () => {
    const h = await startHarness();
    for (const path of ["/api/layouts/%20Oval", "/api/layouts/Oval%20", "/api/layouts/%09Oval"]) {
      const r = await h.call("PUT", path, { body: { expectedVersion: 0, layout: OVAL } });
      expect(r.status, path).toBe(400);
      expect((r.json() as { _tag: string })._tag).toBe("UngueltigeAnfrage");
    }
    expect((await h.call("GET", "/api/layouts")).json()).toStrictEqual([]);
    // Gegenprobe: ohne Leerraum geht es, und es gibt danach genau „Oval“
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(201);
    expect(
      ((await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>).map((s) => s.name),
    ).toEqual(["Oval"]);
    expect((await h.call("GET", "/api/layouts/%20Oval")).status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-7 Ändern
// ---------------------------------------------------------------------------------------------

describe("Ändern", () => {
  test.skip("[REQ-API-7] PUT mit passender Version ersetzt den Inhalt: 200, Version genau + 1, updatedAt ≥ alt", async () => {
    const h = await startHarness();
    const v1 = (await putLayout(h, "Oval", 0, OVAL)).json() as { updatedAt: string };
    const r2 = await putLayout(h, "Oval", 1, ACHT);
    expect(r2.status).toBe(200);
    const b2 = r2.json() as { name: string; version: number; updatedAt: string };
    expect(Object.keys(b2).sort()).toEqual(["name", "updatedAt", "version"]);
    expect(b2.name).toBe("Oval");
    expect(b2.version).toBe(2);
    expect(b2.updatedAt).toMatch(ISO_MS_Z);
    expect(b2.updatedAt >= v1.updatedAt).toBe(true);
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toStrictEqual({
      name: "Oval",
      version: 2,
      updatedAt: b2.updatedAt,
      layout: ACHT,
    });

    const r3 = await putLayout(h, "Oval", 2, EMPTY);
    expect(r3.status).toBe(200);
    const b3 = r3.json() as { version: number; updatedAt: string };
    expect(b3.version).toBe(3);
    expect(b3.updatedAt >= b2.updatedAt).toBe(true);
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 3,
      layout: EMPTY,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-8 Konflikt
// ---------------------------------------------------------------------------------------------

describe("Konflikt beim Schreiben", () => {
  test.skip("[REQ-API-8] expectedVersion 0 bei vorhandenem Namen: 409 mit vollständigem Stand, Datenbank unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    const stand = (await h.call("GET", "/api/layouts/Oval")).json();
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);

    const r = await putLayout(h, "Oval", 0, ACHT);
    expect(r.status).toBe(409);
    expect(r.json()).toStrictEqual({ _tag: "VersionKonflikt", expectedVersion: 0, aktuell: stand });
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);
  });

  test.skip("[REQ-API-8] expectedVersion 3 bei Version 4: 409 mit Stand in Version 4, Datenbank unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await putLayout(h, "Oval", 1, ACHT);
    await putLayout(h, "Oval", 2, OVAL);
    expect((await putLayout(h, "Oval", 3, ACHT)).status).toBe(200);
    const stand = (await h.call("GET", "/api/layouts/Oval")).json() as { version: number };
    expect(stand.version).toBe(4);
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);

    const r = await putLayout(h, "Oval", 3, EMPTY);
    expect(r.status).toBe(409);
    expect(r.json()).toStrictEqual({ _tag: "VersionKonflikt", expectedVersion: 3, aktuell: stand });
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);

    // auch eine höhere als die vorhandene Version ist ein Konflikt
    const higher = await putLayout(h, "Oval", 5, EMPTY);
    expect(higher.status).toBe(409);
    expect((higher.json() as { aktuell: unknown }).aktuell).toStrictEqual(stand);
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
  });

  test.skip("[REQ-API-8] expectedVersion 2 bei gelöschtem Layout: 409 mit aktuell null, nichts neu angelegt", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await putLayout(h, "Oval", 1, ACHT);
    await putLayout(h, "Andere", 0, OVAL);
    expect((await h.call("DELETE", "/api/layouts/Oval?version=2")).status).toBe(204);
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);

    const r = await putLayout(h, "Oval", 2, EMPTY);
    expect(r.status).toBe(409);
    expect(r.json()).toStrictEqual({ _tag: "VersionKonflikt", expectedVersion: 2, aktuell: null });
    expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(404);
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);

    // Gegenprobe: neu anlegen mit 0 geht wieder und beginnt bei Version 1
    const again = await putLayout(h, "Oval", 0, EMPTY);
    expect(again.status).toBe(201);
    expect((again.json() as { version: number }).version).toBe(1);
  });

  test.skip("[REQ-API-8] expectedVersion ≥ 1 auf einen Namen, den es nie gab: 409 mit aktuell null", async () => {
    const h = await startHarness();
    const r = await putLayout(h, "Nie", 1, OVAL);
    expect(r.status).toBe(409);
    expect(r.json()).toStrictEqual({ _tag: "VersionKonflikt", expectedVersion: 1, aktuell: null });
    expect((await h.call("GET", "/api/layouts")).json()).toStrictEqual([]);
    expect(rawSnapshot(h.dbPath)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-9 Lesen
// ---------------------------------------------------------------------------------------------

describe("Lesen", () => {
  test.skip("[REQ-API-9] GET liefert 200 mit dem Stand; unbekannter Name 404 NichtGefunden mit dem dekodierten Namen", async () => {
    const h = await startHarness();
    const c = (await putLayout(h, "Oval", 0, OVAL)).json() as { updatedAt: string };
    const g = await h.call("GET", "/api/layouts/Oval");
    expect(g.status).toBe(200);
    expect(g.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(g.json()).toStrictEqual({
      name: "Oval",
      version: 1,
      updatedAt: c.updatedAt,
      layout: OVAL,
    });

    const missing = await h.call("GET", `/api/layouts/${enc("Gibt es / nicht")}`);
    expect(missing.status).toBe(404);
    expect(missing.json()).toStrictEqual({ _tag: "NichtGefunden", name: "Gibt es / nicht" });
    // Namen unterscheiden Groß-/Kleinschreibung (der Name ist die Identität)
    expect((await h.call("GET", "/api/layouts/oval")).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-10 Löschen
// ---------------------------------------------------------------------------------------------

describe("Löschen", () => {
  test.skip("[REQ-API-10] DELETE mit der Version auf dem Server: 204 ohne Körper, danach 404 und nicht mehr gelistet", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await putLayout(h, "Oval", 1, ACHT);
    await putLayout(h, "Bleibt", 0, OVAL);
    const r = await h.call("DELETE", "/api/layouts/Oval?version=2");
    expect(r.status).toBe(204);
    expect(r.text).toBe("");
    expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(404);
    const list = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
    expect(list.map((s) => s.name)).toEqual(["Bleibt"]);
  });

  test.skip("[REQ-API-10] DELETE mit anderer Version: 409 mit aktuellem Stand, Datenbank unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await putLayout(h, "Oval", 1, ACHT);
    const stand = (await h.call("GET", "/api/layouts/Oval")).json();
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);
    for (const v of [1, 3]) {
      const r = await h.call("DELETE", `/api/layouts/Oval?version=${v}`);
      expect(r.status, `version=${v}`).toBe(409);
      expect(r.json()).toStrictEqual({
        _tag: "VersionKonflikt",
        expectedVersion: v,
        aktuell: stand,
      });
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);
  });

  test.skip("[REQ-API-10] DELETE auf fehlenden Namen: 404 NichtGefunden, Datenbank unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    const raw = rawSnapshot(h.dbPath);
    const r = await h.call("DELETE", `/api/layouts/${enc("Gibt es nicht")}?version=1`);
    expect(r.status).toBe(404);
    expect(r.json()).toStrictEqual({ _tag: "NichtGefunden", name: "Gibt es nicht" });
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
  });

  test.skip("[REQ-API-10] DELETE ohne oder mit ungültigem version: 400 UngueltigeAnfrage, Datenbank unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    const raw = rawSnapshot(h.dbPath);
    for (const q of ["", "?", "?version=", "?version=abc", "?version=-1", "?version=1.5", "?v=1"]) {
      const r = await h.call("DELETE", `/api/layouts/Oval${q}`);
      expect(r.status, q).toBe(400);
      expect((r.json() as { _tag: string })._tag, q).toBe("UngueltigeAnfrage");
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-11, REQ-API-12 Bestand
// ---------------------------------------------------------------------------------------------

describe("Bestand", () => {
  test.skip("[REQ-API-11] nie gespeichert: GET /api/bestand liefert Version 0, updatedAt null, leeren Bestand", async () => {
    const h = await startHarness();
    const r = await h.call("GET", "/api/bestand");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(r.json()).toStrictEqual({
      version: 0,
      updatedAt: null,
      inventory: { schemaVersion: 1, counts: {} },
    });
  });

  test.skip("[REQ-API-12] Beispiel: expectedVersion 0 mit unbekannter Teil-ID → 200, Version 1; GET liefert beide Einträge unverändert", async () => {
    const h = await startHarness();
    const r = await h.call("PUT", "/api/bestand", {
      body: { expectedVersion: 0, inventory: BESTAND },
    });
    expect(r.status).toBe(200);
    const body = r.json() as { version: number; updatedAt: string };
    expect(Object.keys(body).sort()).toEqual(["updatedAt", "version"]);
    expect(body.version).toBe(1);
    expect(body.updatedAt).toMatch(ISO_MS_Z);
    expect((await h.call("GET", "/api/bestand")).json()).toStrictEqual({
      version: 1,
      updatedAt: body.updatedAt,
      inventory: BESTAND,
    });
  });

  test.skip("[REQ-API-12] passende Version: 200 und Version + 1; Konflikt: 409 mit aktuellem Bestands-Stand, Datenbank unverändert", async () => {
    const h = await startHarness();
    await h.call("PUT", "/api/bestand", { body: { expectedVersion: 0, inventory: BESTAND } });
    const next = { schemaVersion: 1, counts: { "gerade-342": 4 } };
    const r2 = await h.call("PUT", "/api/bestand", {
      body: { expectedVersion: 1, inventory: next },
    });
    expect(r2.status).toBe(200);
    const b2 = r2.json() as { version: number; updatedAt: string };
    expect(b2.version).toBe(2);
    const stand = (await h.call("GET", "/api/bestand")).json();
    expect(stand).toStrictEqual({ version: 2, updatedAt: b2.updatedAt, inventory: next });
    const raw = rawSnapshot(h.dbPath);

    for (const v of [0, 1, 3]) {
      const r = await h.call("PUT", "/api/bestand", {
        body: { expectedVersion: v, inventory: BESTAND },
      });
      expect(r.status, `expectedVersion ${v}`).toBe(409);
      expect(r.json()).toStrictEqual({
        _tag: "VersionKonflikt",
        expectedVersion: v,
        aktuell: stand,
      });
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect((await h.call("GET", "/api/bestand")).json()).toStrictEqual(stand);
  });

  test.skip("[REQ-API-12] Konflikt auf nie gespeichertem Bestand: expectedVersion 1 → 409 mit Version-0-Stand", async () => {
    const h = await startHarness();
    const r = await h.call("PUT", "/api/bestand", {
      body: { expectedVersion: 1, inventory: BESTAND },
    });
    expect(r.status).toBe(409);
    expect(r.json()).toStrictEqual({
      _tag: "VersionKonflikt",
      expectedVersion: 1,
      aktuell: { version: 0, updatedAt: null, inventory: { schemaVersion: 1, counts: {} } },
    });
    expect((await h.call("GET", "/api/bestand")).json()).toMatchObject({ version: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-13 Ungültige Anfragen
// ---------------------------------------------------------------------------------------------

describe("Ungültige Anfragen", () => {
  const prepared = async (): Promise<Harness> => {
    const h = await startHarness();
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(201);
    expect(
      (await h.call("PUT", "/api/bestand", { body: { expectedVersion: 0, inventory: BESTAND } }))
        .status,
    ).toBe(200);
    return h;
  };

  const invalidLayoutBodies: ReadonlyArray<readonly [string, string | object, string | null]> = [
    ["kein JSON", "kaputt", null],
    ["abgeschnittenes JSON", '{"expectedVersion":1,"layout":{', null],
    ["fehlende schemaVersion", { expectedVersion: 1, layout: { elements: [] } }, "schemaVersion"],
    [
      "fremde schemaVersion",
      { expectedVersion: 1, layout: { schemaVersion: 2, elements: [] } },
      "schemaVersion",
    ],
    [
      "Zusatzfeld in der Anfrage",
      { expectedVersion: 1, layout: OVAL, zusatzfeld: 1 },
      "zusatzfeld",
    ],
    [
      "Zusatzfeld im Layout",
      { expectedVersion: 1, layout: { ...OVAL, zusatzfeld: 1 } },
      "zusatzfeld",
    ],
    [
      "doppelte Element-ID",
      {
        expectedVersion: 1,
        layout: {
          schemaVersion: 1,
          elements: [
            { id: "a", part: "gerade-342" },
            { id: "a", part: "gerade-342" },
          ],
        },
      },
      null,
    ],
    ["expectedVersion −1", { expectedVersion: -1, layout: OVAL }, "expectedVersion"],
    ["expectedVersion gebrochen", { expectedVersion: 1.5, layout: OVAL }, "expectedVersion"],
    ["expectedVersion als Text", { expectedVersion: "1", layout: OVAL }, "expectedVersion"],
    ["expectedVersion fehlt", { layout: OVAL }, "expectedVersion"],
    ["layout fehlt", { expectedVersion: 1 }, "layout"],
    ["JSON-Array", [], null],
    ["JSON-null", "null", null],
  ];

  test.skip("[REQ-API-13] PUT /api/layouts mit ungültigem Körper: 400 UngueltigeAnfrage mit Grund aus der Schema-Prüfung, Datenbank unverändert", async () => {
    const h = await prepared();
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);
    for (const [label, body, mentions] of invalidLayoutBodies) {
      const r = await h.call("PUT", "/api/layouts/Oval", { body });
      expect(r.status, label).toBe(400);
      const e = r.json() as Record<string, unknown>;
      expect(Object.keys(e).sort(), label).toEqual(["_tag", "reason"]);
      expect(e._tag, label).toBe("UngueltigeAnfrage");
      expect(typeof e.reason, label).toBe("string");
      expect(String(e.reason).trim().length, label).toBeGreaterThan(0);
      if (mentions !== null) expect(String(e.reason), label).toContain(mentions);
      // auch auf einen neuen Namen: nichts wird angelegt
      const n = await h.call("PUT", "/api/layouts/Neu", { body });
      expect(n.status, `${label} (neuer Name)`).toBe(400);
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);
  });

  test.skip("[REQ-API-13] PUT /api/bestand mit ungültigem Körper: 400 UngueltigeAnfrage, Datenbank unverändert", async () => {
    const h = await prepared();
    const raw = rawSnapshot(h.dbPath);
    const api = await apiSnapshot(h);
    const bodies: ReadonlyArray<readonly [string, string | object, string | null]> = [
      ["kein JSON", "kaputt", null],
      [
        "fehlende schemaVersion",
        { expectedVersion: 1, inventory: { counts: {} } },
        "schemaVersion",
      ],
      [
        "fremde schemaVersion",
        { expectedVersion: 1, inventory: { schemaVersion: 2, counts: {} } },
        "schemaVersion",
      ],
      [
        "negative Anzahl",
        { expectedVersion: 1, inventory: { schemaVersion: 1, counts: { "kurve-1-90": -1 } } },
        null,
      ],
      [
        "gebrochene Anzahl",
        { expectedVersion: 1, inventory: { schemaVersion: 1, counts: { "kurve-1-90": 1.5 } } },
        null,
      ],
      ["Zusatzfeld", { expectedVersion: 1, inventory: BESTAND, zusatzfeld: true }, "zusatzfeld"],
      [
        "Zusatzfeld im Bestand",
        { expectedVersion: 1, inventory: { ...BESTAND, zusatzfeld: 1 } },
        "zusatzfeld",
      ],
      ["expectedVersion −1", { expectedVersion: -1, inventory: BESTAND }, "expectedVersion"],
      ["inventory fehlt", { expectedVersion: 1 }, "inventory"],
    ];
    for (const [label, body, mentions] of bodies) {
      const r = await h.call("PUT", "/api/bestand", { body });
      expect(r.status, label).toBe(400);
      const e = r.json() as Record<string, unknown>;
      expect(e._tag, label).toBe("UngueltigeAnfrage");
      expect(String(e.reason).trim().length, label).toBeGreaterThan(0);
      if (mentions !== null) expect(String(e.reason), label).toContain(mentions);
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect(await apiSnapshot(h)).toStrictEqual(api);
  });

  test.skip("[REQ-API-13] ungültiger Name im Pfad: 400 UngueltigeAnfrage, Datenbank unverändert", async () => {
    const h = await prepared();
    const raw = rawSnapshot(h.dbPath);
    for (const name of [" Oval", "Oval ", "a".repeat(201)]) {
      const r = await h.call("PUT", `/api/layouts/${enc(name)}`, {
        body: { expectedVersion: 0, layout: OVAL },
      });
      expect(r.status, JSON.stringify(name)).toBe(400);
      expect((r.json() as { _tag: string })._tag).toBe("UngueltigeAnfrage");
      expect((await h.call("GET", `/api/layouts/${enc(name)}`)).status).toBe(400);
      expect((await h.call("DELETE", `/api/layouts/${enc(name)}?version=1`)).status).toBe(400);
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
  });

  test.skip("[REQ-API-13] 415 kommt, ohne auf den Körper zu warten: Client kündigt 1000 Byte an und sendet nur 22", async () => {
    // Testnachtrag 2: der Content-Type wird vor dem Körperlesen geprüft; sonst hinge die Antwort.
    const h = await startHarness();
    const head = (type: string, path: string) =>
      `PUT ${path} HTTP/1.1\r\nHost: localhost:${h.port}\r\nContent-Type: ${type}\r\nContent-Length: 1000\r\n\r\n{"expectedVersion":0,"`;
    expect(await firstStatus(h.port, head("text/plain", "/api/layouts/Neu"), 2_000)).toBe(415);
    expect(await firstStatus(h.port, head("text/plain", "/api/bestand"), 2_000)).toBe(415);
    // Gegenprobe: mit application/json wartet der Server auf den Körper
    expect(await firstStatus(h.port, head("application/json", "/api/layouts/Neu"), 500)).toBe(
      "zeitueberschreitung",
    );
    expect((await h.call("GET", "/api/layouts")).json()).toStrictEqual([]);
  });

  test.skip("[REQ-API-13] Content-Type außer application/json bei PUT: 415, Datenbank unverändert", async () => {
    const h = await prepared();
    const raw = rawSnapshot(h.dbPath);
    const layoutBody = JSON.stringify({ expectedVersion: 1, layout: ACHT });
    const bestandBody = JSON.stringify({
      expectedVersion: 1,
      inventory: { schemaVersion: 1, counts: {} },
    });
    for (const ct of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      null,
    ]) {
      const a = await h.call("PUT", "/api/layouts/Oval", { body: layoutBody, contentType: ct });
      expect(a.status, `layouts ${ct}`).toBe(415);
      const b = await h.call("PUT", "/api/bestand", { body: bestandBody, contentType: ct });
      expect(b.status, `bestand ${ct}`).toBe(415);
    }
    expect(rawSnapshot(h.dbPath)).toEqual(raw);
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 1,
      layout: OVAL,
    });
  });

  test.skip("[REQ-API-13] Körper über 1 MiB: 413 ZuGross, Datenbank unverändert; genau 1 MiB wird noch angenommen", async () => {
    const h = await prepared();
    const raw = rawSnapshot(h.dbPath);
    const MiB = 1024 * 1024;
    const padTo = (json: string, size: number): Buffer => {
      const b = Buffer.from(json);
      expect(b.length).toBeLessThan(size);
      return Buffer.concat([b, Buffer.alloc(size - b.length, " ")]); // JSON erlaubt Leerraum am Ende
    };
    const tooBig = padTo(JSON.stringify({ expectedVersion: 1, layout: ACHT }), MiB + 1);
    const a = await h.call("PUT", "/api/layouts/Oval", { body: tooBig });
    expect(a.status).toBe(413);
    expect(a.json()).toStrictEqual({ _tag: "ZuGross" });
    const twoMB = padTo(
      JSON.stringify({ expectedVersion: 1, inventory: BESTAND }),
      2 * 1000 * 1000,
    );
    const b = await h.call("PUT", "/api/bestand", { body: twoMB });
    expect(b.status).toBe(413);
    expect(b.json()).toStrictEqual({ _tag: "ZuGross" });
    expect(rawSnapshot(h.dbPath)).toEqual(raw);

    // Grenze: genau 1 MiB ist nicht „über 1 MiB“
    const exact = padTo(JSON.stringify({ expectedVersion: 1, layout: ACHT }), MiB);
    const c = await h.call("PUT", "/api/layouts/Oval", { body: exact });
    expect(c.status).toBe(200);
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 2,
      layout: ACHT,
    });
  });

  test.skip("[REQ-API-13] nichts wird still bereinigt: ein gültiges Layout mit Zusatzfeld in einem Element wird abgewiesen, nicht gekürzt gespeichert", async () => {
    const h = await prepared();
    const r = await putLayout(h, "Oval", 1, {
      schemaVersion: 1,
      elements: [{ id: "a", part: "gerade-342", farbe: "rot" }],
    });
    expect(r.status).toBe(400);
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 1,
      layout: OVAL,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-16 Unbekannte Pfade, REQ-API-17 CORS
// ---------------------------------------------------------------------------------------------

describe("Unbekannte Pfade und Methoden", () => {
  test.skip("[REQ-API-16] unbekannter Pfad unter /api/: 404 als JSON, nie die Startseite", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    for (const path of [
      "/api/gibtsnicht",
      "/api/",
      "/api/layouts/Oval/extra",
      "/api/bestand/x",
      "/api/status/x",
      "/api/index.html",
    ]) {
      const r = await h.call("GET", path);
      expect(r.status, path).toBe(404);
      expect(r.headers["content-type"], path).toMatch(/^application\/json\b/);
      expect(() => r.json(), path).not.toThrow();
      expect(r.text, path).not.toContain(INDEX_MARKER);
      expect(r.text.toLowerCase(), path).not.toContain("<html");
    }
  });

  test.skip("[REQ-API-16] bekannte Route mit falscher Methode: 404 oder 405 als JSON, nie die Startseite", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    for (const [method, path] of [
      ["POST", "/api/layouts"],
      ["PUT", "/api/layouts"],
      ["DELETE", "/api/layouts"],
      ["POST", "/api/layouts/Oval"],
      ["PATCH", "/api/layouts/Oval"],
      ["DELETE", "/api/bestand"],
      ["POST", "/api/bestand"],
      ["POST", "/api/status"],
    ] as const) {
      const r = await h.call(method, path, { body: "{}" });
      expect([404, 405], `${method} ${path}`).toContain(r.status);
      expect(r.headers["content-type"], `${method} ${path}`).toMatch(/^application\/json\b/);
      expect(() => r.json(), `${method} ${path}`).not.toThrow();
      expect(r.text, `${method} ${path}`).not.toContain(INDEX_MARKER);
    }
    // nichts verändert
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({ version: 1 });
    expect((await h.call("GET", "/api/bestand")).json()).toMatchObject({ version: 0 });
  });
});

describe("Keine CORS-Freigabe", () => {
  test.skip("[REQ-API-17] OPTIONS mit fremdem Origin und Access-Control-Request-Method PUT: keine Access-Control-Allow-*-Kopfzeile", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    for (const path of ["/api/bestand", "/api/layouts/Oval", "/api/layouts", "/"]) {
      const r = await h.call("OPTIONS", path, {
        headers: {
          origin: "http://fremd.example",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
      });
      expect(r.headers["access-control-allow-origin"], path).toBeUndefined();
      expect(
        Object.keys(r.headers).filter((k) => k.startsWith("access-control-")),
        path,
      ).toEqual([]);
    }
  });

  test.skip("[REQ-API-17] gewöhnliche Anfragen mit fremdem Origin bekommen ebenfalls keine Access-Control-Allow-Origin-Kopfzeile", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    const headers = { origin: "http://fremd.example" };
    for (const r of [
      await h.call("GET", "/api/layouts", { headers }),
      await h.call("GET", "/api/layouts/Oval", { headers }),
      await h.call("GET", "/api/bestand", { headers }),
      await h.call("PUT", "/api/layouts/Neu", {
        headers,
        body: { expectedVersion: 0, layout: OVAL },
      }),
    ]) {
      expect(r.status).toBeLessThan(300);
      expect(Object.keys(r.headers).filter((k) => k.startsWith("access-control-"))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-SRV-4 Unerwarteter Fehler
// ---------------------------------------------------------------------------------------------

describe("Unerwarteter Fehler", () => {
  test.skip("[REQ-SRV-4] scheitert die Datenbank unter einer Anfrage: 500 ServerFehler ohne Stacktrace, Fehler auf stderr, nächste Anfrage normal", async () => {
    const h = await startHarness();
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(201);
    // Unerwarteten Fehler auslösen: die Nutztabellen unter dem laufenden Server wegbenennen
    const db = new BetterSqlite(h.dbPath, { fileMustExist: true });
    const tables = userTables(db);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables)
      db.prepare(`ALTER TABLE ${quoteIdent(t)} RENAME TO ${quoteIdent(`weg_${t}`)}`).run();
    db.close();
    const errBefore = h.err.length;

    const r = await putLayout(h, "Neu", 0, ACHT);
    expect(r.status).toBe(500);
    const e = r.json() as Record<string, unknown>;
    expect(Object.keys(e).sort()).toEqual(["_tag", "text"]);
    expect(e._tag).toBe("ServerFehler");
    expect(typeof e.text).toBe("string");
    expect(r.text).not.toMatch(/\n\s*at\s/);
    expect(r.text).not.toMatch(/\bat\s+\S+\s+\(/);
    expect(r.text).not.toContain("node_modules");
    expect(r.text).not.toContain(".ts:");
    expect(r.text).not.toContain(".js:");
    expect(h.err.length).toBeGreaterThan(errBefore);
    expect(h.err.slice(errBefore).join("\n").trim().length).toBeGreaterThan(0);

    // Tabellen zurück: die nächste Anfrage wird normal beantwortet, der Server lief weiter
    const db2 = new BetterSqlite(h.dbPath, { fileMustExist: true });
    for (const t of tables)
      db2.prepare(`ALTER TABLE ${quoteIdent(`weg_${t}`)} RENAME TO ${quoteIdent(t)}`).run();
    db2.close();
    const ok = await putLayout(h, "Neu", 0, ACHT);
    expect(ok.status).toBe(201);
    expect((await h.call("GET", "/api/status")).json()).toStrictEqual({ status: "ok" });
    const list = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
    expect(list.map((s) => s.name)).toEqual(["Neu", "Oval"]);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-DB-5 Zeilen in der Datei, REQ-SARCH-2 Prüfweg
// ---------------------------------------------------------------------------------------------

describe("Zeilen in der Datenbank", () => {
  const rowsWithValue = (rows: TableRow[], value: unknown): TableRow[] =>
    rows.filter((r) => Object.values(r.row).some((v) => v === value));
  const hasUpdatedAt = (row: Row, updatedAt: string): boolean =>
    Object.values(row).some((v) => v === updatedAt || v === Date.parse(updatedAt));
  const hasJson = (row: Row, value: unknown): boolean =>
    Object.values(row).some((v) => deepEqual(jsonOf(v), value));

  test.skip("[REQ-DB-5] je Layout genau eine Zeile mit Name, Version, updatedAt und dem Layout als JSON-Text", async () => {
    const h = await startHarness();
    const a = (
      await h.call("PUT", "/api/layouts/Acht%20%2F%20gro%C3%9F", {
        body: { expectedVersion: 0, layout: ACHT },
      })
    ).json() as { updatedAt: string };
    await putLayout(h, "Oval", 0, EMPTY);
    const o = (await putLayout(h, "Oval", 1, OVAL)).json() as {
      version: number;
      updatedAt: string;
    };
    expect(o.version).toBe(2);

    const rows = allRows(h.dbPath);
    const acht = rowsWithValue(rows, "Acht / groß");
    expect(acht).toHaveLength(1);
    const achtRow = (acht[0] as TableRow).row;
    expect(Object.values(achtRow)).toContain(1);
    expect(hasUpdatedAt(achtRow, a.updatedAt)).toBe(true);
    expect(hasJson(achtRow, ACHT)).toBe(true);

    const oval = rowsWithValue(rows, "Oval");
    expect(oval).toHaveLength(1); // kein Verlauf: nach zwei Schreibvorgängen weiter genau eine Zeile
    const ovalRow = (oval[0] as TableRow).row;
    expect(Object.values(ovalRow)).toContain(2);
    expect(hasUpdatedAt(ovalRow, o.updatedAt)).toBe(true);
    expect(hasJson(ovalRow, OVAL)).toBe(true);
    expect(rows.filter((r) => hasJson(r.row, EMPTY))).toHaveLength(0);

    // Löschen entfernt die Zeile
    expect((await h.call("DELETE", "/api/layouts/Oval?version=2")).status).toBe(204);
    expect(rowsWithValue(allRows(h.dbPath), "Oval")).toHaveLength(0);
    expect(rowsWithValue(allRows(h.dbPath), "Acht / groß")).toHaveLength(1);
  });

  test.skip("[REQ-DB-5] Bestand: höchstens eine Zeile mit Version, updatedAt und dem Bestand als JSON-Text", async () => {
    const h = await startHarness();
    const isInventoryRow = (r: TableRow): boolean =>
      Object.values(r.row).some((v) => {
        const j = jsonOf(v) as { counts?: unknown } | undefined;
        return typeof j === "object" && j !== null && "counts" in j;
      });
    // nie gespeichert: keine Bestandszeile nötig, höchstens eine
    expect(allRows(h.dbPath).filter(isInventoryRow).length).toBeLessThanOrEqual(1);

    const b1 = (
      await h.call("PUT", "/api/bestand", {
        body: { expectedVersion: 0, inventory: BESTAND },
      })
    ).json() as { updatedAt: string };
    let rows = allRows(h.dbPath).filter(isInventoryRow);
    expect(rows).toHaveLength(1);
    let row = (rows[0] as TableRow).row;
    expect(hasJson(row, BESTAND)).toBe(true);
    expect(Object.values(row)).toContain(1);
    expect(hasUpdatedAt(row, b1.updatedAt)).toBe(true);

    const next = { schemaVersion: 1, counts: { "gerade-342": 2 } };
    const b2 = (
      await h.call("PUT", "/api/bestand", {
        body: { expectedVersion: 1, inventory: next },
      })
    ).json() as { updatedAt: string };
    rows = allRows(h.dbPath).filter(isInventoryRow);
    expect(rows).toHaveLength(1);
    row = (rows[0] as TableRow).row;
    expect(hasJson(row, next)).toBe(true);
    expect(hasJson(row, BESTAND)).toBe(false);
    expect(Object.values(row)).toContain(2);
    expect(hasUpdatedAt(row, b2.updatedAt)).toBe(true);
  });

  test.skip("[REQ-SARCH-2] Prüfweg: echter Port, echte SQLite-Datei; ein über HTTP angelegtes Layout steht in der Datei und übersteht den Neustart", async () => {
    const h = await startHarness();
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(201);
    await h.stop();
    // echte SQLite-Datei, kein In-Memory-Ersatz
    expect(readFileSync(h.dbPath).subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
    expect(
      allRows(h.dbPath).filter((r) => Object.values(r.row).some((v) => deepEqual(jsonOf(v), OVAL))),
    ).toHaveLength(1);
    // nach dem Stopp lauscht nichts mehr
    await expect(h.call("GET", "/api/status")).rejects.toThrow();
    await h.restart();
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      name: "Oval",
      version: 1,
      layout: OVAL,
    });
  });
});
