/**
 * Server M3b Teil A (Spec .specify/specs/m3b-backend/spec.md): API unter `/api/…`, die gebauten
 * Frontend-Dateien und SQLite auf einem Port.
 *
 * Aufbau einer Anfrage: Host-Prüfung (REQ-SRV-7) vor allem anderen; dann `/api/…` oder statische
 * Dateien. Jede JSON-Antwort wird mit dem Schema aus dem Datenvertrag (`src/schema/api.ts`)
 * kodiert, das auch `CarreraApi` nennt. Schreibende Zugriffe sind je eine bedingte SQL-Anweisung
 * (`… WHERE version = ?`, `ON CONFLICT DO NOTHING`), damit gleichzeitige Anfragen mit derselben
 * Version genau einmal gewinnen (REQ-API-14).
 *
 * Einstieg für Tests: `startServer`; für den Prozess: `serve` (siehe `main.ts`).
 */
import { once } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { SqlClient, type SqlError } from "@effect/sql";
import * as Migrator from "@effect/sql/Migrator";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Cause, Context, Effect, Either, Exit, Layer, ParseResult, Schema, Scope } from "effect";
import {
  DeleteQuerySchema,
  FremderHost,
  GespeichertUngueltig,
  InventorySchema,
  InventoryStateSchema,
  InventoryWrittenSchema,
  LayoutPathSchema,
  LayoutSchema,
  LayoutStateSchema,
  LayoutSummarySchema,
  NichtGefunden,
  PutInventoryRequestSchema,
  PutLayoutRequestSchema,
  ServerFehler,
  STATUS_OK,
  StatusSchema,
  UngueltigeAnfrage,
  VersionKonflikt,
  ZuGross,
} from "../schema/index.js";
import { type Env, hostKey, resolveConfig } from "./config.js";
import tabellen from "./migrations/0001_tabellen.js";

export type { Env };

/**
 * Einmal gebaute Schemas: Effect legt den kompilierten Prüfer je Schema ab; ein neu gebautes
 * `Schema.parseJson(…)` je Anfrage würde ihn jedes Mal neu übersetzen (REQ-SARCH-3).
 */
const LayoutJson = Schema.parseJson(LayoutSchema);
const InventoryJson = Schema.parseJson(InventorySchema);
const PutLayoutJson = Schema.parseJson(PutLayoutRequestSchema);
const PutInventoryJson = Schema.parseJson(PutInventoryRequestSchema);
const LayoutList = Schema.Array(LayoutSummarySchema);

export type Output = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
};
export type RunningServer = { readonly close: () => Promise<void> };

// ---------------------------------------------------------------------------------------------
// Datenbank (REQ-DB-1 bis -5)
// ---------------------------------------------------------------------------------------------

/** Migrationen mit fortlaufenden IDs ab 1; die höchste bekannte ist ihre Anzahl. */
const MIGRATIONS = { "0001_tabellen": tabellen };

type Row = { readonly version: number; readonly updated_at: string; readonly content: string };
type Table = { readonly name: string; readonly key: string };
type Key = string | number;

/**
 * Öffnet die Datei (legt sie samt Verzeichnis an, wenn sie fehlt) und migriert. Scheitert laut,
 * wenn die Datei keine SQLite-Datenbank, nicht lesbar oder von einem neueren Server migriert ist;
 * die Datei wird dabei nicht verändert (REQ-DB-3).
 */
function openDatabase(path: string) {
  return Effect.gen(function* () {
    mkdirSync(dirname(path), { recursive: true });
    const context = yield* Layer.build(SqliteClient.layer({ filename: path }));
    const sql = Context.get(context, SqlClient.SqlClient);
    yield* Migrator.make({})({ loader: Migrator.fromRecord(MIGRATIONS) }).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
    );
    // Ein neuerer Server lief auf der Datei: seine Migrationen kennt dieser Stand nicht.
    const [newer] = yield* sql<{ readonly text: string }>`SELECT 'unbekannte Migration '
      || migration_id || '_' || name || ' (lief ein neuerer Server auf der Datei?)' AS text
      FROM effect_sql_migrations WHERE migration_id > ${Object.keys(MIGRATIONS).length}
      ORDER BY migration_id`;
    if (newer !== undefined) throw new Error(newer.text);
    return sql;
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.die(new Error(`Datenbank ${path} nicht nutzbar: ${Cause.squash(cause)}`)),
    ),
  );
}

function readRow(sql: SqlClient.SqlClient, table: Table, key: Key) {
  return Effect.map(
    sql<Row>`SELECT version, updated_at, content FROM ${sql(table.name)}
      WHERE ${sql(table.key)} = ${key}`,
    (rows) => rows[0],
  );
}

