/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Datenbank. Abnahmetests REQ-DB-1 bis
 * REQ-DB-4 im Testprozess (Schnittstelle startServer wie in api.test.ts beschrieben). Dieselben
 * Fälle für den echten Prozess (Exit-Code, Standard- und Fehlerausgabe) stehen in process.test.ts.
 *
 * Kaputte Inhalte und fremde Migrationen werden bei gestopptem Server direkt in der Datei
 * erzeugt (`better-sqlite3`, kommt transitiv mit @effect/sql-sqlite-node). Die Tabellen sucht der
 * Test über ihren Inhalt, nicht über Namen; die Migrations-Buchführung über eine Tabelle, deren
 * Name „migration“ enthält (so legt `SqliteMigrator` sie an: `effect_sql_migrations`).
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/** Zustand über die API (erlaubter Host): Liste, jeder Stand, Bestand. */
const apiSnapshot = async (h: Harness): Promise<unknown> => {
  const list = (await h.call("GET", "/api/layouts")).json() as Array<{ name: string }>;
  const states: unknown[] = [];
  for (const s of list) states.push((await h.call("GET", `/api/layouts/${enc(s.name)}`)).json());
  const bestand = (await h.call("GET", "/api/bestand")).json();
  return { list, states, bestand };
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
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gibt-es-nicht": 3 } } as const;
const EMPTY_FOR_OVAL = { schemaVersion: 1, elements: [] } as const;

const putLayout = (h: Harness, name: string, expectedVersion: number, layout: unknown) =>
  h.call("PUT", `/api/layouts/${enc(name)}`, { body: { expectedVersion, layout } });

/** Start, der scheitern soll: gibt die Fehlerausgabe zurück und prüft, dass nichts lauscht. */
const failingStart = async (env: Env): Promise<string> => {
  const api = await loadServer();
  const err: string[] = [];
  const out: string[] = [];
  let started: RunningServer | undefined;
  let rejected = false;
  try {
    started = await api.startServer(env, {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });
  } catch {
    rejected = true;
  }
  if (started !== undefined) await started.close();
  expect(rejected, "startServer muss verworfen werden").toBe(true);
  await expect(call(Number(env.CARRERA_PORT), "GET", "/api/status")).rejects.toThrow();
  return err.join("\n");
};

const envFor = async (dbPath: string, staticDir: string): Promise<Env> => ({
  CARRERA_HOST: "127.0.0.1",
  CARRERA_PORT: String(await freePort()),
  CARRERA_DB: dbPath,
  CARRERA_STATIC: staticDir,
});

const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "carrera-m3b-db-"));
  tmpDirs.push(d);
  return d;
};

