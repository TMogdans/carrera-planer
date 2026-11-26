/**
 * Spec M4 (.specify/specs/m4-deploy/spec.md): Container-Tests für das Image. Abnahmetests
 * REQ-IMG-1 bis REQ-IMG-7, REQ-DATA-2 und REQ-MESS-1.
 *
 * Aufruf (Prüfarchitektur der Spec):
 *   docker build -t carrera-planer:test .
 *   CARRERA_IMAGE=carrera-planer CARRERA_TAG=test pnpm exec vitest run --config vitest.container.config.ts
 *
 * Die Tests bauen kein Image. Fehlt `CARRERA_IMAGE`/`CARRERA_TAG`, das Image oder ein laufender
 * Docker-Daemon, scheitern sie im `beforeAll` mit Meldung; sie überspringen nie.
 *
 * Nachgewiesen wird am laufenden Container (HTTP über den veröffentlichten Port, `docker exec … node
 * -e …`, `docker inspect`, Dateien im Datenverzeichnis), nie durch Lesen des Dockerfiles.
 * Jeder Test benutzt eigene Container-, Volume- und Image-Namen mit Zufallsanteil und räumt sie im
 * `afterEach` ab. Der Host-Port 8080 wird nur dort benutzt, wo die Spec `-p 8080:8080` bzw. den
 * „veröffentlichten Port 8080“ verlangt (REQ-IMG-4, REQ-IMG-7); dort prüft der Test vorher, ob er
 * frei ist, und scheitert sonst mit Meldung. Sonst: freier Host-Port auf Container-Port 8080, mit
 * `Host: localhost:8080` (in der Vorgabe-Erlaubtliste, Port P = 8080 im Container).
 *
 * Datenverzeichnisse sind frische tmp-Verzeichnisse mit Rechten 0777 („für UID 1000 beschreibbar“,
 * auch wenn der Testlauf eine andere UID hat, wie auf CI-Runnern).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

const REPO = fileURLToPath(new URL("../", import.meta.url));

// ---------------------------------------------------------------------------------------------
// Testgerüst (eigenständig je Testdatei, damit keine ungeschützte Hilfsdatei die Tests ändert)
// ---------------------------------------------------------------------------------------------

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };
type RunOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
};

const run = (command: string, args: ReadonlyArray<string>, o: RunOptions = {}): Run => {
  const r = spawnSync(command, [...args], {
    cwd: o.cwd ?? REPO,
    env: o.env ?? process.env,
    encoding: "utf8",
    timeout: o.timeoutMs ?? 110_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error !== undefined) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const docker = (...args: ReadonlyArray<string>): Run => run("docker", args);
const dockerOk = (...args: ReadonlyArray<string>): string => {
  const r = docker(...args);
  if (r.status !== 0) {
    throw new Error(`docker ${args.join(" ")} → ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout.trim();
};

let IMAGE = "";

beforeAll(() => {
  const name = process.env.CARRERA_IMAGE;
  const tag = process.env.CARRERA_TAG;
  if (name === undefined || name === "" || tag === undefined || tag === "") {
    throw new Error(
      "Container-Tests brauchen CARRERA_IMAGE und CARRERA_TAG (z. B. CARRERA_IMAGE=carrera-planer CARRERA_TAG=test); sie überspringen nicht",
    );
  }
  IMAGE = `${name}:${tag}`;
  const info = run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 30_000 });
  if (info.status !== 0) {
    throw new Error(
      `Kein Docker-Daemon erreichbar (docker info → ${info.status}):\n${info.stderr}`,
    );
  }
  const img = docker("image", "inspect", IMAGE);
  if (img.status !== 0) {
    throw new Error(`Image ${IMAGE} fehlt (docker build -t ${IMAGE} .):\n${img.stderr}`);
  }
});

const containers: string[] = [];
const volumes: string[] = [];
const tmpDirs: string[] = [];

afterEach(() => {
  for (const c of containers.splice(0)) docker("rm", "-f", "-v", c);
  for (const v of volumes.splice(0)) docker("volume", "rm", "-f", v);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const unique = (what: string): string => `carrera-m4-${what}-${randomBytes(4).toString("hex")}`;

const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "carrera-m4-img-"));
  tmpDirs.push(d);
  return d;
};

/** Leeres Datenverzeichnis, für UID 1000 beschreibbar. */
const dataDir = (): string => {
  const d = join(newTmp(), "data");
  mkdirSync(d);
  chmodSync(d, 0o777);
  return d;
};

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "0.0.0.0", () => {
      const a = s.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      s.close(() => resolve(port));
    });
  });

const portIsFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => s.close(() => resolve(true)));
  });

