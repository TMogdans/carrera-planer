/**
 * Spec M4 (.specify/specs/m4-deploy/spec.md): Wirkungsteil von REQ-DARCH-1 in `src/server`.
 * M4 ändert in `src/server` nur die Startprüfung (REQ-DATA-1), keine Migration und keine Tabelle.
 *
 * Wirkungsnachweis statt Dateivergleich: Unten steht eine eingefrorene Abschrift dessen, was der
 * Server auf dem Basisstand `05039f7` in eine neue Datenbank schreibt (Migrations-Buchführung und
 * Tabellen-DDL). (1) Eine vom aktuellen Server neu angelegte Datei muss genau so aussehen; eine
 * neue Migration oder eine geänderte Tabelle weicht ab. (2) Eine Datei im Zustand des Basisstands
 * (direkt mit der Abschrift angelegt, ein Layout und ein Bestand darin) öffnet der aktuelle Server,
 * liefert die Inhalte unverändert und lässt die Buchführung, wie sie ist. Damit gilt der Rückweg
 * aus Empfehlung 8 in beide Richtungen ohne Rücksicherung.
 *
 * Der übrige Teil von REQ-DARCH-1 (keine Datei unter src/schema, src/core, src/catalog, src/web,
 * src/server/migrations geändert; alle Tests bis M3b unverändert grün; typecheck, lint, test,
 * test:mutation grün) ist ein Diff- bzw. CI-Nachweis: der Diff des implement-PR, verify-unskip
 * auf den managed Tests und die CI-Jobs.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------------------------
// Testgerüst (eigenständig je Server-Testdatei)
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

type Reply = { readonly status: number; readonly json: () => unknown };
const call = (port: number, method: string, path: string, body?: unknown): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = { host: `localhost:${port}` };
    if (raw !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(raw.length);
    }
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers, setHost: false, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(text) as unknown });
        });
      },
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });

type Row = Record<string, unknown>;
type Statement = {
  readonly all: (...p: unknown[]) => Row[];
  readonly run: (...p: unknown[]) => unknown;
};
type Database = {
  readonly prepare: (sql: string) => Statement;
  readonly exec: (sql: string) => unknown;
  readonly close: () => void;
};
type DatabaseCtor = new (
  path: string,
  options?: { readonly readonly?: boolean; readonly fileMustExist?: boolean },
) => Database;
const requireHere = createRequire(import.meta.url);
const BetterSqlite = createRequire(requireHere.resolve("@effect/sql-sqlite-node"))(
  "better-sqlite3",
) as DatabaseCtor;

const tmpDirs: string[] = [];
const running: RunningServer[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const start = async (dbPath: string): Promise<number> => {
  const dir = mkdtempSync(join(tmpdir(), "carrera-m4-static-"));
  tmpDirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
  const port = await freePort();
  const api = await loadServer();
  running.push(
    await api.startServer(
      {
        CARRERA_HOST: "127.0.0.1",
        CARRERA_PORT: String(port),
        CARRERA_DB: dbPath,
        CARRERA_STATIC: dir,
      },
      { stdout: () => {}, stderr: () => {} },
    ),
  );
  return port;
};

const stopAll = async (): Promise<void> => {
  for (const r of running.splice(0)) await r.close();
};

const newDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "carrera-m4-darch-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, "db"));
  return join(dir, "db", "carrera.sqlite");
};

// ---------------------------------------------------------------------------------------------
// Eingefrorene Abschrift, Basisstand 05039f7 (nicht anpassen; eine gewollte Migration ist eine
// Spec-Änderung und ändert dann diesen Test über spec-to-tests)
// ---------------------------------------------------------------------------------------------

const MIGRATIONS_05039f7 = [{ migration_id: 1, name: "tabellen" }];
const TABLES_05039f7 = {
  bestand:
    "CREATE TABLE bestand ( id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), version INTEGER NOT NULL CHECK (version >= 1), updated_at TEXT NOT NULL, content TEXT NOT NULL ) STRICT",
  layouts:
    "CREATE TABLE layouts ( name TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL CHECK (version >= 1), updated_at TEXT NOT NULL, content TEXT NOT NULL ) STRICT",
};
/** Buchführung so, wie `@effect/sql` sie auf dem Basisstand anlegt. */
const MIGRATION_TABLE_05039f7 = `CREATE TABLE "effect_sql_migrations" (
  migration_id integer PRIMARY KEY NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp,
  name VARCHAR(255) NOT NULL
)`;