/** Zeilen mit einem bestimmten JSON-Inhalt finden und die betroffene Spalte überschreiben. */
const overwriteJsonColumn = (dbPath: string, match: unknown, replacement: string): void => {
  const db = new BetterSqlite(dbPath, { fileMustExist: true });
  try {
    let hits = 0;
    for (const t of userTables(db)) {
      for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM ${quoteIdent(t)}`).all()) {
        for (const [col, v] of Object.entries(row)) {
          if (col !== "__rowid" && deepEqual(jsonOf(v), match)) {
            db.prepare(`UPDATE ${quoteIdent(t)} SET ${quoteIdent(col)} = ? WHERE rowid = ?`).run(
              replacement,
              row.__rowid,
            );
            hits++;
          }
        }
      }
    }
    expect(hits, "genau eine Spalte mit diesem Inhalt").toBe(1);
  } finally {
    db.close();
  }
};

const rawColumnValues = (dbPath: string): unknown[] =>
  allRows(dbPath).flatMap((r) => Object.values(r.row));

// ---------------------------------------------------------------------------------------------
// REQ-DB-1 Neue Datei
// ---------------------------------------------------------------------------------------------

describe("Neue Datenbank", () => {
  test("[REQ-DB-1] Pfad ohne Datei und ohne Verzeichnis: Verzeichnis und Datei entstehen, Tabellen sind eingerichtet, stdout nennt Pfad und „neu angelegt“", async () => {
    const dir = newDir();
    const dbPath = join(dir, "neu", "tief", "carrera.sqlite");
    expect(existsSync(join(dir, "neu"))).toBe(false);
    const h = await startHarness({ CARRERA_DB: dbPath });
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath).subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
    const line = h.out.find((l) => l.includes(dbPath) && l.includes("neu angelegt"));
    expect(line, h.out.join("\n")).toBeDefined();
    // Tabellen eingerichtet: alle Endpunkte arbeiten sofort
    expect((await h.call("GET", "/api/status")).json()).toStrictEqual({ status: "ok" });
    expect((await h.call("GET", "/api/layouts")).json()).toStrictEqual([]);
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(201);
    expect(
      (await h.call("PUT", "/api/bestand", { body: { expectedVersion: 0, inventory: BESTAND } }))
        .status,
    ).toBe(200);
    // Migrationen sind in der Datei verbucht
    const db = new BetterSqlite(dbPath, { readonly: true, fileMustExist: true });
    try {
      const names = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => String(r.name));
      expect(
        names.some((n) => /migration/i.test(n)),
        names.join(", "),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  test("[REQ-DB-1] vorhandene Datei: kein „neu angelegt“ beim zweiten Start (Gegenprobe)", async () => {
    const h = await startHarness();
    expect(h.out.some((l) => l.includes("neu angelegt"))).toBe(true);
    await putLayout(h, "Oval", 0, OVAL);
    const before = h.out.length;
    await h.restart();
    expect(h.out.slice(before).some((l) => l.includes("neu angelegt"))).toBe(false);
    expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-DB-2 Neustart
// ---------------------------------------------------------------------------------------------

describe("Neustart", () => {
  test("[REQ-DB-2] nach Beenden und Neustart mit derselben Datei: dieselben Layouts mit Versionen, updatedAt und Inhalten und derselbe Bestand", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await putLayout(h, "Oval", 1, ACHT);
    await putLayout(h, "Acht / groß", 0, ACHT);
    await putLayout(h, "Weg", 0, OVAL);
    expect((await h.call("DELETE", "/api/layouts/Weg?version=1")).status).toBe(204);
    await h.call("PUT", "/api/bestand", { body: { expectedVersion: 0, inventory: BESTAND } });
    const before = await apiSnapshot(h);

    await h.restart();
    expect(await apiSnapshot(h)).toStrictEqual(before);
    // und es geht mit den Versionen weiter, nicht von vorn
    const r = await putLayout(h, "Oval", 2, OVAL);
    expect(r.status).toBe(200);
    expect((r.json() as { version: number }).version).toBe(3);
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(409);

    await h.restart();
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 3,
      layout: OVAL,
    });
    expect((await h.call("GET", "/api/bestand")).json()).toMatchObject({
      version: 1,
      inventory: BESTAND,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-DB-3 Kaputte Datei
// ---------------------------------------------------------------------------------------------

describe("Kaputte oder fremde Datei", () => {
  test("[REQ-DB-3] keine SQLite-Datenbank: Start scheitert mit Pfad auf stderr, Datei Byte für Byte unverändert", async () => {
    const dir = newDir();
    const staticDir = join(dir, "static");
    mkdirSync(staticDir);
    for (const content of [
      Buffer.from("kaputt"),
      Buffer.from("x".repeat(8192)),
      Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(84, 0xff)]),
    ]) {
      const dbPath = join(dir, "kaputt.sqlite");
      writeFileSync(dbPath, content);
      const err = await failingStart(await envFor(dbPath, staticDir));
      expect(err).toContain(dbPath);
      expect(readFileSync(dbPath).equals(content)).toBe(true);
    }
  });

  test("[REQ-DB-3] vorhandene leere Datei (0 Byte): Start scheitert mit Pfad auf stderr, keine neue Datenbank darüber, Datei bleibt 0 Byte", async () => {
    // Testnachtrag 2: SQLite selbst behandelt eine 0-Byte-Datei als leere Datenbank und würde sie
    // still migrieren; die Spec verlangt, nie eine neue leere Datenbank über eine vorhandene Datei
    // zu legen.
    const dir = newDir();
    const staticDir = join(dir, "static");
    mkdirSync(staticDir);
    const dbPath = join(dir, "leer.sqlite");
    writeFileSync(dbPath, Buffer.alloc(0));
    const env = await envFor(dbPath, staticDir);
    const err = await failingStart(env);
    expect(err).toContain(dbPath);
    expect(readFileSync(dbPath).length).toBe(0);
    expect(existsSync(`${dbPath}-wal`) ? readFileSync(`${dbPath}-wal`).length : 0).toBe(0);
    // Gegenprobe: ein Pfad ohne Datei wird weiterhin neu angelegt
    const fresh = join(dir, "neu.sqlite");
    const h = await startHarness({ CARRERA_DB: fresh });
    expect(h.out.some((l) => l.includes(fresh) && l.includes("neu angelegt"))).toBe(true);
  });

  test("[REQ-DB-3] nicht lesbare Datei: Start scheitert mit Pfad auf stderr, Datei unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await h.stop();
    const bytes = readFileSync(h.dbPath);
    chmodSync(h.dbPath, 0o000);
    try {
      // Kanarienvogel: die Datei ist für diesen Prozess wirklich nicht lesbar (nicht als root)
      expect(() => readFileSync(h.dbPath)).toThrow();
      const err = await failingStart(await envFor(h.dbPath, h.staticDir));
      expect(err).toContain(h.dbPath);
    } finally {
      chmodSync(h.dbPath, 0o644);
    }
    expect(readFileSync(h.dbPath).equals(bytes)).toBe(true);
  });

  test("[REQ-DB-3] Datei mit einer Migration, die dieser Server nicht kennt: kein Start, Meldung mit Pfad, Datei unverändert, kein leerer Ersatz", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await h.stop();

    // „neuerer Server lief darauf“: eine weitere Migration in der Buchführung eintragen
    const db = new BetterSqlite(h.dbPath, { fileMustExist: true });
    try {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => String(r.name))
        .find((n) => /migration/i.test(n));
      expect(table, "Migrations-Buchführung in der Datei").toBeDefined();
      const t = quoteIdent(table as string);
      const info = db.prepare(`PRAGMA table_info(${t})`).all();
      const pk = info.find((c) => Number(c.pk) === 1);
      expect(pk, "Primärschlüssel der Migrationstabelle").toBeDefined();
      const pkName = String((pk as Row).name);
      const last = db
        .prepare(`SELECT * FROM ${t} ORDER BY ${quoteIdent(pkName)} DESC LIMIT 1`)
        .all()[0];
      expect(last, "mindestens eine verbuchte Migration").toBeDefined();
      const row: Row = { ...(last as Row), [pkName]: Number((last as Row)[pkName]) + 1000 };
      for (const c of info) {
        if (/name/i.test(String(c.name))) row[String(c.name)] = "zukunft_von_neuerem_server";
      }
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO ${t} (${cols.map(quoteIdent).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ).run(...cols.map((c) => row[c]));
    } finally {
      db.close();
    }
    const bytes = readFileSync(h.dbPath);

    const err = await failingStart(await envFor(h.dbPath, h.staticDir));
    expect(err).toContain(h.dbPath);
    expect(readFileSync(h.dbPath).equals(bytes)).toBe(true);
    // die Daten sind noch da (keine leere Datenbank über die Datei gelegt)
    expect(
      allRows(h.dbPath).some((r) => Object.values(r.row).some((v) => deepEqual(jsonOf(v), OVAL))),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-DB-4 Kaputte Zeile
// ---------------------------------------------------------------------------------------------

describe("Gespeicherter Inhalt besteht sein Schema nicht", () => {
  test("[REQ-DB-4] kaputtes Layout: GET 500 GespeichertUngueltig mit Ziel, Version und Grund; Liste zeigt es mit defekt; Wert bleibt beim Lesen unverändert", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, EMPTY_FOR_OVAL);
    await putLayout(h, "Oval", 1, OVAL);
    await putLayout(h, "Heil", 0, ACHT);
    const before = (await h.call("GET", "/api/layouts")).json() as Array<Record<string, unknown>>;
    await h.stop();
    overwriteJsonColumn(h.dbPath, OVAL, '{"x":1}');
    await h.restart();

    const g = await h.call("GET", "/api/layouts/Oval");
    expect(g.status).toBe(500);
    const e = g.json() as Record<string, unknown>;
    expect(Object.keys(e).sort()).toEqual(["_tag", "reason", "version", "ziel"]);
    expect(e._tag).toBe("GespeichertUngueltig");
    expect(e.ziel).toBe("Oval");
    expect(e.version).toBe(2);
    expect(typeof e.reason).toBe("string");
    expect(String(e.reason).trim().length).toBeGreaterThan(0);

    const list = (await h.call("GET", "/api/layouts")).json() as Array<Record<string, unknown>>;
    expect(list.map((s) => s.name)).toEqual(["Heil", "Oval"]);
    const oval = list.find((s) => s.name === "Oval") as Record<string, unknown>;
    expect(oval.version).toBe(2);
    expect(oval.updatedAt).toBe(before.find((s) => s.name === "Oval")?.updatedAt);
    expect(typeof oval.defekt).toBe("string");
    expect(String(oval.defekt).trim().length).toBeGreaterThan(0);
    expect(list.find((s) => s.name === "Heil")).not.toHaveProperty("defekt");
    expect((await h.call("GET", "/api/layouts/Heil")).status).toBe(200);

    // beim Lesen weder verändert noch gelöscht
    expect(rawColumnValues(h.dbPath)).toContain('{"x":1}');
    expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(500);
    expect(rawColumnValues(h.dbPath)).toContain('{"x":1}');
  });

  test("[REQ-DB-4] kein JSON im gespeicherten Inhalt: ebenfalls 500 GespeichertUngueltig und defekt in der Liste", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await h.stop();
    overwriteJsonColumn(h.dbPath, OVAL, "kaputt{");
    await h.restart();
    const g = await h.call("GET", "/api/layouts/Oval");
    expect(g.status).toBe(500);
    expect(g.json()).toMatchObject({ _tag: "GespeichertUngueltig", ziel: "Oval", version: 1 });
    const list = (await h.call("GET", "/api/layouts")).json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(typeof (list[0] as Record<string, unknown>).defekt).toBe("string");
  });

  test("[REQ-DB-4] Reparatur: PUT und DELETE mit der Version aus der Fehlerantwort wirken normal", async () => {
    const h = await startHarness();
    await putLayout(h, "Oval", 0, OVAL);
    await putLayout(h, "Zweites", 0, ACHT);
    await h.stop();
    overwriteJsonColumn(h.dbPath, OVAL, '{"x":1}');
    overwriteJsonColumn(h.dbPath, ACHT, '{"schemaVersion":2,"elements":[]}');
    await h.restart();

    const e1 = (await h.call("GET", "/api/layouts/Oval")).json() as { version: number };
    const put = await putLayout(h, "Oval", e1.version, ACHT);
    expect(put.status).toBe(200);
    expect((put.json() as { version: number }).version).toBe(e1.version + 1);
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({ layout: ACHT });
    const list = (await h.call("GET", "/api/layouts")).json() as Array<Record<string, unknown>>;
    expect(list.find((s) => s.name === "Oval")).not.toHaveProperty("defekt");

    const e2 = (await h.call("GET", "/api/layouts/Zweites")).json() as { version: number };
    expect((await h.call("DELETE", `/api/layouts/Zweites?version=${e2.version}`)).status).toBe(204);
    expect((await h.call("GET", "/api/layouts/Zweites")).status).toBe(404);
    // falsche Version bleibt auch beim kaputten Eintrag ein Konflikt
    await h.stop();
    overwriteJsonColumn(h.dbPath, ACHT, '{"x":1}');
    await h.restart();
    expect((await putLayout(h, "Oval", 0, OVAL)).status).toBe(409);
    expect((await h.call("DELETE", "/api/layouts/Oval?version=1")).status).toBe(409);
  });

  test("[REQ-DB-4] kaputter Bestand: GET 500 GespeichertUngueltig mit Ziel bestand; PUT mit der Version aus der Antwort repariert", async () => {
    const h = await startHarness();
    await h.call("PUT", "/api/bestand", { body: { expectedVersion: 0, inventory: BESTAND } });
    await h.stop();
    overwriteJsonColumn(h.dbPath, BESTAND, '{"schemaVersion":1,"counts":{"kurve-1-90":-4}}');
    await h.restart();

    const g = await h.call("GET", "/api/bestand");
    expect(g.status).toBe(500);
    const e = g.json() as Record<string, unknown>;
    expect(e._tag).toBe("GespeichertUngueltig");
    expect(e.ziel).toBe("bestand");
    expect(e.version).toBe(1);
    expect(String(e.reason).trim().length).toBeGreaterThan(0);
    expect(rawColumnValues(h.dbPath)).toContain('{"schemaVersion":1,"counts":{"kurve-1-90":-4}}');

    const fixed = { schemaVersion: 1, counts: { "gerade-342": 2 } };
    expect(
      (await h.call("PUT", "/api/bestand", { body: { expectedVersion: 0, inventory: fixed } }))
        .status,
    ).toBe(409);
    const r = await h.call("PUT", "/api/bestand", {
      body: { expectedVersion: e.version, inventory: fixed },
    });
    expect(r.status).toBe(200);
    expect((await h.call("GET", "/api/bestand")).json()).toMatchObject({
      version: 2,
      inventory: fixed,
    });
  });
});
