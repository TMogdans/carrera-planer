/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Wirkung der `HttpApi`-Definition gegen
 * den echten Server. Abnahmetests REQ-API-4 (Testnachtrag 2).
 *
 * `src/schema/http-api.ts` (`CarreraApi`) ist der Vertrag der Tabelle „API M3b“. Ob er stimmt,
 * zeigt sich erst am Draht:
 * 1. Ein `HttpApiClient` aus `CarreraApi` (mit `FetchHttpClient`) spricht einen echten Server
 *    (startServer wie in api.test.ts) und legt mit allen fünf Beispielnamen aus REQ-API-1 an,
 *    ändert, liest, listet und löscht. Scheitert der Client an einem Namen (Pfadkodierung), an
 *    einem Statuscode (z. B. 201 im Vertrag anders deklariert) oder an einem Schema (vertauschte
 *    Payloads oder Erfolgsschemas), wird der Test rot.
 * 2. Für jede Zeile der Tabelle (Erfolg und Fehler, auch 421 bei fremdem Host) wird eine echte
 *    Anfrage gestellt; der Statuscode am Draht muss im Vertrag für diesen Endpunkt deklariert sein,
 *    und der Körper muss mit dem dort deklarierten Schema dekodieren (leer, wo der Vertrag keinen
 *    Körper deklariert). Gültige Anfragekörper müssen mit dem deklarierten Payload-Schema
 *    dekodieren.
 * Endpunkte werden über `HttpApi.reflect` nach Methode und Pfad gefunden, nicht über ihre Namen.
 *
 * Nicht abgedeckt: 500 `GespeichertUngueltig` (kaputte Zeile, siehe storage.test.ts) und 500
 * `ServerFehler` (siehe api.test.ts, REQ-SRV-4).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FetchHttpClient, HttpApi, HttpApiClient, type HttpClient } from "@effect/platform";
import { Effect, Either, Option, Schema, type SchemaAST } from "effect";
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

const HTTP_API_MODULE = "../schema/http-api.js";
type AnyApi = Parameters<typeof HttpApi.reflect>[0];
const loadApi = async (): Promise<AnyApi> => {
  const mod = (await import(/* @vite-ignore */ new URL(HTTP_API_MODULE, import.meta.url).href)) as {
    readonly CarreraApi?: AnyApi;
  };
  if (mod.CarreraApi === undefined)
    throw new Error("src/schema/http-api.ts exportiert CarreraApi nicht");
  return mod.CarreraApi;
};

type Members = ReadonlyMap<number, { readonly ast: Option.Option<SchemaAST.AST> }>;
type Contract = {
  readonly group: string;
  readonly name: string;
  readonly successes: Members;
  readonly errors: Members;
  readonly payloads: ReadonlyMap<string, { readonly ast: SchemaAST.AST }>;
};

/** Vertrag je „METHODE /pfad“ (Pfad mit `:name`). */
const contractOf = (api: AnyApi): Map<string, Contract> => {
  const out = new Map<string, Contract>();
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, successes, errors, payloads }) => {
      out.set(`${endpoint.method} ${endpoint.path}`, {
        group: group.identifier,
        name: endpoint.name,
        successes,
        errors,
        payloads,
      });
    },
  });
  return out;
};

const NAMES = ["Oval", "Acht / groß", "a:b", "100%", "a".repeat(200)];
const OVAL = {
  schemaVersion: 1,
  elements: [
    { id: "o1", part: "kurve-1-90", turn: "links" },
    { id: "o2", part: "gerade-342" },
  ],
} as const;
const ACHT = {
  schemaVersion: 1,
  elements: [
    { id: "e1", part: "kreuzung" },
    { id: "e2", crosses: "e1" },
  ],
} as const;
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gibt-es-nicht": 3 } } as const;

type ClientFn = (request: unknown) => Effect.Effect<unknown, unknown>;
type Client = Record<string, Record<string, ClientFn>>;

