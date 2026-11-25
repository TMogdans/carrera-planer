/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Versionsprüfung unter Last und als
 * Eigenschaft. Abnahmetests REQ-API-14 (Wettlauf) und REQ-API-15 (Eigenschaft über Folgen).
 *
 * Wettlauf: die Anfragen gehen gleichzeitig über getrennte Verbindungen an den echten Server
 * (Schnittstelle startServer wie in api.test.ts beschrieben). Ein Wettlauf lässt sich nicht
 * erzwingen; jeder Fall läuft deshalb in mehreren Runden. Ein Server, der zwischen Lesen der
 * Version und Schreiben die Kontrolle abgibt (z. B. SELECT, dann UPDATE ohne Bedingung in zwei
 * Effekten), lässt hier mehr als eine Anfrage gewinnen.
 *
 * Eigenschaft: fast-check erzeugt Folgen aus Anlegen, Ändern, Löschen und Bestand-Schreiben mit
 * richtigen und falschen Versionen; Layouts und Bestände kommen aus den Schemas (Arbitrary.make,
 * Constitution). Ein Modell sagt jede Antwort voraus; nach jedem Schritt wird der ganze Zustand
 * über die API mit dem Modell verglichen. Je Lauf ein frischer Server mit frischer Datei.
 * Teil-IDs `__proto__` sind aus dem Bestandsgenerator ausgenommen (Eigenheit von JavaScript-
 * Objekten, kein Gegenstand dieser Spec).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Arbitrary, FastCheck, type Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import * as schemaModule from "../schema/index.js";

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

type LayoutElement =
  | { readonly id: string; readonly part: string; readonly turn?: "links" | "rechts" }
  | { readonly id: string; readonly crosses: string };
type Layout = { readonly schemaVersion: 1; readonly elements: ReadonlyArray<LayoutElement> };
type Inventory = { readonly schemaVersion: 1; readonly counts: Readonly<Record<string, number>> };

const schemas = schemaModule as unknown as {
  readonly LayoutSchema: Schema.Schema<Layout, unknown>;
  readonly InventorySchema: Schema.Schema<Inventory, unknown>;
};

const layoutNo = (i: number): Layout => ({
  schemaVersion: 1,
  elements: [
    { id: `w${i}`, part: "gerade-342" },
    { id: `k${i}`, part: "kurve-1-90", turn: i % 2 === 0 ? "links" : "rechts" },
  ],
});
const inventoryNo = (i: number): Inventory => ({
  schemaVersion: 1,
  counts: { "kurve-1-90": i, [`teil-${i}`]: 1 },
});

const putLayout = (h: Harness, name: string, expectedVersion: number, layout: unknown) =>
  h.call("PUT", `/api/layouts/${enc(name)}`, { body: { expectedVersion, layout } });

const ROUNDS = 5;
const N = 10;

const countStatus = (rs: ReadonlyArray<Reply>, s: number): number =>
  rs.filter((r) => r.status === s).length;

// ---------------------------------------------------------------------------------------------
// REQ-API-14 Wettlauf
// ---------------------------------------------------------------------------------------------

