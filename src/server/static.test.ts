/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Auslieferung der gebauten Frontend-Dateien
 * auf demselben Port wie die API. Abnahmetests REQ-SRV-2 (Entscheidung 5).
 *
 * Statt `pnpm build` legt der Test ein kleines Verzeichnis in der Form der Vite-Ausgabe an
 * (`index.html`, `assets/*.js`, `assets/*.css`, eine SVG-Datei) und daneben, außerhalb davon, eine
 * `package.json` mit Erkennungsmarke. Der Server läuft wie in api.test.ts beschrieben.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
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

const SECRET = "geheim-ausserhalb-von-static-91c2";
const JS = 'console.log("carrera-asset-js");\n';
const CSS = "body{color:#123456}\n";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n';

/** Gebaute Dateien neben die index.html legen und eine fremde Datei außerhalb. */
const withBuild = (h: Harness): void => {
  mkdirSync(join(h.staticDir, "assets"));
  writeFileSync(join(h.staticDir, "assets", "index-AbC123.js"), JS);
  writeFileSync(join(h.staticDir, "assets", "index-DeF456.css"), CSS);
  writeFileSync(join(h.staticDir, "symbol.svg"), SVG);
  writeFileSync(join(h.dir, "package.json"), JSON.stringify({ name: SECRET }));
  writeFileSync(join(h.dir, "geheim.txt"), SECRET);
};

describe("Statische Dateien", () => {
  test.skip("[REQ-SRV-2] unter / die index.html aus CARRERA_STATIC als text/html, auf dem Port der API", async () => {
    const h = await startHarness();
    withBuild(h);
    const r = await h.call("GET", "/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/html\b/);
    expect(r.text).toContain(INDEX_MARKER);
    const direct = await h.call("GET", "/index.html");
    expect(direct.status).toBe(200);
    expect(direct.text).toContain(INDEX_MARKER);
    // dieselbe Adresse beantwortet die API
    expect((await h.call("GET", "/api/status")).json()).toStrictEqual({ status: "ok" });
  });

  test.skip("[REQ-SRV-2] gebaute Dateien mit passendem Content-Type und unverändertem Inhalt", async () => {
    const h = await startHarness();
    withBuild(h);
    const js = await h.call("GET", "/assets/index-AbC123.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/^(text|application)\/javascript\b/);
    expect(js.text).toBe(JS);
    const css = await h.call("GET", "/assets/index-DeF456.css");
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/^text\/css\b/);
    expect(css.text).toBe(CSS);
    const svg = await h.call("GET", "/symbol.svg");
    expect(svg.status).toBe(200);
    expect(svg.headers["content-type"]).toMatch(/^image\/svg\+xml\b/);
    expect(svg.text).toBe(SVG);
  });

  test.skip("[REQ-SRV-2] ein Geschwisterverzeichnis mit gleichem Namensanfang (static-geheim neben static) ist nicht erreichbar", async () => {
    // Testnachtrag 2: ein Präfixvergleich ohne Trennzeichen (`startsWith(root)` statt
    // `startsWith(root + sep)`) ließe `<tmp>/static-geheim/…` als „innerhalb von <tmp>/static“ durch.
    const h = await startHarness();
    withBuild(h);
    const sibling = `${h.staticDir}-geheim`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, "x.txt"), SECRET);
    const name = sibling.slice(h.dir.length + 1); // „static-geheim“
    for (const path of [
      `/..%2f${name}/x.txt`,
      `/../${name}/x.txt`,
      `/%2e%2e/${name}/x.txt`,
      `/assets/..%2f..%2f${name}/x.txt`,
    ]) {
      const r = await h.call("GET", path);
      expect(r.status, path).toBe(404);
      expect(r.text, path).not.toContain(SECRET);
    }
    expect((await h.call("GET", "/assets/index-AbC123.js")).status).toBe(200);
  });

  test.skip("[REQ-SRV-2] Pfade außerhalb von CARRERA_STATIC sind nicht erreichbar: /../package.json, /%2e%2e/package.json → 404", async () => {
    const h = await startHarness();
    withBuild(h);
    for (const path of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/%2E%2E/package.json",
      "/assets/../../package.json",
      "/assets/%2e%2e/%2e%2e/package.json",
      "/%2e%2e%2fpackage.json",
      "/..%2fgeheim.txt",
      "/../geheim.txt",
    ]) {
      const r = await h.call("GET", path);
      expect(r.status, path).toBe(404);
      expect(r.text, path).not.toContain(SECRET);
    }
    // Gegenprobe: die Datei gibt es wirklich, und erreichbare Dateien werden ausgeliefert
    expect((await h.call("GET", "/assets/index-AbC123.js")).status).toBe(200);
  });

  test.skip("[REQ-SRV-2] fehlt das Verzeichnis: Start trotzdem mit Warnung, / antwortet 404 mit „Frontend nicht gebaut (pnpm build)“, die API läuft", async () => {
    const missing = join(tmpdir(), `carrera-m3b-fehlt-${process.pid}-${Date.now()}`);
    const h = await startHarness({ CARRERA_STATIC: missing });
    const all = [...h.out, ...h.err];
    expect(
      all.some((l) => l.includes(missing)),
      `Warnung nennt das fehlende Verzeichnis:\n${all.join("\n")}`,
    ).toBe(true);
    const r = await h.call("GET", "/");
    expect(r.status).toBe(404);
    expect(r.text).toContain("Frontend nicht gebaut (pnpm build)");
    expect((await h.call("GET", "/api/status")).json()).toStrictEqual({ status: "ok" });
    expect(
      (
        await h.call("PUT", "/api/layouts/Oval", {
          body: { expectedVersion: 0, layout: { schemaVersion: 1, elements: [] } },
        })
      ).status,
    ).toBe(201);
  });

  test.skip("[REQ-SRV-2] Gegenprobe zur Warnung: ist das Verzeichnis vorhanden, warnt der Start nicht und / liefert die index.html", async () => {
    const h = await startHarness();
    // Testnachtrag: die Warnung darf nur kommen, wenn das Verzeichnis fehlt (Mutant „immer warnen“)
    expect(
      h.err.filter((l) => l.includes(h.staticDir)),
      h.err.join("\n"),
    ).toEqual([]);
    const all = [...h.out, ...h.err];
    expect(
      all.filter((l) => /nicht gebaut|pnpm build/.test(l)),
      all.join("\n"),
    ).toEqual([]);
    const r = await h.call("GET", "/");
    expect(r.status).toBe(200);
    expect(r.text).toContain(INDEX_MARKER);
    // auch nach einem Neustart keine Warnung
    const before = all.length;
    await h.restart();
    const after = [...h.out, ...h.err].slice(before);
    expect(after.filter((l) => /nicht gebaut|pnpm build/.test(l))).toEqual([]);
  });
});
