/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): der Server als eigener Prozess.
 * Abnahmetests REQ-SRV-1 (Skripte, Vorgaben, Exit-Code), REQ-SRV-5 (Signale) und die
 * Prozess-Seite von REQ-DB-1, REQ-DB-2, REQ-DB-3 (Standardausgabe, Fehlerausgabe, Exit-Code).
 *
 * Vor den Tests läuft einmal `pnpm run build:server` (Skript aus dem Admin-PR, übersetzt mit
 * `tsconfig.server.json` nach `dist-server/`); gestartet wird `node dist-server/server/main.js`,
 * also genau das, was `pnpm start` aufruft, und einmal `pnpm start` selbst. Datenbank und
 * statisches Verzeichnis liegen in frischen tmp-Verzeichnissen.
 *
 * REQ-SRV-5 „auch als PID 1“: Läuft Node als PID 1 (Container), installiert es keine
 * Standard-Signalbehandlung. Hier läuft der Server nicht als PID 1; nachgewiesen wird die Wirkung,
 * die dafür nötig ist: Der Prozess endet auf SIGTERM/SIGINT mit Exit-Code 0 und **ohne** Signal
 * als Todesursache. Ohne eigene Behandlung beendete Node ihn hier durch das Signal (Exit-Code null,
 * Signal gesetzt) und als PID 1 gar nicht. Den Lauf im Container prüft M4.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const MAIN = join(REPO, "dist-server", "server", "main.js");

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

const portIsFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => s.close(() => resolve(true)));
  });

type Reply = { readonly status: number; readonly text: string; readonly json: () => unknown };
const call = (
  port: number,
  method: string,
  path: string,
  body?: unknown,
  agent: http.Agent | false = false,
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = { host: `localhost:${port}` };
    if (raw !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(raw.length);
    }
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers, setHost: false, agent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, text, json: () => JSON.parse(text) as unknown });
        });
      },
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });

type Running = {
  readonly child: ChildProcess;
  readonly out: () => string;
  readonly err: () => string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};
const children: Running[] = [];
const tmpDirs: string[] = [];

const launch = (
  command: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  detached = false,
): Running => {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CARRERA_")),
  );
  const child = spawn(command, [...args], {
    cwd,
    env: { ...base, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached,
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (c: Buffer) => {
    out += c.toString("utf8");
  });
  child.stderr?.on("data", (c: Buffer) => {
    err += c.toString("utf8");
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal })),
  );
  const r: Running = { child, out: () => out, err: () => err, exited };
  children.push(r);
  return r;
};

const startMain = (env: Readonly<Record<string, string | undefined>>, cwd = REPO): Running =>
  launch(process.execPath, [MAIN], env, cwd);

/** Warten, bis /api/status 200 liefert oder der Prozess endet. */
const ready = async (r: Running, port: number, timeoutMs = 15_000): Promise<void> => {
  const until = Date.now() + timeoutMs;
  let ended = false;
  void r.exited.then(() => {
    ended = true;
  });
  while (Date.now() < until) {
    if (ended) throw new Error(`Server endete vor dem Start:\n${r.out()}\n${r.err()}`);
    try {
      if ((await call(port, "GET", "/api/status")).status === 200) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`Server nicht bereit nach ${timeoutMs} ms:\n${r.out()}\n${r.err()}`);
};

const exitWithin = async (
  r: Running,
  ms: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | "zeitueberschreitung"> =>
  Promise.race([
    r.exited,
    new Promise<"zeitueberschreitung">((res) => setTimeout(() => res("zeitueberschreitung"), ms)),
  ]);

const newDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "carrera-m3b-proc-"));
  tmpDirs.push(d);
  return d;
};

const envIn = async (dir: string): Promise<Record<string, string>> => {
  const staticDir = join(dir, "static");
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>x</title>");
  return {
    CARRERA_HOST: "127.0.0.1",
    CARRERA_PORT: String(await freePort()),
    CARRERA_DB: join(dir, "daten", "carrera.sqlite"),
    CARRERA_STATIC: staticDir,
  };
};

