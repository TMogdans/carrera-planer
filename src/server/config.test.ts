/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Einstellungen und Startzeile. Abnahmetests
 * REQ-SRV-1 im Testprozess (Schnittstelle startServer wie in api.test.ts beschrieben): Startzeile
 * mit Adresse, Datenbankpfad und wirksamer Erlaubtliste; ungültiger Port bricht ab.
 *
 * Vorgabewerte (Testnachtrag): reine Funktion resolveConfig und Wirkung von Datenbankpfad und
 * statischem Verzeichnis relativ zum Arbeitsverzeichnis, siehe Abschnitt „Vorgabewerte“. Den Weg
 * über `pnpm build:server` und `pnpm start` prüft process.test.ts am echten Prozess.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

describe("Einstellungen", () => {
  test.skip("[REQ-SRV-1] nach dem Start steht auf stdout eine Zeile mit Adresse, Datenbankpfad und wirksamer Erlaubtliste", async () => {
    const h = await startHarness({ CARRERA_ALLOWED_HOSTS: "rezepte.local, pi.local:9000" });
    const P = h.port;
    const expected = [
      `127.0.0.1:${P}`, // Adresse
      h.dbPath,
      `localhost:${P}`,
      `[::1]:${P}`,
      `rezepte.local:${P}`,
      "pi.local:9000",
    ];
    const line = h.out.find((l) => expected.every((part) => l.includes(part)));
    expect(line, `keine Zeile mit ${expected.join(", ")} in:\n${h.out.join("\n")}`).toBeDefined();
    // Die Startzeile nennt die Liste, die wirkt: Gegenprobe über Anfragen
    expect((await h.call("GET", "/api/status", { host: `rezepte.local:${P}` })).status).toBe(200);
    expect((await h.call("GET", "/api/status", { host: "pi.local:9000" })).status).toBe(200);
  });

  test.skip("[REQ-SRV-1] ungültiger Port (kein ganzzahliger Wert 1–65535) bricht den Start mit Meldung ab; es lauscht nichts", async () => {
    const api = await loadServer();
    for (const value of ["0", "65536", "70000", "-1", "80.5", "abc", "8080abc", "0x1F90"]) {
      const dir = mkdtempSync(join(tmpdir(), "carrera-m3b-port-"));
      tmpDirs.push(dir);
      const err: string[] = [];
      const out: string[] = [];
      let started: RunningServer | undefined;
      let rejected = false;
      try {
        started = await api.startServer(
          {
            CARRERA_HOST: "127.0.0.1",
            CARRERA_PORT: value,
            CARRERA_DB: join(dir, "db.sqlite"),
            CARRERA_STATIC: dir,
          },
          { stdout: (l) => out.push(l), stderr: (l) => err.push(l) },
        );
      } catch {
        rejected = true;
      }
      if (started !== undefined) await started.close();
      expect(rejected, `CARRERA_PORT=${value} muss den Start abbrechen`).toBe(true);
      expect(err.join("\n"), value).toContain("CARRERA_PORT");
      expect(err.join("\n"), value).toContain(value);
    }
    // Gegenprobe: ein gültiger freier Port startet
    const ok = await startHarness();
    expect((await ok.call("GET", "/api/status")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// Testnachtrag: Vorgabewerte im Testprozess (REQ-SRV-1)
// ---------------------------------------------------------------------------------------------

/**
 * Öffentliche API (Testnachtrag, von spec-to-tests gewählt):
 * - `src/server/config.ts` exportiert die reine Funktion
 *     resolveConfig(env): { host: string; port: number; db: string; staticDir: string; … }
 *   mit der wirksamen Konfiguration nach REQ-SRV-1 (Vorgaben, wo eine Variable fehlt). Pfade
 *   dürfen relativ zum Arbeitsverzeichnis oder bereits aufgelöst sein; verglichen wird nach
 *   `path.resolve`. Weitere Felder (z. B. die Erlaubtliste) sind erlaubt. startServer nutzt sie.
 *
 * Warum zwei Formen: Host 0.0.0.0 und Port 8080 lassen sich im Testprozess nicht wirkend prüfen,
 * ohne an 8080 zu binden; dafür steht die reine Funktion. Datenbankpfad und statisches
 * Verzeichnis werden zusätzlich an der Wirkung geprüft: der echte Server startet mit einem
 * tmp-Verzeichnis als Arbeitsverzeichnis und ohne CARRERA_DB/CARRERA_STATIC; dann muss dort
 * `data/carrera-planer.sqlite` entstehen und `dist/index.html` ausgeliefert werden.
 */
type ResolvedConfig = {
  readonly host: string;
  readonly port: number;
  readonly db: string;
  readonly staticDir: string;
};
type ConfigApi = { readonly resolveConfig: (env: Env) => ResolvedConfig };
const CONFIG_MODULE = "./config.js";
const loadConfig = async (): Promise<ConfigApi> =>
  (await import(/* @vite-ignore */ new URL(CONFIG_MODULE, import.meta.url).href)) as ConfigApi;

const DEFAULTS = {
  host: "0.0.0.0",
  port: 8080,
  db: resolve("data/carrera-planer.sqlite"),
  staticDir: resolve("dist"),
};
const effective = (c: ResolvedConfig) => ({
  host: c.host,
  port: c.port,
  db: resolve(c.db),
  staticDir: resolve(c.staticDir),
});

describe("Vorgabewerte", () => {
  test.skip("[REQ-SRV-1] resolveConfig ohne Umgebungsvariablen: 0.0.0.0, 8080, data/carrera-planer.sqlite, dist", async () => {
    const { resolveConfig } = await loadConfig();
    expect(effective(resolveConfig({}))).toStrictEqual(DEFAULTS);
    // fehlende und ausdrücklich undefinierte Variablen sind dasselbe
    expect(
      effective(
        resolveConfig({
          CARRERA_HOST: undefined,
          CARRERA_PORT: undefined,
          CARRERA_DB: undefined,
          CARRERA_STATIC: undefined,
          CARRERA_ALLOWED_HOSTS: undefined,
        }),
      ),
    ).toStrictEqual(DEFAULTS);
  });

  test.skip("[REQ-SRV-1] resolveConfig: jede Variable überschreibt genau ihre Vorgabe, die anderen bleiben", async () => {
    const { resolveConfig } = await loadConfig();
    const cases: ReadonlyArray<readonly [Env, Partial<typeof DEFAULTS>]> = [
      [{ CARRERA_HOST: "127.0.0.1" }, { host: "127.0.0.1" }],
      [{ CARRERA_PORT: "9123" }, { port: 9123 }],
      [{ CARRERA_DB: "/srv/carrera/haus.sqlite" }, { db: "/srv/carrera/haus.sqlite" }],
      [{ CARRERA_DB: "anders/db.sqlite" }, { db: resolve("anders/db.sqlite") }],
      [{ CARRERA_STATIC: "/srv/carrera/web" }, { staticDir: "/srv/carrera/web" }],
      [{ CARRERA_STATIC: "build" }, { staticDir: resolve("build") }],
      [{ CARRERA_ALLOWED_HOSTS: "rezepte.local" }, {}],
    ];
    for (const [env, changed] of cases) {
      expect(effective(resolveConfig(env)), JSON.stringify(env)).toStrictEqual({
        ...DEFAULTS,
        ...changed,
      });
    }
  });

  test.skip("[REQ-SRV-1] ohne CARRERA_DB und CARRERA_STATIC wirken data/carrera-planer.sqlite und dist relativ zum Arbeitsverzeichnis", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "carrera-m3b-cwd-"));
    tmpDirs.push(cwd);
    const marker = "Carrera-dist-im-Arbeitsverzeichnis-4b8e";
    mkdirSync(join(cwd, "dist"));
    writeFileSync(join(cwd, "dist", "index.html"), `<!doctype html><title>${marker}</title>`);
    const before = process.cwd();
    process.chdir(cwd);
    try {
      const h = await startHarness({ CARRERA_DB: undefined, CARRERA_STATIC: undefined });
      const dbFile = join(cwd, "data", "carrera-planer.sqlite");
      expect(existsSync(dbFile)).toBe(true);
      expect(existsSync(h.dbPath)).toBe(false); // nicht der Pfad des Gerüsts
      const put = await h.call("PUT", "/api/layouts/Oval", {
        body: { expectedVersion: 0, layout: { schemaVersion: 1, elements: [] } },
      });
      expect(put.status).toBe(201);
      await h.stop();
      // die Änderung steht in genau dieser Datei
      await h.restart();
      expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(200);
      expect(readFileSync(dbFile).subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");

      const index = await h.call("GET", "/");
      expect(index.status).toBe(200);
      expect(index.text).toContain(marker);
      expect(index.text).not.toContain(INDEX_MARKER);
      await h.stop();
    } finally {
      process.chdir(before);
    }
  });
});