const require8080 = async (): Promise<void> => {
  expect(
    await portIsFree(8080),
    "Testvoraussetzung: Host-Port 8080 ist frei (die Spec verlangt hier -p 8080:8080); läuft ein anderer Dienst oder ein Container darauf?",
  ).toBe(true);
};

type Reply = {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
  readonly json: () => unknown;
};
const call = (
  port: number,
  method: string,
  path: string,
  o: { readonly host?: string; readonly body?: unknown } = {},
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const raw = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body));
    const headers: Record<string, string> = { host: o.host ?? "localhost:8080" };
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
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type StartOptions = {
  readonly env?: Readonly<Record<string, string>>;
  readonly port?: number; // Host-Port auf Container-Port 8080
  readonly data?: string; // Host-Verzeichnis oder Volume für /data (oder vollständig „x:/data:opt“)
  readonly extra?: ReadonlyArray<string>; // weitere Optionen für docker run
  readonly command?: ReadonlyArray<string>; // nach dem Image
};

/** `docker run -d` mit eindeutigem Namen; der Name kommt zurück. */
const startContainer = (o: StartOptions = {}): string => {
  const name = unique("c");
  const args = ["run", "-d", "--name", name];
  for (const [k, v] of Object.entries(o.env ?? {})) args.push("-e", `${k}=${v}`);
  if (o.port !== undefined) args.push("-p", `${o.port}:8080`);
  if (o.data !== undefined) args.push("-v", o.data.includes(":/data") ? o.data : `${o.data}:/data`);
  args.push(...(o.extra ?? []), IMAGE, ...(o.command ?? []));
  containers.push(name);
  dockerOk(...args);
  return name;
};

const inspect = (name: string, format: string): string => dockerOk("inspect", "-f", format, name);
const logs = (name: string): string => {
  const r = docker("logs", name);
  return `${r.stdout}\n${r.stderr}`;
};

/** Warten, bis GET /api/status 200 liefert; endet der Container vorher, mit seinen Logs. */
const ready = async (name: string, port: number, host = "localhost:8080", ms = 30_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (inspect(name, "{{.State.Running}}") !== "true") {
      throw new Error(`Container ${name} endete vor dem Start:\n${logs(name)}`);
    }
    try {
      if ((await call(port, "GET", "/api/status", { host })).status === 200) return;
    } catch {
      // noch nicht bereit
    }
    await sleep(200);
  }
  throw new Error(`Container ${name} nicht bereit nach ${ms} ms:\n${logs(name)}`);
};

const healthStatus = (name: string): string =>
  inspect(name, "{{if .State.Health}}{{.State.Health.Status}}{{else}}kein-healthcheck{{end}}");

/** Wartet auf einen Health-Status; gibt die Dauer in ms zurück. */
const waitHealth = async (name: string, want: string, ms: number): Promise<number> => {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    last = healthStatus(name);
    if (last === want) return Date.now() - t0;
    if (last === "kein-healthcheck") break;
    await sleep(250);
  }
  throw new Error(
    `Container ${name}: Health „${last}“ statt „${want}“ nach ${Date.now() - t0} ms\n${inspect(name, "{{json .State.Health}}")}\n${logs(name)}`,
  );
};

/** `node -e` im laufenden Container (als dessen Benutzer). */
const nodeIn = (name: string, script: string): string =>
  dockerOk("exec", name, "node", "-e", script);

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
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gerade-342": 2 } };

/** Liste, jeder Stand und der Bestand über die API. */
const snapshot = async (port: number, host = "localhost:8080"): Promise<unknown> => {
  const list = (await call(port, "GET", "/api/layouts", { host })).json() as Array<{
    name: string;
  }>;
  const states: unknown[] = [];
  for (const s of list) {
    states.push(
      (await call(port, "GET", `/api/layouts/${encodeURIComponent(s.name)}`, { host })).json(),
    );
  }
  return { list, states, bestand: (await call(port, "GET", "/api/bestand", { host })).json() };
};

// ---------------------------------------------------------------------------------------------
// REQ-IMG-1 Mehrstufig, nur Laufzeit-Abhängigkeiten
// ---------------------------------------------------------------------------------------------