const squash = (sql: string): string => sql.replace(/\s+/g, " ").trim();

/** Nutztabellen (ohne SQLite-intern und ohne Buchführung) mit normalisiertem DDL. */
const tablesOf = (dbPath: string): Record<string, string> => {
  const db = new BetterSqlite(dbPath, { readonly: true, fileMustExist: true });
  try {
    return Object.fromEntries(
      db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'effect_sql_migrations' ORDER BY name",
        )
        .all()
        .map((r) => [String(r.name), squash(String(r.sql))]),
    );
  } finally {
    db.close();
  }
};

const migrationsOf = (dbPath: string): Row[] => {
  const db = new BetterSqlite(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare("SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY 1")
      .all();
  } finally {
    db.close();
  }
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
};
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8 } };

// ---------------------------------------------------------------------------------------------
// REQ-DARCH-1
// ---------------------------------------------------------------------------------------------

describe("Keine Migration, keine Tabellenänderung", () => {
  test("[REQ-DARCH-1] eine vom Server neu angelegte Datei hat genau die Migrationen und Tabellen des Basisstands 05039f7", async () => {
    const dbPath = newDbPath();
    await start(dbPath);
    await stopAll();
    expect(existsSync(dbPath)).toBe(true);
    expect(
      migrationsOf(dbPath).map((r) => ({ migration_id: r.migration_id, name: r.name })),
    ).toStrictEqual(MIGRATIONS_05039f7);
    expect(tablesOf(dbPath)).toStrictEqual(TABLES_05039f7);
  });

  test("[REQ-DARCH-1] eine Datei im Zustand des Basisstands öffnet der Server ohne Migration: Inhalte, Versionen, updatedAt und Buchführung bleiben", async () => {
    const dbPath = newDbPath();
    const updatedAt = "2026-11-01T10:00:00.000Z";
    const db = new BetterSqlite(dbPath);
    try {
      db.exec(MIGRATION_TABLE_05039f7);
      db.exec(`${TABLES_05039f7.layouts};`);
      db.exec(`${TABLES_05039f7.bestand};`);
      db.prepare(
        "INSERT INTO effect_sql_migrations (migration_id, created_at, name) VALUES (1, '2026-11-01 10:00:00', 'tabellen')",
      ).run();
      db.prepare(
        "INSERT INTO layouts (name, version, updated_at, content) VALUES ('Oval', 3, ?, ?)",
      ).run(updatedAt, JSON.stringify(OVAL));
      db.prepare("INSERT INTO bestand (id, version, updated_at, content) VALUES (1, 2, ?, ?)").run(
        updatedAt,
        JSON.stringify(BESTAND),
      );
    } finally {
      db.close();
    }
    const migrationsBefore = migrationsOf(dbPath);

    const port = await start(dbPath);
    const oval = await call(port, "GET", "/api/layouts/Oval");
    expect(oval.status).toBe(200);
    expect(oval.json()).toStrictEqual({ name: "Oval", version: 3, updatedAt, layout: OVAL });
    const bestand = await call(port, "GET", "/api/bestand");
    expect(bestand.status).toBe(200);
    expect(bestand.json()).toStrictEqual({ version: 2, updatedAt, inventory: BESTAND });
    await stopAll();

    expect(migrationsOf(dbPath)).toStrictEqual(migrationsBefore);
    expect(tablesOf(dbPath)).toStrictEqual(TABLES_05039f7);
  });
});