/** Anlegen (erwartete Version 0) oder Ändern mit Versionsbedingung; leer bei Konflikt. */
function saveRow(
  sql: SqlClient.SqlClient,
  table: Table,
  key: Key,
  expected: number,
  content: string,
) {
  const now = new Date().toISOString();
  return expected === 0
    ? sql<Row>`INSERT INTO ${sql(table.name)} (${sql(table.key)}, version, updated_at, content)
        VALUES (${key}, 1, ${now}, ${content})
        ON CONFLICT DO NOTHING RETURNING version, updated_at, content`
    : sql<Row>`UPDATE ${sql(table.name)}
        SET version = ${expected + 1}, updated_at = max(updated_at, ${now}), content = ${content}
        WHERE ${sql(table.key)} = ${key} AND version = ${expected}
        RETURNING version, updated_at, content`;
}

// ---------------------------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------------------------

class Reply {
  constructor(
    readonly status: number,
    readonly headers: http.OutgoingHttpHeaders | undefined,
    readonly body: string | Buffer | undefined,
  ) {}
}

function reply<A, I>(status: number, schema: Schema.Schema<A, I>, value: A): Reply {
  return new Reply(
    status,
    { "content-type": "application/json" },
    JSON.stringify(Schema.encodeSync(schema)(value)),
  );
}

function invalid(error: ParseResult.ParseError): Reply {
  return reply(
    400,
    UngueltigeAnfrage,
    UngueltigeAnfrage.make({ reason: ParseResult.TreeFormatter.formatErrorSync(error) }),
  );
}

function notFound(name: string): Reply {
  return reply(404, NichtGefunden, NichtGefunden.make({ name }));
}

function conflict(
  expectedVersion: number,
  aktuell: (typeof VersionKonflikt.Type)["aktuell"],
): Reply {
  return reply(409, VersionKonflikt, VersionKonflikt.make({ expectedVersion, aktuell }));
}

/** Gespeicherten JSON-Text gegen sein Schema prüfen (REQ-DB-4). */
function decodeStored<A>(row: Row, schema: Schema.Schema<A, string>) {
  return Schema.decodeEither(schema)(row.content);
}

function corrupt(row: Row, ziel: string) {
  return (error: ParseResult.ParseError) =>
    reply(
      500,
      GespeichertUngueltig,
      GespeichertUngueltig.make({
        ziel,
        version: row.version,
        reason: ParseResult.TreeFormatter.formatErrorSync(error),
      }),
    );
}

function encoded<A>(schema: Schema.Schema<A, string>, value: A): string {
  return Schema.encodeSync(schema)(value);
}

/** Körper lesen; `undefined`, sobald er 1 MiB übersteigt (der Rest wird verworfen). */
function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      chunks.push(chunk);
      if (size > 1024 * 1024) {
        chunks.length = 0;
        done(undefined);
      }
    });
    req.on("end", () => done(Buffer.concat(chunks)));
  });
}

/** JSON-Körper einer `PUT`-Anfrage: 415, 413 oder 400 als Fehler (REQ-API-13). */
function readJson<A>(req: http.IncomingMessage, schema: Schema.Schema<A, string>) {
  return Effect.gen(function* () {
    if (req.headers["content-type"] !== "application/json") {
      return yield* Effect.fail(new Reply(415, undefined, undefined));
    }
    const body = yield* Effect.promise(() => readBody(req));
    if (body === undefined) return yield* Effect.fail(reply(413, ZuGross, ZuGross.make({})));
    return yield* Either.mapLeft(Schema.decodeUnknownEither(schema)(body.toString()), invalid);
  });
}

// ---------------------------------------------------------------------------------------------
// Endpunkte
// ---------------------------------------------------------------------------------------------

const LAYOUTS: Table = { name: "layouts", key: "name" };
const BESTAND: Table = { name: "bestand", key: "id" };

function layoutState(name: string, row: Row | undefined) {
  return row === undefined
    ? null
    : Either.getOrNull(
        Either.map(decodeStored(row, LayoutJson), (layout) => ({
          name,
          version: row.version,
          updatedAt: row.updated_at,
          layout,
        })),
      );
}

/** Bestands-Stand, solange nie ein Bestand gespeichert wurde (REQ-API-11). */
function neverSaved(): typeof InventoryStateSchema.Type {
  return {
    version: 0,
    updatedAt: null,
    inventory: { schemaVersion: 1, counts: {} },
  };
}

function inventoryState(row: Row | undefined) {
  return row === undefined
    ? neverSaved()
    : Either.getOrNull(
        Either.map(decodeStored(row, InventoryJson), (inventory) => ({
          version: row.version,
          updatedAt: row.updated_at,
          inventory,
        })),
      );
}

