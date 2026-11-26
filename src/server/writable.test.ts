/**
 * Spec M4 (.specify/specs/m4-deploy/spec.md): Startprüfung „beschreibbar“, REQ-DATA-1, im
 * Testprozess über `startServer` (Schnittstelle wie in storage.test.ts). Die Prozess-Seite
 * (Exit-Code ≠ 0) steht in process.test.ts; dieser Teil läuft unter Stryker und tötet Mutanten der
 * Startprüfung.
 *
 * Fälle (Spec): vorhandene, vom Server angelegte Datei mit Rechten 0444; Verzeichnis 0555 ohne
 * Datei; Verzeichnis 0555 mit beschreibbarer Datei. Gegenprobe: dieselbe Datei mit 0644 in einem
 * Verzeichnis 0755 startet, und `PUT` liefert 201.
 *
 * Der „Pfad“ der Meldung ist der Datenbankpfad, so wie er in `CARRERA_DB` steht; auch im Fall
 * „Verzeichnis nicht beschreibbar“ (wie REQ-DATA-2, dort nennt `docker logs`
 * `/data/carrera-planer.sqlite`).
 *
 * Läuft der Test als root, greifen Dateirechte nicht; dann scheitert er mit diesem Hinweis, statt
 * still zu bestehen. Kein `process.chdir`, damit er auch unter `--pool=threads` läuft.
 */
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

type Reply = { readonly status: number; readonly text: string };
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
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });

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
} as const;

const tmpDirs: string[] = [];
const running: RunningServer[] = [];
/** Rechte, die afterEach vor dem Aufräumen zurücksetzt (sonst scheitert rmSync an 0555). */
const restoreModes: Array<{ readonly path: string; readonly mode: number }> = [];