describe("Wettlauf", () => {
  test("[REQ-API-14] 10 gleichzeitige PUT mit derselben Version auf dasselbe Layout: genau eine 200, neun 409, Version + 1, Inhalt des Gewinners", async () => {
    const h = await startHarness();
    for (let round = 0; round < ROUNDS; round++) {
      const name = `Rennen ${round}`;
      expect((await putLayout(h, name, 0, layoutNo(-1))).status).toBe(201);
      const rs = await Promise.all(
        Array.from({ length: N }, (_, i) => putLayout(h, name, 1, layoutNo(i))),
      );
      expect(countStatus(rs, 200), `Runde ${round}`).toBe(1);
      expect(countStatus(rs, 409), `Runde ${round}`).toBe(N - 1);
      const winner = rs.findIndex((r) => r.status === 200);
      const g = (await h.call("GET", `/api/layouts/${enc(name)}`)).json() as {
        version: number;
        layout: Layout;
      };
      expect(g.version).toBe(2);
      expect(g.layout).toStrictEqual(layoutNo(winner));
    }
  });

  test("[REQ-API-14] 10 gleichzeitige PUT mit Version 0 auf einen neuen Namen: genau eine 201, neun 409, Version 1", async () => {
    const h = await startHarness();
    for (let round = 0; round < ROUNDS; round++) {
      const name = `Neu ${round}`;
      const rs = await Promise.all(
        Array.from({ length: N }, (_, i) => putLayout(h, name, 0, layoutNo(i))),
      );
      expect(countStatus(rs, 201), `Runde ${round}`).toBe(1);
      expect(countStatus(rs, 409), `Runde ${round}`).toBe(N - 1);
      const winner = rs.findIndex((r) => r.status === 201);
      expect((await h.call("GET", `/api/layouts/${enc(name)}`)).json()).toMatchObject({
        version: 1,
        layout: layoutNo(winner),
      });
    }
    const list = (await h.call("GET", "/api/layouts")).json() as unknown[];
    expect(list).toHaveLength(ROUNDS);
  });

  test("[REQ-API-14] 10 gleichzeitige PUT /api/bestand mit derselben Version: genau eine 200, neun 409, Version + 1, Inhalt des Gewinners", async () => {
    const h = await startHarness();
    for (let round = 0; round < ROUNDS; round++) {
      const rs = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          h.call("PUT", "/api/bestand", {
            body: { expectedVersion: round, inventory: inventoryNo(round * 100 + i) },
          }),
        ),
      );
      expect(countStatus(rs, 200), `Runde ${round}`).toBe(1);
      expect(countStatus(rs, 409), `Runde ${round}`).toBe(N - 1);
      const winner = rs.findIndex((r) => r.status === 200);
      expect((await h.call("GET", "/api/bestand")).json()).toMatchObject({
        version: round + 1,
        inventory: inventoryNo(round * 100 + winner),
      });
    }
  });

  test("[REQ-API-14] gleichzeitiges PUT und DELETE mit derselben Version: genau eine gewinnt, der Zustand passt zum Gewinner", async () => {
    const h = await startHarness();
    let putWins = 0;
    let deleteWins = 0;
    for (let round = 0; round < 20; round++) {
      const name = `Streit ${round}`;
      await putLayout(h, name, 0, layoutNo(0));
      const [put, del] = await Promise.all([
        putLayout(h, name, 1, layoutNo(1)),
        h.call("DELETE", `/api/layouts/${enc(name)}?version=1`),
      ]);
      const ok = [put.status === 200, del.status === 204];
      expect(
        ok.filter(Boolean),
        `Runde ${round}: PUT ${put.status}, DELETE ${del.status}`,
      ).toHaveLength(1);
      const g = await h.call("GET", `/api/layouts/${enc(name)}`);
      if (put.status === 200) {
        putWins++;
        expect(del.status).toBe(409);
        expect(g.json()).toMatchObject({ version: 2, layout: layoutNo(1) });
      } else {
        deleteWins++;
        expect(put.status).toBe(409);
        expect((put.json() as { aktuell: unknown }).aktuell).toBeNull();
        expect(g.status).toBe(404);
      }
    }
    expect(putWins + deleteWins).toBe(20);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-15 Eigenschaft
// ---------------------------------------------------------------------------------------------

type Stand = { version: number; updatedAt: string; layout: Layout };
type Model = {
  layouts: Map<string, Stand>;
  bestand: { version: number; updatedAt: string | null; inventory: Inventory };
};

type Command =
  | {
      readonly kind: "putLayout";
      readonly name: string;
      readonly layout: Layout;
      readonly off: number;
    }
  | { readonly kind: "delete"; readonly name: string; readonly off: number }
  | { readonly kind: "putBestand"; readonly inventory: Inventory; readonly off: number };

const NAMES = ["Oval", "Acht / groß", "a:b", "100%"];
/** Versatz zur richtigen Version: 0 = richtig, sonst falsch. */
const offArb = FastCheck.oneof(
  { weight: 3, arbitrary: FastCheck.constant(0) },
  { weight: 2, arbitrary: FastCheck.integer({ min: -3, max: 3 }) },
);
const inventoryArb = Arbitrary.make(schemas.InventorySchema).filter(
  (inv) => !Object.keys(inv.counts).includes("__proto__"),
);
const commandArb: FastCheck.Arbitrary<Command> = FastCheck.oneof(
  FastCheck.record({
    kind: FastCheck.constant("putLayout" as const),
    name: FastCheck.constantFrom(...NAMES),
    layout: Arbitrary.make(schemas.LayoutSchema),
    off: offArb,
  }),
  FastCheck.record({
    kind: FastCheck.constant("delete" as const),
    name: FastCheck.constantFrom(...NAMES),
    off: offArb,
  }),
  FastCheck.record({
    kind: FastCheck.constant("putBestand" as const),
    inventory: inventoryArb,
    off: offArb,
  }),
);

/** So, wie der Wert auf der Leitung ankommt (z. B. fällt ein Feld mit `undefined` weg). */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const sortNames = (names: string[]): string[] =>
  [...names].sort((a, b) => a.localeCompare(b, "de"));

/** Ganzer Zustand über die API gegen das Modell. */
const checkState = async (h: Harness, m: Model, step: string): Promise<void> => {
  const list = (await h.call("GET", "/api/layouts")).json() as Array<Record<string, unknown>>;
  expect(
    [...list].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    step,
  ).toStrictEqual(
    [...m.layouts.entries()]
      .map(([name, s]) => ({ name, version: s.version, updatedAt: s.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  expect(
    list.map((s) => s.name),
    step,
  ).toEqual(sortNames(list.map((s) => String(s.name))));
  for (const name of NAMES) {
    const g = await h.call("GET", `/api/layouts/${enc(name)}`);
    const s = m.layouts.get(name);
    if (s === undefined) {
      expect(g.status, `${step}: ${name}`).toBe(404);
    } else {
      expect(g.status, `${step}: ${name}`).toBe(200);
      expect(g.json(), `${step}: ${name}`).toStrictEqual({ name, ...s });
    }
  }
  expect((await h.call("GET", "/api/bestand")).json(), step).toStrictEqual(m.bestand);
};

const runCommand = async (h: Harness, m: Model, c: Command, step: string): Promise<void> => {
  if (c.kind === "putLayout") {
    const current = m.layouts.get(c.name)?.version ?? 0;
    const sent = Math.max(0, current + c.off);
    const r = await putLayout(h, c.name, sent, c.layout);
    if (sent === current) {
      expect(r.status, step).toBe(current === 0 ? 201 : 200);
      const b = r.json() as { name: string; version: number; updatedAt: string };
      expect(b.name, step).toBe(c.name);
      expect(b.version, step).toBe(current + 1);
      const old = m.layouts.get(c.name);
      if (old !== undefined) expect(b.updatedAt >= old.updatedAt, step).toBe(true);
      m.layouts.set(c.name, { version: b.version, updatedAt: b.updatedAt, layout: wire(c.layout) });
    } else {
      expect(r.status, step).toBe(409);
    }
  } else if (c.kind === "delete") {
    const current = m.layouts.get(c.name)?.version;
    const sent = Math.max(1, (current ?? 1) + c.off);
    const r = await h.call("DELETE", `/api/layouts/${enc(c.name)}?version=${sent}`);
    if (current === undefined) {
      expect(r.status, step).toBe(404);
    } else if (sent === current) {
      expect(r.status, step).toBe(204);
      m.layouts.delete(c.name);
    } else {
      expect(r.status, step).toBe(409);
    }
  } else {
    const current = m.bestand.version;
    const sent = Math.max(0, current + c.off);
    const r = await h.call("PUT", "/api/bestand", {
      body: { expectedVersion: sent, inventory: c.inventory },
    });
    if (sent === current) {
      expect(r.status, step).toBe(200);
      const b = r.json() as { version: number; updatedAt: string };
      expect(b.version, step).toBe(current + 1);
      if (m.bestand.updatedAt !== null) expect(b.updatedAt >= m.bestand.updatedAt, step).toBe(true);
      m.bestand = { version: b.version, updatedAt: b.updatedAt, inventory: wire(c.inventory) };
    } else {
      expect(r.status, step).toBe(409);
    }
  }
};

describe("Eigenschaft", () => {
  test("[REQ-API-15] beliebige Folgen aus Anlegen, Ändern, Löschen und Bestand-Schreiben: GET liefert den Inhalt, Version + 1 je Erfolg, Ablehnungen ändern nichts", async () => {
    await FastCheck.assert(
      FastCheck.asyncProperty(
        FastCheck.array(commandArb, { minLength: 1, maxLength: 12 }),
        async (commands) => {
          const h = await startHarness();
          try {
            const m: Model = {
              layouts: new Map(),
              bestand: { version: 0, updatedAt: null, inventory: { schemaVersion: 1, counts: {} } },
            };
            await checkState(h, m, "Anfang");
            for (const [i, c] of commands.entries()) {
              const step = `Schritt ${i}: ${c.kind} ${"name" in c ? c.name : ""} Versatz ${c.off}`;
              await runCommand(h, m, c, step);
              await checkState(h, m, step);
            }
          } finally {
            await h.stop();
          }
        },
      ),
      { numRuns: 30 },
    );
  }, 120_000);
});
