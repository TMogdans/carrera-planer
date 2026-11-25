/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Beenden trotz hängender Verbindungen.
 * Abnahmetests REQ-SRV-5 im Testprozess (Testnachtrag 2; läuft unter Stryker, Pool `threads`).
 *
 * REQ-SRV-5 verlangt Exit-Code 0 binnen 5 s nach SIGINT/SIGTERM. Den Prozess beendet main.ts erst,
 * wenn der Server geschlossen ist; hängt `close()`, hängt der Prozess (im Container: SIGKILL nach
 * der Frist von `docker stop`, Exit 137). Hier wird deshalb `close()` aus startServer (Schnittstelle
 * wie in api.test.ts) gemessen, während Clients mitten in einer Anfrage hängen:
 * - Körper angekündigt (Content-Length 1000), nur 22 Byte gesendet;
 * - Kopfzeilen nur zur Hälfte gesendet;
 * - eine ruhende Keep-Alive-Verbindung.
 * `close()` muss binnen 5 s auflösen; danach lauscht nichts mehr, die hängenden Sockets sind zu,
 * und ein vorher bestätigtes PUT steht nach dem Neustart in der Datei.
 * Den echten Prozess mit SIGTERM prüft process.test.ts.
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

const DEADLINE_MS = 5_000;
const OVAL = {
  schemaVersion: 1,
  elements: [
    { id: "o1", part: "kurve-1-90", turn: "links" },
    { id: "o2", part: "gerade-342" },
  ],
} as const;

type Hanging = { readonly socket: net.Socket; readonly closed: Promise<void> };
const sockets: net.Socket[] = [];
afterEach(() => {
  for (const s of sockets.splice(0)) s.destroy();
});

/** Verbindung öffnen, `text` senden und offen halten (der Client schweigt danach). */
const hang = (port: number, text: string): Promise<Hanging> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    sockets.push(socket);
    const closed = new Promise<void>((res) => socket.once("close", () => res()));
    socket.on("error", () => {}); // Reset durch den Server ist hier erwünscht
    socket.resume(); // Antworten lesen, damit das Ende der Verbindung ankommt
    socket.once("connect", () => {
      socket.write(text, () => resolve({ socket, closed }));
    });
    socket.once("error", reject);
  });

const within = <T>(p: Promise<T>, ms: number): Promise<T | "zeitueberschreitung"> =>
  Promise.race([
    p,
    new Promise<"zeitueberschreitung">((res) => setTimeout(() => res("zeitueberschreitung"), ms)),
  ]);

/** Kurz warten, damit der Server die Teilanfrage sicher angenommen hat. */
const settle = () => new Promise((res) => setTimeout(res, 200));

describe("Beenden mit hängenden Verbindungen", () => {
  test("[REQ-SRV-5] close() löst binnen 5 s auf, obwohl ein Client mitten im Körper hängt (Content-Length 1000, 22 Byte gesendet)", async () => {
    const h = await startHarness();
    const put = await h.call("PUT", "/api/layouts/Oval", {
      body: { expectedVersion: 0, layout: OVAL },
    });
    expect(put.status).toBe(201);
    const body = '{"expectedVersion":0,"';
    expect(Buffer.byteLength(body)).toBe(22);
    const stuck = await hang(
      h.port,
      `PUT /api/layouts/Neu HTTP/1.1\r\nHost: localhost:${h.port}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n${body}`,
    );
    await settle();

    const t0 = Date.now();
    const result = await within(h.stop(), DEADLINE_MS);
    const ms = Date.now() - t0;
    expect(result, `close() nach ${ms} ms nicht aufgelöst`).not.toBe("zeitueberschreitung");
    expect(ms).toBeLessThanOrEqual(DEADLINE_MS);
    // der hängende Client ist getrennt, es lauscht nichts mehr
    expect(await within(stuck.closed, 1_000)).not.toBe("zeitueberschreitung");
    await expect(call(h.port, "GET", "/api/status")).rejects.toThrow();
    // bestätigte Änderung ist da, die abgebrochene nicht
    await h.restart();
    expect((await h.call("GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 1,
      layout: OVAL,
    });
    expect((await h.call("GET", "/api/layouts/Neu")).status).toBe(404);
  }, 20_000);

  test("[REQ-SRV-5] close() löst binnen 5 s auf bei halb gesendeten Kopfzeilen und ruhender Keep-Alive-Verbindung", async () => {
    const h = await startHarness();
    expect(
      (await h.call("PUT", "/api/layouts/Oval", { body: { expectedVersion: 0, layout: OVAL } }))
        .status,
    ).toBe(201);
    const halfHeaders = await hang(h.port, `GET /api/status HTTP/1.1\r\nHost: loc`);
    const idle = await hang(
      h.port,
      `GET /api/status HTTP/1.1\r\nHost: localhost:${h.port}\r\nConnection: keep-alive\r\n\r\n`,
    );
    await settle();

    const t0 = Date.now();
    const result = await within(h.stop(), DEADLINE_MS);
    const ms = Date.now() - t0;
    expect(result, `close() nach ${ms} ms nicht aufgelöst`).not.toBe("zeitueberschreitung");
    expect(await within(halfHeaders.closed, 1_000)).not.toBe("zeitueberschreitung");
    expect(await within(idle.closed, 1_000)).not.toBe("zeitueberschreitung");
    await expect(call(h.port, "GET", "/api/status")).rejects.toThrow();
    await h.restart();
    expect((await h.call("GET", "/api/layouts/Oval")).status).toBe(200);
  }, 20_000);
});