function listLayouts(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<Row & { readonly name: string }>`SELECT name, version, updated_at,
      content FROM layouts`;
    const summaries = rows
      .map((row) =>
        Either.match(decodeStored(row, LayoutJson), {
          onLeft: (error) => ({
            name: row.name,
            version: row.version,
            updatedAt: row.updated_at,
            defekt: ParseResult.TreeFormatter.formatErrorSync(error),
          }),
          onRight: () => ({ name: row.name, version: row.version, updatedAt: row.updated_at }),
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
    return reply(200, LayoutList, summaries);
  });
}

function getLayout(sql: SqlClient.SqlClient, name: string) {
  return Effect.gen(function* () {
    const row = yield* readRow(sql, LAYOUTS, name);
    if (row === undefined) return notFound(name);
    const layout = yield* Either.mapLeft(decodeStored(row, LayoutJson), corrupt(row, name));
    return reply(200, LayoutStateSchema, {
      name,
      version: row.version,
      updatedAt: row.updated_at,
      layout,
    });
  });
}

function putLayout(sql: SqlClient.SqlClient, req: http.IncomingMessage, name: string) {
  return Effect.gen(function* () {
    const { expectedVersion, layout } = yield* readJson(req, PutLayoutJson);
    const rows = yield* saveRow(sql, LAYOUTS, name, expectedVersion, encoded(LayoutJson, layout));
    const row = rows[0];
    if (row === undefined) {
      return conflict(expectedVersion, layoutState(name, yield* readRow(sql, LAYOUTS, name)));
    }
    return reply(expectedVersion === 0 ? 201 : 200, LayoutSummarySchema, {
      name,
      version: row.version,
      updatedAt: row.updated_at,
    });
  });
}

function deleteLayout(sql: SqlClient.SqlClient, url: URL, name: string) {
  return Effect.gen(function* () {
    const { version } = yield* Either.mapLeft(
      Schema.decodeUnknownEither(DeleteQuerySchema)(Object.fromEntries(url.searchParams)),
      invalid,
    );
    const deleted = yield* sql`DELETE FROM layouts WHERE name = ${name} AND version = ${version}
      RETURNING version`;
    if (deleted.length > 0) return new Reply(204, undefined, undefined);
    const row = yield* readRow(sql, LAYOUTS, name);
    if (row === undefined) return notFound(name);
    return conflict(version, layoutState(name, row));
  });
}

function getInventory(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const row = yield* readRow(sql, BESTAND, 1);
    if (row === undefined) return reply(200, InventoryStateSchema, neverSaved());
    const inventory = yield* Either.mapLeft(
      decodeStored(row, InventoryJson),
      corrupt(row, "bestand"),
    );
    return reply(200, InventoryStateSchema, {
      version: row.version,
      updatedAt: row.updated_at,
      inventory,
    });
  });
}

function putInventory(sql: SqlClient.SqlClient, req: http.IncomingMessage) {
  return Effect.gen(function* () {
    const { expectedVersion, inventory } = yield* readJson(req, PutInventoryJson);
    const rows = yield* saveRow(
      sql,
      BESTAND,
      1,
      expectedVersion,
      encoded(InventoryJson, inventory),
    );
    const row = rows[0];
    if (row === undefined) {
      return conflict(expectedVersion, inventoryState(yield* readRow(sql, BESTAND, 1)));
    }
    return reply(200, InventoryWrittenSchema, { version: row.version, updatedAt: row.updated_at });
  });
}

type Handler = () => Effect.Effect<Reply, Reply | SqlError.SqlError>;

/** `/api/…`: Tabelle „API M3b“; alles andere 404 als JSON (REQ-API-16). */
function api(sql: SqlClient.SqlClient, req: http.IncomingMessage, url: URL) {
  return Effect.gen(function* () {
    const path = url.pathname;
    const prefix = "/api/layouts/";
    const segment = path.slice(prefix.length);
    const item = path.startsWith(prefix) && !segment.includes("/");
    const withName = (f: (name: string) => Effect.Effect<Reply, Reply | SqlError.SqlError>) =>
      Effect.flatMap(
        Either.mapLeft(
          Schema.decodeUnknownEither(
            Schema.Struct({ name: Schema.StringFromUriComponent }).pipe(
              Schema.compose(LayoutPathSchema),
            ),
          )({ name: segment }),
          invalid,
        ),
        ({ name }) => f(name),
      );
    const routes: Record<string, Handler> = {
      "GET /api/status": () => Effect.succeed(reply(200, StatusSchema, STATUS_OK)),
      "GET /api/layouts": () => listLayouts(sql),
      "GET /api/layouts/{name}": () => withName((name) => getLayout(sql, name)),
      "PUT /api/layouts/{name}": () => withName((name) => putLayout(sql, req, name)),
      "DELETE /api/layouts/{name}": () => withName((name) => deleteLayout(sql, url, name)),
      "GET /api/bestand": () => getInventory(sql),
      "PUT /api/bestand": () => putInventory(sql, req),
    };
    const route = routes[`${req.method} ${item ? "/api/layouts/{name}" : path}`];
    return route === undefined ? notFound(path) : yield* route();
  });
}