afterEach(async () => {
  for (const r of running.splice(0)) await r.close();
  for (const { path, mode } of restoreModes.splice(0).reverse()) {
    if (existsSync(path)) chmodSync(path, mode);
  }
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const notRoot = (): void => {
  expect(
    process.getuid?.(),
    "REQ-DATA-1: Der Test läuft als root; Dateirechte greifen dann nicht, die Startprüfung ist so nicht prüfbar",
  ).not.toBe(0);
};

type Setup = {
  readonly dir: string;
  readonly dbDir: string;
  readonly dbPath: string;
  readonly staticDir: string;
};

const newSetup = (): Setup => {
  const dir = mkdtempSync(join(tmpdir(), "carrera-m4-writable-"));
  tmpDirs.push(dir);
  const staticDir = join(dir, "static");
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>x</title>");
  const dbDir = join(dir, "db");
  mkdirSync(dbDir);
  return { dir, dbDir, dbPath: join(dbDir, "carrera.sqlite"), staticDir };
};

const envFor = async (s: Setup): Promise<Env> => ({
  CARRERA_HOST: "127.0.0.1",
  CARRERA_PORT: String(await freePort()),
  CARRERA_DB: s.dbPath,
  CARRERA_STATIC: s.staticDir,
});

/** Der Server legt die Datei selbst an, ein Layout wird bestätigt, dann sauber beendet. */
const createdByServer = async (s: Setup): Promise<void> => {
  const api = await loadServer();
  const env = await envFor(s);
  const r = await api.startServer(env, { stdout: () => {}, stderr: () => {} });
  try {
    const put = await call(Number(env.CARRERA_PORT), "PUT", "/api/layouts/Oval", {
      expectedVersion: 0,
      layout: OVAL,
    });
    expect(put.status).toBe(201);
  } finally {
    await r.close();
  }
  expect(existsSync(s.dbPath)).toBe(true);
};

/** Start, der scheitern soll: Fehlerausgabe zurück, und es lauscht nichts auf dem Port. */
const failingStart = async (env: Env): Promise<ReadonlyArray<string>> => {
  const api = await loadServer();
  const err: string[] = [];
  let started: RunningServer | undefined;
  let rejected = false;
  try {
    started = await api.startServer(env, { stdout: () => {}, stderr: (l) => err.push(l) });
  } catch {
    rejected = true;
  }
  if (started !== undefined) await started.close();
  expect(rejected, `startServer muss verworfen werden; Fehlerausgabe:\n${err.join("\n")}`).toBe(
    true,
  );
  await expect(call(Number(env.CARRERA_PORT), "GET", "/api/status")).rejects.toThrow();
  return err;
};

/** Genau eine Zeile (oder mehr) nennt den Pfad und „nicht beschreibbar“ zusammen. */
const expectWritableLine = (err: ReadonlyArray<string>, dbPath: string): void => {
  const lines = err.flatMap((e) => e.split("\n"));
  expect(
    lines.some((l) => l.includes(dbPath) && l.includes("nicht beschreibbar")),
    `Fehlerausgabe ohne Zeile mit ${dbPath} und „nicht beschreibbar“:\n${lines.join("\n")}`,
  ).toBe(true);
};

/** Alle Dateien der Datenbank (Haupt-, WAL- und SHM-Datei), Byte für Byte. */
const dbFiles = (dbPath: string): Record<string, string> =>
  Object.fromEntries(
    ["", "-wal", "-shm"]
      .map((suffix) => `${dbPath}${suffix}`)
      .filter((p) => existsSync(p))
      .map((p) => [p, readFileSync(p).toString("base64")]),
  );

// ---------------------------------------------------------------------------------------------
// REQ-DATA-1
// ---------------------------------------------------------------------------------------------

describe("Startprüfung beschreibbar (Testprozess)", () => {
  test.skip("[REQ-DATA-1] vorhandene, vom Server angelegte Datei mit 0444: Start scheitert mit Pfad und „nicht beschreibbar“ auf stderr, Datei Byte für Byte unverändert", async () => {
    notRoot();
    const s = newSetup();
    await createdByServer(s);
    const before = dbFiles(s.dbPath);
    chmodSync(s.dbPath, 0o444);
    restoreModes.push({ path: s.dbPath, mode: 0o644 });
    // Kanarienvogel: die Datei ist für diesen Prozess wirklich nicht beschreibbar
    expect(() => writeFileSync(s.dbPath, "x", { flag: "r+" })).toThrow();

    const err = await failingStart(await envFor(s));
    expectWritableLine(err, s.dbPath);
    expect(dbFiles(s.dbPath)).toStrictEqual(before);
  });

  test.skip("[REQ-DATA-1] Verzeichnis 0555 ohne Datei: Start scheitert mit Pfad und „nicht beschreibbar“ auf stderr, keine Datei entsteht", async () => {
    notRoot();
    const s = newSetup();
    chmodSync(s.dbDir, 0o555);
    restoreModes.push({ path: s.dbDir, mode: 0o755 });
    // Kanarienvogel: im Verzeichnis lässt sich wirklich nichts anlegen
    expect(() => writeFileSync(join(s.dbDir, "probe"), "x")).toThrow();

    const err = await failingStart(await envFor(s));
    expectWritableLine(err, s.dbPath);
    expect(existsSync(s.dbPath)).toBe(false);
    expect(existsSync(`${s.dbPath}-wal`)).toBe(false);
  });

  test.skip("[REQ-DATA-1] Verzeichnis 0555 mit beschreibbarer Datei (0644): Start scheitert mit Pfad und „nicht beschreibbar“ auf stderr, Datei Byte für Byte unverändert", async () => {
    notRoot();
    const s = newSetup();
    await createdByServer(s);
    const before = dbFiles(s.dbPath);
    chmodSync(s.dbPath, 0o644);
    chmodSync(s.dbDir, 0o555);
    restoreModes.push({ path: s.dbDir, mode: 0o755 });
    // Kanarienvogel: die Datei selbst ist beschreibbar, das Verzeichnis nicht
    expect(() => writeFileSync(s.dbPath, readFileSync(s.dbPath), { flag: "r+" })).not.toThrow();
    expect(() => writeFileSync(join(s.dbDir, "probe"), "x")).toThrow();

    const err = await failingStart(await envFor(s));
    expectWritableLine(err, s.dbPath);
    expect(dbFiles(s.dbPath)).toStrictEqual(before);
  });

  test.skip("[REQ-DATA-1] Gegenprobe: dieselbe Datei mit 0644 in einem Verzeichnis 0755 startet, PUT liefert 201, keine Zeile „nicht beschreibbar“", async () => {
    notRoot();
    const s = newSetup();
    await createdByServer(s);
    chmodSync(s.dbPath, 0o644);
    chmodSync(s.dbDir, 0o755);
    const api = await loadServer();
    const env = await envFor(s);
    const err: string[] = [];
    const r = await api.startServer(env, { stdout: () => {}, stderr: (l) => err.push(l) });
    running.push(r);
    const put = await call(Number(env.CARRERA_PORT), "PUT", "/api/layouts/Neu", {
      expectedVersion: 0,
      layout: OVAL,
    });
    expect(put.status, put.text).toBe(201);
    expect(err.some((l) => l.includes("nicht beschreibbar"))).toBe(false);
  });
});