describe("Vertrag am Draht", () => {
  test("[REQ-API-4] HttpApiClient aus CarreraApi: Anlegen, Ändern, Lesen, Liste und Löschen mit allen Beispielnamen aus REQ-API-1 gegen den echten Server", async () => {
    const api = await loadApi();
    const contract = contractOf(api);
    const h = await startHarness();
    const fn = (client: Client, key: string): ClientFn => {
      const c = contract.get(key);
      expect(c, `Endpunkt ${key} im Vertrag`).toBeDefined();
      const f = client[(c as Contract).group]?.[(c as Contract).name];
      expect(f, `Client-Funktion für ${key}`).toBeDefined();
      return f as ClientFn;
    };
    const run = <A>(f: (client: Client) => Effect.Effect<A, unknown>): Promise<A> =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* HttpApiClient.make(api as never, {
            baseUrl: `http://127.0.0.1:${h.port}`,
          }) as unknown as Effect.Effect<Client, never, HttpClient.HttpClient>;
          return yield* f(client);
        }).pipe(Effect.provide(FetchHttpClient.layer)),
      );
    const attempt = (f: (client: Client) => Effect.Effect<unknown, unknown>) =>
      run((client) => Effect.either(f(client)));

    for (const name of NAMES) {
      const label = JSON.stringify(
        name.length > 20 ? `${name.slice(0, 5)}…(${name.length})` : name,
      );
      const created = (await run((c) =>
        fn(
          c,
          "PUT /api/layouts/:name",
        )({ path: { name }, payload: { expectedVersion: 0, layout: OVAL } }),
      )) as { name: string; version: number };
      expect(created.name, label).toBe(name);
      expect(created.version, label).toBe(1);

      const changed = (await run((c) =>
        fn(
          c,
          "PUT /api/layouts/:name",
        )({ path: { name }, payload: { expectedVersion: 1, layout: ACHT } }),
      )) as { version: number };
      expect(changed.version, label).toBe(2);

      const state = (await run((c) => fn(c, "GET /api/layouts/:name")({ path: { name } }))) as {
        name: string;
        version: number;
        layout: unknown;
      };
      expect(state.name, label).toBe(name);
      expect(state.version, label).toBe(2);
      expect(JSON.parse(JSON.stringify(state.layout)), label).toStrictEqual(ACHT);

      const list = (await run((c) => fn(c, "GET /api/layouts")({}))) as ReadonlyArray<{
        name: string;
      }>;
      expect(
        list.map((s) => s.name),
        label,
      ).toContain(name);

      // Konflikt kommt als Fehler des Vertrags an
      const conflict = await attempt((c) =>
        fn(
          c,
          "PUT /api/layouts/:name",
        )({ path: { name }, payload: { expectedVersion: 1, layout: OVAL } }),
      );
      expect(Either.isLeft(conflict), label).toBe(true);
      expect(
        (Either.isLeft(conflict) ? conflict.left : {}) as { _tag?: string },
        label,
      ).toMatchObject({
        _tag: "VersionKonflikt",
      });

      await run((c) =>
        fn(c, "DELETE /api/layouts/:name")({ path: { name }, urlParams: { version: 2 } }),
      );
      const gone = await attempt((c) => fn(c, "GET /api/layouts/:name")({ path: { name } }));
      expect(Either.isLeft(gone), label).toBe(true);
      expect(
        (Either.isLeft(gone) ? gone.left : {}) as { _tag?: string; name?: string },
        label,
      ).toMatchObject({
        _tag: "NichtGefunden",
        name,
      });
      // auch am Draht: genau dieser Name ist weg
      expect((await h.call("GET", `/api/layouts/${enc(name)}`)).status, label).toBe(404);
    }

    // Status und Bestand über denselben Client
    expect(await run((c) => fn(c, "GET /api/status")({}))).toStrictEqual({ status: "ok" });
    const written = (await run((c) =>
      fn(c, "PUT /api/bestand")({ payload: { expectedVersion: 0, inventory: BESTAND } }),
    )) as { version: number };
    expect(written.version).toBe(1);
    const bestand = (await run((c) => fn(c, "GET /api/bestand")({}))) as { inventory: unknown };
    expect(JSON.parse(JSON.stringify(bestand.inventory))).toStrictEqual(BESTAND);
  }, 30_000);

  test("[REQ-API-4] jede Antwort am Draht ist im Vertrag deklariert: Statuscode je Endpunkt und Körper nach dem deklarierten Schema; gültige Anfragen passen zum Payload-Schema", async () => {
    const contract = contractOf(await loadApi());
    const h = await startHarness();
    const P = h.port;
    const foreign = `evil.example:${P}`;
    const MiB = 1024 * 1024;
    const tooBig = Buffer.concat([
      Buffer.from(JSON.stringify({ expectedVersion: 1, layout: OVAL })),
      Buffer.alloc(MiB, " "),
    ]);

    type Case = {
      readonly key: string;
      readonly method: string;
      readonly path: string;
      readonly expected: number;
      readonly o?: CallOptions;
      readonly validPayload?: unknown;
    };
    const putL = { expectedVersion: 0, layout: OVAL };
    const cases: ReadonlyArray<Case> = [
      { key: "GET /api/status", method: "GET", path: "/api/status", expected: 200 },
      { key: "GET /api/layouts", method: "GET", path: "/api/layouts", expected: 200 },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Oval",
        expected: 201,
        o: { body: putL },
        validPayload: putL,
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Oval",
        expected: 200,
        o: { body: { expectedVersion: 1, layout: ACHT } },
        validPayload: { expectedVersion: 1, layout: ACHT },
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Oval",
        expected: 409,
        o: { body: putL },
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Oval",
        expected: 400,
        o: { body: { expectedVersion: -1, layout: OVAL } },
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/%20Oval",
        expected: 400,
        o: { body: putL },
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Oval",
        expected: 413,
        o: { body: tooBig },
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Oval",
        expected: 415,
        o: { body: JSON.stringify(putL), contentType: "text/plain" },
      },
      {
        key: "PUT /api/layouts/:name",
        method: "PUT",
        path: "/api/layouts/Neu",
        expected: 421,
        o: { body: putL, host: foreign },
      },
      { key: "GET /api/layouts/:name", method: "GET", path: "/api/layouts/Oval", expected: 200 },
      { key: "GET /api/layouts/:name", method: "GET", path: "/api/layouts/Nie", expected: 404 },
      { key: "GET /api/layouts/:name", method: "GET", path: "/api/layouts/%20Oval", expected: 400 },
      {
        key: "GET /api/layouts/:name",
        method: "GET",
        path: "/api/layouts/Oval",
        expected: 421,
        o: { host: foreign },
      },
      {
        key: "GET /api/layouts",
        method: "GET",
        path: "/api/layouts",
        expected: 421,
        o: { host: foreign },
      },
      {
        key: "GET /api/status",
        method: "GET",
        path: "/api/status",
        expected: 421,
        o: { host: foreign },
      },
      {
        key: "DELETE /api/layouts/:name",
        method: "DELETE",
        path: "/api/layouts/Oval?version=1",
        expected: 409,
      },
      {
        key: "DELETE /api/layouts/:name",
        method: "DELETE",
        path: "/api/layouts/Oval?version=abc",
        expected: 400,
      },
      {
        key: "DELETE /api/layouts/:name",
        method: "DELETE",
        path: "/api/layouts/Nie?version=1",
        expected: 404,
      },
      {
        key: "DELETE /api/layouts/:name",
        method: "DELETE",
        path: "/api/layouts/Oval?version=2",
        expected: 421,
        o: { host: foreign },
      },
      {
        key: "DELETE /api/layouts/:name",
        method: "DELETE",
        path: "/api/layouts/Oval?version=2",
        expected: 204,
      },
      { key: "GET /api/bestand", method: "GET", path: "/api/bestand", expected: 200 },
      {
        key: "PUT /api/bestand",
        method: "PUT",
        path: "/api/bestand",
        expected: 200,
        o: { body: { expectedVersion: 0, inventory: BESTAND } },
        validPayload: { expectedVersion: 0, inventory: BESTAND },
      },
      {
        key: "PUT /api/bestand",
        method: "PUT",
        path: "/api/bestand",
        expected: 409,
        o: { body: { expectedVersion: 0, inventory: BESTAND } },
      },
      {
        key: "PUT /api/bestand",
        method: "PUT",
        path: "/api/bestand",
        expected: 400,
        o: { body: "kaputt" },
      },
      {
        key: "PUT /api/bestand",
        method: "PUT",
        path: "/api/bestand",
        expected: 413,
        o: { body: tooBig },
      },
      {
        key: "PUT /api/bestand",
        method: "PUT",
        path: "/api/bestand",
        expected: 415,
        o: { body: "{}", contentType: "text/plain" },
      },
      {
        key: "PUT /api/bestand",
        method: "PUT",
        path: "/api/bestand",
        expected: 421,
        o: { body: { expectedVersion: 1, inventory: BESTAND }, host: foreign },
      },
      {
        key: "GET /api/bestand",
        method: "GET",
        path: "/api/bestand",
        expected: 421,
        o: { host: foreign },
      },
    ];

    for (const c of cases) {
      const label = `${c.method} ${c.path} (${c.expected})`;
      const endpoint = contract.get(c.key);
      expect(endpoint, `${c.key} im Vertrag`).toBeDefined();
      const e = endpoint as Contract;
      const r = await h.call(c.method, c.path, c.o);
      // 1. Draht wie in der Spec-Tabelle (Kanarienvogel: das Szenario trifft den Fall wirklich)
      expect(r.status, label).toBe(c.expected);
      // 2. derselbe Status ist im Vertrag dieses Endpunkts deklariert
      const member = r.status < 400 ? e.successes.get(r.status) : e.errors.get(r.status);
      expect(
        member,
        `${label}: Status ${r.status} nicht im Vertrag (${[...e.successes.keys(), ...e.errors.keys()].join(", ")})`,
      ).toBeDefined();
      // 3. der Körper passt zum deklarierten Schema (bzw. ist leer, wo keines deklariert ist)
      const ast = (member as { ast: Option.Option<SchemaAST.AST> }).ast;
      if (Option.isNone(ast)) {
        expect(r.text, label).toBe("");
      } else {
        const decoded = Schema.decodeUnknownEither(Schema.make(ast.value))(JSON.parse(r.text));
        expect(
          Either.isRight(decoded),
          `${label}: Körper passt nicht zum Vertrag: ${r.text.slice(0, 200)}`,
        ).toBe(true);
      }
      // 4. gültige Anfragekörper passen zum deklarierten Payload-Schema
      if (c.validPayload !== undefined) {
        const payloads = [...e.payloads.values()];
        expect(payloads.length, `${label}: Payload im Vertrag`).toBeGreaterThan(0);
        expect(
          payloads.some((p) =>
            Either.isRight(Schema.decodeUnknownEither(Schema.make(p.ast))(c.validPayload)),
          ),
          `${label}: gültige Anfrage passt nicht zum Payload-Schema`,
        ).toBe(true);
      }
    }
  }, 30_000);
});