describe("Image-Inhalt", () => {
  test("[REQ-IMG-1] unter /app genau dist, dist-server, node_modules, package.json; typescript, vite, vitest nicht auflösbar; kein *.sqlite* und kein .git unter /app", async () => {
    const port = await freePort();
    const name = startContainer({ port, data: dataDir() });
    await ready(name, port);
    const script = `
      const fs = require("node:fs"), path = require("node:path");
      const { createRequire } = require("node:module");
      const req = createRequire("/app/package.json");
      const resolves = (n) => { try { req.resolve(n); return true; } catch { return false; } };
      const bad = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.name === ".git" || e.name.includes(".sqlite")) bad.push(p);
          if (e.isDirectory()) walk(p);
        }
      };
      walk("/app");
      process.stdout.write(JSON.stringify({
        top: fs.readdirSync("/app").sort(),
        dev: { typescript: resolves("typescript"), vite: resolves("vite"), vitest: resolves("vitest") },
        prod: { effect: resolves("effect"), sqlite: resolves("@effect/sql-sqlite-node") },
        bad,
      }));`;
    const seen = JSON.parse(nodeIn(name, script)) as {
      top: string[];
      dev: Record<string, boolean>;
      prod: Record<string, boolean>;
      bad: string[];
    };
    expect(seen.top).toStrictEqual(["dist", "dist-server", "node_modules", "package.json"]);
    // Kanarienvogel: Laufzeit-Abhängigkeiten lösen von /app aus auf (die Probe selbst wirkt)
    expect(seen.prod).toStrictEqual({ effect: true, sqlite: true });
    expect(seen.dev).toStrictEqual({ typescript: false, vite: false, vitest: false });
    expect(seen.bad).toStrictEqual([]);
    // Die Build-Stufe hat gebaut: Frontend und Server liegen übersetzt vor
    expect(
      nodeIn(
        name,
        `process.stdout.write(String(require("node:fs").existsSync("/app/dist/index.html") && require("node:fs").existsSync("/app/dist-server/server/main.js")))`,
      ),
    ).toBe("true");
  });

  // -------------------------------------------------------------------------------------------
  // REQ-IMG-2 arm64, better-sqlite3 lädt
  // -------------------------------------------------------------------------------------------

  test("[REQ-IMG-2] Image ist linux/arm64, und ein Container daraus beantwortet GET /api/status mit 200 {status: ok}", async () => {
    expect(dockerOk("image", "inspect", "-f", "{{.Os}}/{{.Architecture}}", IMAGE)).toBe(
      "linux/arm64",
    );
    const port = await freePort();
    const name = startContainer({ port, data: dataDir() });
    await ready(name, port);
    const status = await call(port, "GET", "/api/status");
    expect(status.status).toBe(200);
    expect(status.json()).toStrictEqual({ status: "ok" });
    // better-sqlite3 lädt wirklich: ein Schreibzugriff geht durch
    const put = await call(port, "PUT", "/api/layouts/Oval", {
      body: { expectedVersion: 0, layout: OVAL },
    });
    expect(put.status, put.text).toBe(201);
  });

  // -------------------------------------------------------------------------------------------
  // REQ-IMG-3 PID 1, nicht root
  // -------------------------------------------------------------------------------------------

  test("[REQ-IMG-3] PID 1 ist node mit dist-server/server/main.js (kein pnpm, keine Shell), UID 1000", async () => {
    const port = await freePort();
    const name = startContainer({ port, data: dataDir() });
    await ready(name, port);
    const proc = JSON.parse(
      nodeIn(
        name,
        `const fs = require("node:fs");
         process.stdout.write(JSON.stringify({
           argv: fs.readFileSync("/proc/1/cmdline", "utf8").split("\\0").filter((a) => a !== ""),
           uid: fs.readFileSync("/proc/1/status", "utf8").split("\\n").find((l) => l.startsWith("Uid:")),
         }));`,
      ),
    ) as { argv: string[]; uid: string };
    const [exe, ...args] = proc.argv;
    expect(exe?.split("/").at(-1), proc.argv.join(" ")).toBe("node");
    expect(
      args.some(
        (a) => a === "dist-server/server/main.js" || a.endsWith("/dist-server/server/main.js"),
      ),
      proc.argv.join(" "),
    ).toBe(true);
    expect(
      proc.argv.some((a) => /(^|\/)(pnpm|npm|sh|bash|dash)$/.test(a)),
      proc.argv.join(" "),
    ).toBe(false);
    expect(
      proc.argv.some((a) => a === "-c"),
      proc.argv.join(" "),
    ).toBe(false);
    // Uid: real, effektiv, gespeichert, Dateisystem
    expect(proc.uid.split(/\s+/).slice(1, 5)).toStrictEqual(["1000", "1000", "1000", "1000"]);
    // PID 1 ist der Server selbst: er bekommt SIGTERM direkt und endet sauber (Wirkung von „keine
    // Shell dazwischen“; die Frist steht in REQ-IMG-6)
    docker("stop", "-t", "10", name);
    expect(inspect(name, "{{.State.ExitCode}}")).toBe("0");
  });

  // -------------------------------------------------------------------------------------------
  // REQ-IMG-4 Start mit leerem Datenverzeichnis, Vorgaben im Image
  // -------------------------------------------------------------------------------------------

  test("[REQ-IMG-4] leeres /data, nur CARRERA_ALLOWED_HOSTS: Datei entsteht auf dem Host, Startzeile nennt den Pfad, GET / über Port 8080 liefert index.html, verlinktes JS mit Content-Type JavaScript", async () => {
    await require8080();
    const data = dataDir();
    const name = startContainer({
      port: 8080,
      data,
      env: { CARRERA_ALLOWED_HOSTS: "rezepte.fritz.box" },
    });
    await ready(name, 8080, "rezepte.fritz.box:8080");
    const dbFile = join(data, "carrera-planer.sqlite");
    expect(existsSync(dbFile)).toBe(true);
    expect(readFileSync(dbFile).subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
    const startLine = logs(name)
      .split("\n")
      .find((l) => l.includes("/data/carrera-planer.sqlite") && l.includes("0.0.0.0:8080"));
    expect(startLine, logs(name)).toBeDefined();

    const index = await call(8080, "GET", "/", { host: "rezepte.fritz.box:8080" });
    expect(index.status).toBe(200);
    expect(index.text).toContain("<title>Carrera-Planer</title>");
    // ausgeliefert wird genau /app/dist/index.html (CARRERA_STATIC=/app/dist)
    const served = docker(
      "exec",
      name,
      "node",
      "-e",
      `process.stdout.write(require("node:fs").readFileSync("/app/dist/index.html", "utf8"))`,
    );
    expect(served.status, served.stderr).toBe(0);
    expect(index.text).toBe(served.stdout);
    const js = /(?:src|href)="([^"]+\.js)"/.exec(index.text)?.[1];
    expect(js, index.text).toBeDefined();
    const script = await call(8080, "GET", js as string, { host: "rezepte.fritz.box:8080" });
    expect(script.status).toBe(200);
    expect(String(script.headers["content-type"])).toMatch(/javascript/);

    // Vorgaben im Image, wirksam im Server-Prozess (PID 1)
    const environ = nodeIn(
      name,
      `process.stdout.write(require("node:fs").readFileSync("/proc/1/environ", "utf8"))`,
    )
      .split("\0")
      .filter((e) => e.startsWith("CARRERA_"));
    expect(environ).toContain("CARRERA_DB=/data/carrera-planer.sqlite");
    expect(environ).toContain("CARRERA_STATIC=/app/dist");
    expect(environ).toContain("CARRERA_PORT=8080");
    expect(environ).toContain("CARRERA_ALLOWED_HOSTS=rezepte.fritz.box");
    const host = environ.find((e) => e.startsWith("CARRERA_HOST="));
    expect(host === undefined || host === "CARRERA_HOST=0.0.0.0", host).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-IMG-5 Healthcheck
// ---------------------------------------------------------------------------------------------

describe("Healthcheck", () => {
  test("[REQ-IMG-5] ein normal gestarteter Container ist binnen 30 s healthy", async () => {
    const port = await freePort();
    const name = startContainer({ port, data: dataDir() });
    const ms = await waitHealth(name, "healthy", 40_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  test("[REQ-IMG-5] mit CARRERA_ALLOWED_HOSTS=rezepte.fritz.box wird der Container binnen 30 s healthy (127.0.0.1:P bleibt erlaubt)", async () => {
    const port = await freePort();
    const name = startContainer({
      port,
      data: dataDir(),
      env: { CARRERA_ALLOWED_HOSTS: "rezepte.fritz.box" },
    });
    const ms = await waitHealth(name, "healthy", 40_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  test("[REQ-IMG-5] Gegenprobe: Startbefehl durch einen Node-Prozess ohne Server ersetzt, wird unhealthy (nur Intervall und Retries verkürzt)", async () => {
    const name = startContainer({
      data: dataDir(),
      extra: ["--health-interval", "1s", "--health-retries", "1", "--entrypoint", "node"],
      command: ["-e", "setInterval(() => {}, 1e9)"],
    });
    // Der Prüfbefehl ist der aus dem Image (nicht ersetzt)
    expect(inspect(name, "{{json .Config.Healthcheck.Test}}")).toBe(
      dockerOk("image", "inspect", "-f", "{{json .Config.Healthcheck.Test}}", IMAGE),
    );
    // start-period 30 s aus dem Image zählt Fehlschläge nicht; danach 1 s Intervall, 1 Retry
    await waitHealth(name, "unhealthy", 90_000);
    expect(inspect(name, "{{.State.Running}}")).toBe("true");
  });

  test("[REQ-IMG-5] Werte im Image: start-period 30 s, start-interval 2 s, interval 60 s, timeout 10 s, retries 3", () => {
    const hc = JSON.parse(
      dockerOk("image", "inspect", "-f", "{{json .Config.Healthcheck}}", IMAGE),
    ) as Record<string, unknown> | null;
    expect(hc, "Image ohne HEALTHCHECK").not.toBeNull();
    const s = 1_000_000_000;
    expect(hc).toMatchObject({
      StartPeriod: 30 * s,
      StartInterval: 2 * s,
      Interval: 60 * s,
      Timeout: 10 * s,
      Retries: 3,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-IMG-6 Beenden
// ---------------------------------------------------------------------------------------------

describe("Beenden", () => {
  test("[REQ-IMG-6] docker stop endet binnen 5 s mit Exit-Code 0; ein neuer Container auf demselben Datenverzeichnis liefert Layout und Bestand unverändert; ebenso nach docker restart", async () => {
    const data = dataDir();
    const port = await freePort();
    const first = startContainer({ port, data });
    await ready(first, port);
    const put = await call(port, "PUT", "/api/layouts/Oval", {
      body: { expectedVersion: 0, layout: OVAL },
    });
    expect(put.status, put.text).toBe(201);
    const best = await call(port, "PUT", "/api/bestand", {
      body: { expectedVersion: 0, inventory: BESTAND },
    });
    expect(best.status, best.text).toBe(200);
    const before = await snapshot(port);
    expect(before).toMatchObject({
      list: [{ name: "Oval", version: 1 }],
      bestand: { version: 1, inventory: BESTAND },
    });

    const t0 = Date.now();
    const stop = docker("stop", first); // Vorgabe: SIGTERM, Frist 10 s
    const ms = Date.now() - t0;
    expect(stop.status, stop.stderr).toBe(0);
    expect(ms, `docker stop dauerte ${ms} ms`).toBeLessThanOrEqual(5_000);
    expect(inspect(first, "{{.State.ExitCode}}")).toBe("0");
    expect(inspect(first, "{{.State.OOMKilled}}")).toBe("false");

    const port2 = await freePort();
    const second = startContainer({ port: port2, data });
    await ready(second, port2);
    expect(await snapshot(port2)).toStrictEqual(before);

    const restart = docker("restart", second);
    expect(restart.status, restart.stderr).toBe(0);
    await ready(second, port2);
    expect(await snapshot(port2)).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-IMG-7 Host-Prüfung durch den veröffentlichten Port
// ---------------------------------------------------------------------------------------------

describe("Host-Prüfung", () => {
  test("[REQ-IMG-7] -p 8080:8080 mit CARRERA_ALLOWED_HOSTS=rezepte.fritz.box: :8080 → 200; evil.example:8080, ohne Port, rezepte.local:8080 → 421 FremderHost ohne Layoutnamen; ohne die Variable rezepte.fritz.box:8080 → 421, localhost:8080 → 200", async () => {
    await require8080();
    const name = startContainer({
      port: 8080,
      data: dataDir(),
      env: { CARRERA_ALLOWED_HOSTS: "rezepte.fritz.box" },
    });
    await ready(name, 8080, "rezepte.fritz.box:8080");
    const put = await call(8080, "PUT", "/api/layouts/Oval", {
      host: "rezepte.fritz.box:8080",
      body: { expectedVersion: 0, layout: OVAL },
    });
    expect(put.status, put.text).toBe(201);

    const ok = await call(8080, "GET", "/api/layouts", { host: "rezepte.fritz.box:8080" });
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("Oval");

    for (const host of ["evil.example:8080", "rezepte.fritz.box", "rezepte.local:8080"]) {
      for (const path of ["/api/layouts", "/api/layouts/Oval", "/"]) {
        const r = await call(8080, "GET", path, { host });
        expect(r.status, `${host} ${path}`).toBe(421);
        expect(r.json(), `${host} ${path}`).toMatchObject({ _tag: "FremderHost" });
        expect(r.text, `${host} ${path}`).not.toContain("Oval");
      }
    }

    // derselbe Aufbau ohne CARRERA_ALLOWED_HOSTS
    docker("rm", "-f", name);
    await require8080();
    const plain = startContainer({ port: 8080, data: dataDir() });
    await ready(plain, 8080);
    const foreign = await call(8080, "GET", "/api/layouts", { host: "rezepte.fritz.box:8080" });
    expect(foreign.status).toBe(421);
    expect(foreign.json()).toMatchObject({ _tag: "FremderHost" });
    expect((await call(8080, "GET", "/api/layouts", { host: "localhost:8080" })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-DATA-2 Datenverzeichnis gehört root
// ---------------------------------------------------------------------------------------------

describe("Datenverzeichnis nicht beschreibbar", () => {
  test("[REQ-DATA-2] /data gehört root (0755, wie von Docker angelegt): Container endet mit Exit-Code ≠ 0, docker logs nennt /data/carrera-planer.sqlite und „nicht beschreibbar“", async () => {
    // Ein frisches Volume, als root auf root:root 0755 gestellt. Wirkt auf jedem Host gleich
    // (auf Docker Desktop legt Docker fehlende Bind-Mount-Verzeichnisse nicht als root an).
    const vol = unique("vol");
    volumes.push(vol);
    dockerOk("volume", "create", vol);
    dockerOk(
      "run",
      "--rm",
      "-u",
      "0",
      "-v",
      `${vol}:/data`,
      "--entrypoint",
      "node",
      IMAGE,
      "-e",
      `const fs = require("node:fs"); fs.chownSync("/data", 0, 0); fs.chmodSync("/data", 0o755);`,
    );
    // Kanarienvogel: für UID 1000 ist /data wirklich nicht beschreibbar
    const probe = docker(
      "run",
      "--rm",
      "-u",
      "1000",
      "-v",
      `${vol}:/data:nocopy`,
      "--entrypoint",
      "node",
      IMAGE,
      "-e",
      `require("node:fs").writeFileSync("/data/probe", "x")`,
    );
    expect(probe.status, probe.stdout + probe.stderr).not.toBe(0);

    const port = await freePort();
    // `nocopy`: sonst kopiert Docker beim Einhängen des leeren Volumes /data aus dem Image samt
    // Besitzer hinein, und der Fall „gehört root“ wäre wieder aufgehoben
    const name = startContainer({
      port,
      data: `${vol}:/data:nocopy`,
      env: { CARRERA_ALLOWED_HOSTS: "rezepte.fritz.box" },
    });
    const until = Date.now() + 30_000;
    while (Date.now() < until && inspect(name, "{{.State.Running}}") === "true") await sleep(250);
    expect(inspect(name, "{{.State.Running}}"), logs(name)).toBe("false");
    expect(inspect(name, "{{.State.ExitCode}}")).not.toBe("0");
    expect(
      logs(name)
        .split("\n")
        .some((l) => l.includes("/data/carrera-planer.sqlite") && l.includes("nicht beschreibbar")),
      logs(name),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-MESS-1 Messwerkzeug
// ---------------------------------------------------------------------------------------------

/**
 * Ausgabe nach der Spec: genau ein JSON-Objekt mit genau diesen Feldern und Typen. Jeder Verstoß
 * steht als eigene Meldung in der Liste (leer = in Ordnung).
 */
const measureFormErrors = (stdout: string, profil: string, t0: Date, t1: Date): string[] => {
  const errors: string[] = [];
  let out: unknown;
  try {
    out = JSON.parse(stdout);
  } catch (e) {
    return [`stdout ist nicht genau ein JSON-Wert: ${String(e)}`];
  }
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const keys = (v: Record<string, unknown>): string[] => Object.keys(v).sort();
  const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!isObject(out)) return ["stdout ist kein JSON-Objekt"];
  const top = ["layouts", "profil", "speicher", "vorgaenge", "zeitpunkt"];
  if (JSON.stringify(keys(out)) !== JSON.stringify(top)) {
    errors.push(`Felder ${keys(out).join(",")} statt ${top.join(",")}`);
  }
  if (out.profil !== profil) errors.push(`profil ${JSON.stringify(out.profil)} statt ${profil}`);
  const z = out.zeitpunkt;
  if (typeof z !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(z)) {
    errors.push(`zeitpunkt ${JSON.stringify(z)} ist kein ISO 8601 in UTC mit Z`);
  } else {
    const t = Date.parse(z);
    if (!(t >= t0.getTime() - 1_000 && t <= t1.getTime() + 1_000)) {
      errors.push(
        `zeitpunkt ${z} liegt nicht im Lauf (${t0.toISOString()} bis ${t1.toISOString()})`,
      );
    }
  }
  if (!isNumber(out.layouts) || out.layouts !== 40) {
    errors.push(`layouts ${JSON.stringify(out.layouts)} statt der Zahl 40 (Profil typisch)`);
  }
  const ops = out.vorgaenge;
  if (!Array.isArray(ops)) {
    errors.push("vorgaenge ist kein Array");
  } else {
    const names = ops.map((o) => (isObject(o) ? o.name : undefined));
    if (JSON.stringify([...names].sort()) !== JSON.stringify(["get", "liste", "put"])) {
      errors.push(`vorgaenge-Namen ${JSON.stringify(names)} statt je einmal liste, get, put`);
    }
    for (const o of ops) {
      if (!isObject(o)) {
        errors.push(`Vorgang ${JSON.stringify(o)} ist kein Objekt`);
        continue;
      }
      const label = `Vorgang ${JSON.stringify(o.name)}`;
      const want = ["maxMs", "medianMs", "n", "name"];
      if (JSON.stringify(keys(o)) !== JSON.stringify(want)) {
        errors.push(`${label}: Felder ${keys(o).join(",")} statt ${want.join(",")}`);
      }
      if (!isNumber(o.n) || o.n !== 20) errors.push(`${label}: n ${JSON.stringify(o.n)} statt 20`);
      if (!isNumber(o.maxMs) || !isNumber(o.medianMs)) {
        errors.push(`${label}: maxMs/medianMs keine JSON-Zahlen (${JSON.stringify(o)})`);
      } else if (!(o.maxMs >= o.medianMs && o.medianMs > 0)) {
        errors.push(`${label}: nicht maxMs ≥ medianMs > 0 (${JSON.stringify(o)})`);
      }
    }
  }
  const mem = out.speicher;
  if (!isObject(mem)) {
    errors.push("speicher ist kein Objekt");
  } else {
    const want = ["memoryPeakMiB", "vmHwmMiB"];
    if (JSON.stringify(keys(mem)) !== JSON.stringify(want)) {
      errors.push(`speicher: Felder ${keys(mem).join(",")} statt ${want.join(",")}`);
    }
    if (!isNumber(mem.vmHwmMiB) || !(mem.vmHwmMiB > 0)) {
      errors.push(`speicher.vmHwmMiB ${JSON.stringify(mem.vmHwmMiB)} ist keine Zahl > 0`);
    }
    if (!(mem.memoryPeakMiB === null || isNumber(mem.memoryPeakMiB))) {
      errors.push(
        `speicher.memoryPeakMiB ${JSON.stringify(mem.memoryPeakMiB)} weder Zahl noch null`,
      );
    }
  }
  return errors;
};

type Measured = {
  readonly speicher: { readonly vmHwmMiB: number; readonly memoryPeakMiB: number | null };
};

/** Speicher des Server-Prozesses im Container, so wie die Spec ihn definiert (MiB). */
const memoryIn = (name: string): { vmHwmMiB: number; memoryPeakMiB: number | null } =>
  JSON.parse(
    nodeIn(
      name,
      `const fs = require("node:fs");
       const kb = Number(/^VmHWM:\\s+(\\d+)\\s+kB/m.exec(fs.readFileSync("/proc/1/status", "utf8"))[1]);
       const peak = fs.existsSync("/sys/fs/cgroup/memory.peak")
         ? Number(fs.readFileSync("/sys/fs/cgroup/memory.peak", "utf8")) / 1048576
         : null;
       process.stdout.write(JSON.stringify({ vmHwmMiB: kb / 1024, memoryPeakMiB: peak }));`,
    ),
  ) as { vmHwmMiB: number; memoryPeakMiB: number | null };

describe("Messwerkzeug", () => {
  const setup = async (
    extra: ReadonlyArray<string> = [],
  ): Promise<{ port: number; host: string; name: string }> => {
    const port = await freePort();
    const host = `127.0.0.1:${port}`;
    const name = startContainer({
      port,
      data: dataDir(),
      env: { CARRERA_ALLOWED_HOSTS: host },
      extra,
    });
    await ready(name, port, host);
    const put = await call(port, "PUT", "/api/layouts/Oval", {
      host,
      body: { expectedVersion: 0, layout: OVAL },
    });
    expect(put.status, put.text).toBe(201);
    return { port, host, name };
  };

  /** Lauf `typisch` mit allen Prüfungen der Spec; gibt die geparste Ausgabe zurück. */
  const measureTypical = async (
    s: { port: number; host: string; name: string },
    args: ReadonlyArray<string>,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ out: Measured; before: { vmHwmMiB: number; memoryPeakMiB: number | null } }> => {
    const listBefore = (await call(s.port, "GET", "/api/layouts", { host: s.host })).json();
    const ovalBefore = (await call(s.port, "GET", "/api/layouts/Oval", { host: s.host })).json();
    const before = memoryIn(s.name);
    const t0 = new Date();
    const r = run(
      process.execPath,
      ["deploy/measure.mjs", `http://${s.host}`, "typisch", "--container", s.name, ...args],
      env === undefined ? { timeoutMs: 110_000 } : { timeoutMs: 110_000, env },
    );
    const t1 = new Date();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(measureFormErrors(r.stdout, "typisch", t0, t1), r.stdout).toStrictEqual([]);
    // danach genau die vorige Liste: Oval mit unveränderter Version und updatedAt
    expect((await call(s.port, "GET", "/api/layouts", { host: s.host })).json()).toStrictEqual(
      listBefore,
    );
    expect((await call(s.port, "GET", "/api/layouts/Oval", { host: s.host })).json()).toStrictEqual(
      ovalBefore,
    );
    return { out: JSON.parse(r.stdout) as Measured, before };
  };

  /**
   * Die Speicherwerte stammen aus genau diesem Container: zwischen dem Stand vor und nach dem
   * Lauf (beide Größen sind Höchststände und steigen nur), Toleranz 1 MiB für Rundung.
   */
  const expectMemoryFrom = (
    name: string,
    out: Measured,
    before: { vmHwmMiB: number; memoryPeakMiB: number | null },
  ): void => {
    const after = memoryIn(name);
    expect(out.speicher.vmHwmMiB).toBeGreaterThanOrEqual(before.vmHwmMiB - 1);
    expect(out.speicher.vmHwmMiB).toBeLessThanOrEqual(after.vmHwmMiB + 1);
    if (after.memoryPeakMiB === null) {
      expect(out.speicher.memoryPeakMiB).toBeNull();
    } else {
      expect(out.speicher.memoryPeakMiB).not.toBeNull();
      expect(out.speicher.memoryPeakMiB as number).toBeGreaterThanOrEqual(
        (before.memoryPeakMiB ?? 0) - 1,
      );
      expect(out.speicher.memoryPeakMiB as number).toBeLessThanOrEqual(after.memoryPeakMiB + 1);
    }
  };

  test("[REQ-MESS-1] measure.mjs <URL> typisch --container <Name>: stdout ist genau ein JSON-Objekt mit genau den Feldern der Spec (Typen, zeitpunkt UTC mit Z, liste/get/put je einmal mit n 20 und maxMs ≥ medianMs > 0, vmHwmMiB > 0); Speicher aus dem Container; danach genau die vorige Layoutliste", async () => {
    const s = await setup();
    // Kanarienvogel: in diesem Container gibt es memory.peak, also muss eine Zahl kommen
    expect(memoryIn(s.name).memoryPeakMiB).not.toBeNull();
    const { out, before } = await measureTypical(s, []);
    expectMemoryFrom(s.name, out, before);
  });

  test("[REQ-MESS-1] fehlt /sys/fs/cgroup/memory.peak im Container (leeres tmpfs über /sys/fs/cgroup), ist memoryPeakMiB null; vmHwmMiB bleibt eine Zahl > 0", async () => {
    // Wie bei abgeschalteter Speicher-cgroup fehlt die Datei; --cgroupns host taugt dafür nicht
    // (auf Docker Desktop landet der Container in einer Zwischen-cgroup mit memory.peak)
    const s = await setup(["--tmpfs", "/sys/fs/cgroup:ro"]);
    // Kanarienvogel: die Konstruktion greift, memory.peak fehlt im Container wirklich
    expect(memoryIn(s.name).memoryPeakMiB).toBeNull();
    const { out, before } = await measureTypical(s, []);
    expect(out.speicher.memoryPeakMiB).toBeNull();
    expectMemoryFrom(s.name, out, before);
  });

  test("[REQ-MESS-1] --ssh <Host>: der Speicher wird über ssh <Host> docker exec … gelesen (ssh durch ein lokales Durchreich-Skript ersetzt, das den Host protokolliert)", async () => {
    const s = await setup();
    const bin = newTmp();
    const log = join(bin, "ssh.log");
    const ssh = join(bin, "ssh");
    // Durchreichen wie ein echtes ssh: erstes Argument ist der Host, der Rest der entfernte Befehl
    writeFileSync(ssh, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\nshift\nexec sh -c "$*"\n`);
    chmodSync(ssh, 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` };
    const { out, before } = await measureTypical(s, ["--ssh", "raspi-messung"], env);
    expectMemoryFrom(s.name, out, before);
    expect(existsSync(log), "measure.mjs hat ssh nicht aufgerufen").toBe(true);
    const hosts = readFileSync(log, "utf8").split("\n").filter(Boolean);
    expect(hosts.length).toBeGreaterThanOrEqual(1);
    expect(
      hosts.every((h) => h === "raspi-messung"),
      hosts.join(", "),
    ).toBe(true);
  });

  test("[REQ-MESS-1] gibt es schon ein Layout mit dem Präfix messung-, bricht es mit Exit-Code ≠ 0 ab, ohne etwas zu schreiben", async () => {
    const { port, host, name } = await setup();
    const fremd = await call(port, "PUT", "/api/layouts/messung-alt", {
      host,
      body: { expectedVersion: 0, layout: OVAL },
    });
    expect(fremd.status, fremd.text).toBe(201);
    const before = await snapshot(port, host);

    const r = run(
      process.execPath,
      ["deploy/measure.mjs", `http://${host}`, "typisch", "--container", name],
      { timeoutMs: 110_000 },
    );
    expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
    expect(r.status).not.toBeNull();
    expect(await snapshot(port, host)).toStrictEqual(before);
  });
});