type Row = Record<string, unknown>;
type Database = {
  readonly prepare: (sql: string) => { readonly all: () => Row[] };
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

/** Kommt der JSON-Wert irgendwo in einer Nutzzeile der Datei vor? */
const fileContainsJson = (dbPath: string, value: unknown): boolean => {
  const db = new BetterSqlite(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => String(r.name));
    const target = JSON.stringify(value);
    return tables.some((t) =>
      db
        .prepare(`SELECT * FROM "${t.replaceAll('"', '""')}"`)
        .all()
        .some((row) =>
          Object.values(row).some((v) => {
            if (typeof v !== "string") return false;
            try {
              return JSON.stringify(JSON.parse(v)) === target;
            } catch {
              return false;
            }
          }),
        ),
    );
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
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gibt-es-nicht": 3 } };

beforeAll(() => {
  const r = spawnSync("pnpm", ["run", "build:server"], { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`pnpm run build:server scheiterte (${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  if (!existsSync(MAIN)) throw new Error(`${MAIN} fehlt nach pnpm run build:server`);
}, 180_000);

afterEach(async () => {
  for (const r of children.splice(0)) {
    if (r.child.exitCode === null && r.child.signalCode === null) {
      try {
        if (r.child.pid !== undefined) process.kill(-r.child.pid, "SIGKILL");
      } catch {
        r.child.kill("SIGKILL");
      }
      await r.exited;
    }
  }
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// REQ-SRV-1 Start aus dem Repo
// ---------------------------------------------------------------------------------------------

describe("Start", () => {
  test.skip("[REQ-SRV-1] pnpm start (nach pnpm build:server) startet den Server; Startzeile mit Adresse, Datenbankpfad und Erlaubtliste", async () => {
    const dir = newDir();
    const env = await envIn(dir);
    const P = env.CARRERA_PORT as string;
    const r = launch(
      "pnpm",
      ["start"],
      { ...env, CARRERA_ALLOWED_HOSTS: "rezepte.local" },
      REPO,
      true,
    );
    await ready(r, Number(P));
    expect((await call(Number(P), "GET", "/api/status")).json()).toStrictEqual({ status: "ok" });
    const line = r
      .out()
      .split("\n")
      .find((l) =>
        [`127.0.0.1:${P}`, env.CARRERA_DB as string, `localhost:${P}`, `rezepte.local:${P}`].every(
          (part) => l.includes(part),
        ),
      );
    expect(line, r.out()).toBeDefined();
    if (r.child.pid !== undefined) process.kill(-r.child.pid, "SIGTERM");
    expect(await exitWithin(r, 10_000)).not.toBe("zeitueberschreitung");
  }, 30_000);

  test.skip("[REQ-SRV-1] ohne CARRERA_DB und CARRERA_STATIC wirken data/carrera-planer.sqlite und dist relativ zum Arbeitsverzeichnis (ohne Port 8080)", async () => {
    // Testnachtrag: Wirkung der Pfad-Vorgaben am Kindprozess, cwd = tmp-Verzeichnis. Host und Port
    // sind gesetzt, damit der Test nicht an 8080 hängt; deren Vorgaben prüfen resolveConfig
    // (config.test.ts) und der Vorgabe-Test unten.
    const cwd = newDir();
    const marker = "Carrera-dist-im-Arbeitsverzeichnis-4b8e";
    mkdirSync(join(cwd, "dist"));
    writeFileSync(join(cwd, "dist", "index.html"), `<!doctype html><title>${marker}</title>`);
    const P = await freePort();
    const env = { CARRERA_HOST: "127.0.0.1", CARRERA_PORT: String(P) };
    const dbFile = join(cwd, "data", "carrera-planer.sqlite");
    expect(existsSync(join(cwd, "data"))).toBe(false);

    const first = startMain(env, cwd);
    await ready(first, P);
    expect(existsSync(dbFile)).toBe(true);
    expect(readFileSync(dbFile).subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
    const index = await call(P, "GET", "/");
    expect(index.status).toBe(200);
    expect(index.text).toContain(marker);
    const put = await call(P, "PUT", "/api/layouts/Oval", { expectedVersion: 0, layout: OVAL });
    expect(put.status).toBe(201);
    first.child.kill("SIGTERM");
    expect(await exitWithin(first, 5_000)).toEqual({ code: 0, signal: null });
    // die Änderung steht in genau dieser Datei
    expect(fileContainsJson(dbFile, OVAL)).toBe(true);

    // Neustart im selben Arbeitsverzeichnis findet sie wieder
    const second = startMain(env, cwd);
    await ready(second, P);
    expect((await call(P, "GET", "/api/layouts/Oval")).json()).toMatchObject({
      version: 1,
      layout: OVAL,
    });
    expect(second.out()).not.toContain("neu angelegt");
  }, 40_000);

  test.skip("[REQ-SRV-1] Vorgaben ohne Umgebungsvariablen: 0.0.0.0:8080, data/carrera-planer.sqlite und dist relativ zum Arbeitsverzeichnis, Erlaubtliste localhost:8080", async () => {
    expect(await portIsFree(8080), "Testvoraussetzung: Port 8080 ist frei").toBe(true);
    const cwd = newDir();
    const r = startMain({}, cwd);
    await ready(r, 8080);
    const dbFile = join(cwd, "data", "carrera-planer.sqlite");
    expect(existsSync(dbFile)).toBe(true);
    const out = r.out();
    const line = out
      .split("\n")
      .find((l) =>
        [
          "0.0.0.0:8080",
          "carrera-planer.sqlite",
          "localhost:8080",
          "127.0.0.1:8080",
          "[::1]:8080",
        ].every((part) => l.includes(part)),
      );
    expect(line, out).toBeDefined();
    // CARRERA_STATIC = dist fehlt im Arbeitsverzeichnis: Warnung, / antwortet 404 mit Hinweis
    const index = await call(8080, "GET", "/");
    expect(index.status).toBe(404);
    expect(index.text).toContain("Frontend nicht gebaut (pnpm build)");
    // CARRERA_ALLOWED_HOSTS leer: nur die Vorgabe-Liste
    r.child.kill("SIGTERM");
    expect(await exitWithin(r, 5_000)).toEqual({ code: 0, signal: null });
  }, 30_000);

  test.skip("[REQ-SRV-1] ungültiger Port bricht mit Exit-Code ≠ 0 und Meldung ab", async () => {
    for (const port of ["70000", "0", "abc"]) {
      const dir = newDir();
      const env = await envIn(dir);
      const r = startMain({ ...env, CARRERA_PORT: port });
      const exit = await exitWithin(r, 10_000);
      expect(exit, port).not.toBe("zeitueberschreitung");
      expect((exit as { code: number | null }).code, port).not.toBe(0);
      expect((exit as { code: number | null }).code, port).not.toBeNull();
      expect(r.err(), port).toContain("CARRERA_PORT");
    }
  }, 40_000);

  test.skip("[REQ-SRV-1] ungültiger Eintrag in CARRERA_ALLOWED_HOSTS bricht mit Exit-Code ≠ 0 und Meldung ab", async () => {
    const dir = newDir();
    const env = await envIn(dir);
    const r = startMain({ ...env, CARRERA_ALLOWED_HOSTS: "http://x" });
    const exit = await exitWithin(r, 10_000);
    expect(exit).not.toBe("zeitueberschreitung");
    expect((exit as { code: number | null }).code).not.toBe(0);
    expect((exit as { code: number | null }).code).not.toBeNull();
    expect(r.err()).toContain("CARRERA_ALLOWED_HOSTS");
  }, 20_000);
});

// ---------------------------------------------------------------------------------------------
// REQ-SRV-5 Signale
// ---------------------------------------------------------------------------------------------

describe("Beenden", () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test.skip(`[REQ-SRV-5] ${signal}: Exit-Code 0 ohne Signal als Todesursache binnen 5 s, auch mit offener Keep-Alive-Verbindung; bestätigte Änderungen stehen danach in der Datei`, async () => {
      const dir = newDir();
      const env = await envIn(dir);
      const P = Number(env.CARRERA_PORT);
      const r = startMain(env);
      await ready(r, P);
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      try {
        const put = await call(
          P,
          "PUT",
          "/api/layouts/Oval",
          { expectedVersion: 0, layout: OVAL },
          agent,
        );
        expect(put.status).toBe(201);
        const best = await call(
          P,
          "PUT",
          "/api/bestand",
          { expectedVersion: 0, inventory: BESTAND },
          agent,
        );
        expect(best.status).toBe(200);
        // Keep-Alive-Verbindung bleibt offen (wie ein Browser-Tab)
        const t0 = Date.now();
        r.child.kill(signal);
        const exit = await exitWithin(r, 5_000);
        const ms = Date.now() - t0;
        expect(exit, `${signal} nach ${ms} ms\n${r.out()}\n${r.err()}`).toEqual({
          code: 0,
          signal: null,
        });
        expect(ms).toBeLessThanOrEqual(5_000);
      } finally {
        agent.destroy();
      }
      // keine neuen Verbindungen mehr
      await expect(call(P, "GET", "/api/status")).rejects.toThrow();
      // eine danach geöffnete Datei zeigt alle bestätigten Änderungen
      const dbPath = env.CARRERA_DB as string;
      expect(fileContainsJson(dbPath, OVAL)).toBe(true);
      expect(fileContainsJson(dbPath, BESTAND)).toBe(true);
    }, 30_000);
  }
});

// ---------------------------------------------------------------------------------------------
// REQ-DB-1, REQ-DB-2, REQ-DB-3 am echten Prozess
// ---------------------------------------------------------------------------------------------

describe("Datenbank am Prozess", () => {
  test.skip("[REQ-DB-1] neue Datei: Verzeichnis und Datei entstehen, Standardausgabe nennt Pfad und „neu angelegt“", async () => {
    const dir = newDir();
    const env = await envIn(dir);
    const dbPath = env.CARRERA_DB as string;
    expect(existsSync(join(dir, "daten"))).toBe(false);
    const r = startMain(env);
    await ready(r, Number(env.CARRERA_PORT));
    expect(existsSync(dbPath)).toBe(true);
    expect(
      r
        .out()
        .split("\n")
        .some((l) => l.includes(dbPath) && l.includes("neu angelegt")),
      r.out(),
    ).toBe(true);
    expect((await call(Number(env.CARRERA_PORT), "GET", "/api/layouts")).json()).toStrictEqual([]);
  }, 30_000);

  test.skip("[REQ-DB-2] nach SIGTERM und Neustart mit derselben Datei: dieselben Layouts, Versionen, updatedAt, Inhalte und derselbe Bestand", async () => {
    const dir = newDir();
    const env = await envIn(dir);
    const P = Number(env.CARRERA_PORT);
    const first = startMain(env);
    await ready(first, P);
    await call(P, "PUT", "/api/layouts/Oval", { expectedVersion: 0, layout: OVAL });
    await call(P, "PUT", "/api/layouts/Oval", { expectedVersion: 1, layout: OVAL });
    await call(P, "PUT", "/api/layouts/Acht%20%2F%20gro%C3%9F", {
      expectedVersion: 0,
      layout: OVAL,
    });
    await call(P, "PUT", "/api/bestand", { expectedVersion: 0, inventory: BESTAND });
    const snapshot = async (): Promise<unknown> => ({
      list: (await call(P, "GET", "/api/layouts")).json(),
      oval: (await call(P, "GET", "/api/layouts/Oval")).json(),
      acht: (await call(P, "GET", "/api/layouts/Acht%20%2F%20gro%C3%9F")).json(),
      bestand: (await call(P, "GET", "/api/bestand")).json(),
    });
    const before = await snapshot();
    first.child.kill("SIGTERM");
    expect(await exitWithin(first, 5_000)).toEqual({ code: 0, signal: null });

    const second = startMain(env);
    await ready(second, P);
    expect(await snapshot()).toStrictEqual(before);
    expect(second.out()).not.toContain("neu angelegt");
  }, 40_000);

  test.skip("[REQ-DB-3] keine SQLite-Datei: Exit-Code ≠ 0, Fehlerausgabe mit Pfad, Datei Byte für Byte unverändert", async () => {
    const dir = newDir();
    const env = await envIn(dir);
    const dbPath = join(dir, "kaputt.sqlite");
    writeFileSync(dbPath, "kaputt");
    const r = startMain({ ...env, CARRERA_DB: dbPath });
    const exit = await exitWithin(r, 10_000);
    expect(exit, r.out()).not.toBe("zeitueberschreitung");
    expect((exit as { code: number | null }).code).not.toBe(0);
    expect((exit as { code: number | null }).code).not.toBeNull();
    expect(r.err()).toContain(dbPath);
    expect(readFileSync(dbPath, "utf8")).toBe("kaputt");
  }, 20_000);
});