/** Gebaute Frontend-Dateien aus `CARRERA_STATIC`; nie außerhalb davon (REQ-SRV-2). */
function files(root: string, pathname: string) {
  const relative = decodeURIComponent(pathname);
  const file = resolve(root, `.${relative === "/" ? "/index.html" : relative}`);
  const missing = new Reply(
    404,
    undefined,
    "Nicht gefunden. Fehlt auch die Startseite, ist das Frontend nicht gebaut (pnpm build).",
  );
  const types: Record<string, http.OutgoingHttpHeaders> = {
    ".html": { "content-type": "text/html; charset=utf-8" },
    ".js": { "content-type": "text/javascript; charset=utf-8" },
    ".css": { "content-type": "text/css; charset=utf-8" },
    ".svg": { "content-type": "image/svg+xml" },
  };
  return file.startsWith(root + sep)
    ? Effect.match(
        Effect.tryPromise(() => readFile(file)),
        {
          onFailure: () => missing,
          onSuccess: (content) => new Reply(200, types[extname(file)], content),
        },
      )
    : Effect.succeed(missing);
}

type Deps = {
  readonly sql: SqlClient.SqlClient;
  readonly allowed: ReadonlyArray<string>;
  readonly staticRoot: string;
  readonly output: Output;
};

function handle(ctx: Deps, req: http.IncomingMessage) {
  return Effect.gen(function* () {
    const host = req.headers.host;
    if (host === undefined || !ctx.allowed.includes(hostKey(host, 80))) {
      return reply(421, FremderHost, FremderHost.make({ host: host ?? null }));
    }
    const url = new URL(String(req.url), "http://localhost");
    return yield* url.pathname.startsWith("/api/")
      ? Effect.catchIf(api(ctx.sql, req, url), (error) => error instanceof Reply, Effect.succeed)
      : files(ctx.staticRoot, url.pathname);
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        ctx.output.stderr(Cause.pretty(cause));
        return reply(
          500,
          ServerFehler,
          ServerFehler.make({ text: String(http.STATUS_CODES[500]) }),
        );
      }),
    ),
  );
}

function send(res: http.ServerResponse, answer: Reply): void {
  res.writeHead(answer.status, answer.headers);
  res.end(answer.body);
}

// ---------------------------------------------------------------------------------------------
// Start und Ende
// ---------------------------------------------------------------------------------------------

/**
 * Der ganze Server als Effekt im Scope: Datenbank offen und migriert, Port lauscht. Schließen des
 * Scopes beendet das Lauschen und schließt die Datenbank. Scheitert der Start, steht die Meldung
 * auf `output.stderr`.
 */
export function serve(env: Env, output: Output): Effect.Effect<void, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const config = resolveConfig(env);
    const existed = existsSync(config.db);
    const sql = yield* openDatabase(config.db);
    if (!existed) output.stdout(`Datenbank ${config.db} neu angelegt`);
    if (!existsSync(config.staticDir)) {
      output.stderr(
        `Warnung: ${config.staticDir} fehlt, Frontend nicht gebaut (pnpm build); die API läuft`,
      );
    }
    const ctx: Deps = { sql, allowed: config.allowed, staticRoot: config.staticDir, output };
    const server = http.createServer({ requireHostHeader: false }, (req, res) => {
      Effect.runFork(Effect.map(handle(ctx, req), (answer) => send(res, answer)));
    });
    yield* Effect.acquireRelease(
      Effect.promise(() => {
        server.listen(config.port, config.host);
        return once(server, "listening");
      }),
      () =>
        Effect.promise(() => {
          server.close();
          return once(server, "close");
        }),
    );
    output.stdout(
      `Carrera-Planer lauscht auf ${config.host}:${config.port}, Datenbank ${config.db}, erlaubte Hosts ${config.allowed}`,
    );
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.sync(() => output.stderr(String(Cause.squash(cause))))),
  );
}

/** Startet den Server; `close()` beendet das Lauschen und schließt die Datenbank. */
export async function startServer(env: Env, output: Output): Promise<RunningServer> {
  const scope = Effect.runSync(Scope.make());
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  await Effect.runPromise(Scope.extend(serve(env, output), scope)).catch(async (error: unknown) => {
    await close();
    throw error;
  });
  return { close };
}
