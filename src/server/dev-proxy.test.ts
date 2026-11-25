/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Dev-Proxy. Abnahmetest REQ-SRV-6.
 *
 * Wirkungsnachweis: Der echte Server läuft im Testprozess (Schnittstelle startServer wie in
 * api.test.ts beschrieben) auf Port P mit der Vorgabe-Erlaubtliste. Daneben startet Vites
 * Dev-Server mit der echten `vite.config.ts` (`CARRERA_PORT` = P). Eine Anfrage an Vite unter
 * `/api/status` muss beim Server ankommen und 200 liefern. Weil der Server nur
 * `localhost:P`/`127.0.0.1:P`/`[::1]:P` annimmt, beweist das 200 zugleich `changeOrigin: true`:
 * die Gegenprobe zeigt, dass der Server die Host-Angabe des Dev-Servers (`localhost:<Vite-Port>`)
 * mit 421 ablehnt. Die Vorgabe 8080 ohne `CARRERA_PORT` wird an der aufgelösten Konfiguration
 * abgelesen (ein Server auf 8080 wäre für den Test nicht verlässlich frei).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

const VITE_CONFIG = fileURLToPath(new URL("../../vite.config.ts", import.meta.url));

type ViteDevServer = {
  readonly listen: () => Promise<unknown>;
  readonly close: () => Promise<void>;
};
type ProxyEntry = string | { readonly target?: unknown; readonly changeOrigin?: unknown };
type ResolvedConfig = {
  readonly server: { readonly proxy?: Readonly<Record<string, ProxyEntry>> };
};
type ViteApi = {
  readonly createServer: (config: Record<string, unknown>) => Promise<ViteDevServer>;
  readonly resolveConfig: (
    config: Record<string, unknown>,
    command: "serve" | "build",
  ) => Promise<ResolvedConfig>;
};

const withCarreraPort = async <T>(value: string | undefined, f: () => Promise<T>): Promise<T> => {
  const saved = process.env.CARRERA_PORT;
  if (value === undefined) delete process.env.CARRERA_PORT;
  else process.env.CARRERA_PORT = value;
  try {
    return await f();
  } finally {
    if (saved === undefined) delete process.env.CARRERA_PORT;
    else process.env.CARRERA_PORT = saved;
  }
};

const viteServers: ViteDevServer[] = [];
afterEach(async () => {
  for (const v of viteServers.splice(0)) await v.close();
});

describe("Dev-Proxy", () => {
  test("[REQ-SRV-6] pnpm dev leitet /api an den Server auf CARRERA_PORT weiter; beim Server kommt Host localhost:P an (changeOrigin)", async () => {
    const vite = (await import("vite")) as unknown as ViteApi;
    // Server mit Vorgabe-Host (0.0.0.0) wie bei pnpm start
    const h = await startHarness({ CARRERA_HOST: "0.0.0.0" });
    expect(
      (
        await h.call("PUT", "/api/layouts/Oval", {
          body: { expectedVersion: 0, layout: { schemaVersion: 1, elements: [] } },
        })
      ).status,
    ).toBe(201);
    const vitePort = await freePort();
    const dev = await withCarreraPort(String(h.port), () =>
      vite.createServer({
        configFile: VITE_CONFIG,
        logLevel: "silent",
        server: { port: vitePort, strictPort: true, host: "127.0.0.1", hmr: false },
      }),
    );
    viteServers.push(dev);
    await dev.listen();

    const viaVite = await call(vitePort, "GET", "/api/status", { host: `localhost:${vitePort}` });
    expect(viaVite.status).toBe(200);
    expect(viaVite.json()).toStrictEqual({ status: "ok" });
    const list = await call(vitePort, "GET", "/api/layouts", { host: `localhost:${vitePort}` });
    expect(list.status).toBe(200);
    expect((list.json() as Array<{ name: string }>).map((s) => s.name)).toEqual(["Oval"]);

    // Gegenprobe: ohne Umschreiben käme Host localhost:<Vite-Port> an, und das lehnt der Server ab
    const direct = await h.call("GET", "/api/status", { host: `localhost:${vitePort}` });
    expect(direct.status).toBe(421);
  }, 30_000);

  test("[REQ-SRV-6] ohne CARRERA_PORT zielt der Proxy auf http://localhost:8080 mit changeOrigin", async () => {
    const vite = (await import("vite")) as unknown as ViteApi;
    const resolved = await withCarreraPort(undefined, () =>
      vite.resolveConfig({ configFile: VITE_CONFIG, logLevel: "silent" }, "serve"),
    );
    const entry = resolved.server.proxy?.["/api"];
    expect(entry).toBeDefined();
    expect(typeof entry === "object" ? entry.target : entry).toBe("http://localhost:8080");
    expect(typeof entry === "object" ? entry.changeOrigin : undefined).toBe(true);

    const withPort = await withCarreraPort("9123", () =>
      vite.resolveConfig({ configFile: VITE_CONFIG, logLevel: "silent" }, "serve"),
    );
    const e2 = withPort.server.proxy?.["/api"];
    expect(typeof e2 === "object" ? e2.target : e2).toBe("http://localhost:9123");
  }, 30_000);
});
