/**
 * Spec M4 (.specify/specs/m4-deploy/spec.md): Container-Tests für die Compose-Datei und die
 * Sicherung. Abnahmetests REQ-CMP-1 bis REQ-CMP-4 und REQ-DATA-3.
 *
 * Aufruf wie deploy/image.test.ts (`CARRERA_IMAGE`/`CARRERA_TAG`, `vitest.container.config.ts`).
 * Fehlt die Variable, das Image oder Docker mit Compose-Plugin, scheitern die Tests im `beforeAll`;
 * sie überspringen nie.
 *
 * Aufbau je Test wie im Smoke der Spec: ein frisches tmp-Verzeichnis mit einer Kopie von
 * `deploy/docker-compose.yml` und `deploy/backup.sh` (Dateirechte übernommen), einem leeren
 * `data/` (0777, für UID 1000 beschreibbar) und einer `.env`. Der Projektname ist eindeutig
 * (`COMPOSE_PROJECT_NAME`); aufgeräumt wird über das Compose-Label des Projekts, damit auch eine
 * Compose-Datei, die wegen fehlender Variable nicht interpoliert, nichts zurücklässt.
 *
 * Die Compose-Datei bildet fest `8080:8080` ab (Empfehlung 3); jeder Test prüft deshalb vorher,
 * ob Host-Port 8080 frei ist, und scheitert sonst mit Meldung.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const ALLOWED = "rezepte.fritz.box";
const HOST = "rezepte.fritz.box:8080";

// ---------------------------------------------------------------------------------------------
// Testgerüst (eigenständig je Testdatei)
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

let NAME = "";
let TAG = "";
let IMAGE = "";

beforeAll(() => {
  const name = process.env.CARRERA_IMAGE;
  const tag = process.env.CARRERA_TAG;
  if (name === undefined || name === "" || tag === undefined || tag === "") {
    throw new Error(
      "Container-Tests brauchen CARRERA_IMAGE und CARRERA_TAG (z. B. CARRERA_IMAGE=carrera-planer CARRERA_TAG=test); sie überspringen nicht",
    );
  }
  NAME = name;
  TAG = tag;
  IMAGE = `${name}:${tag}`;
  const info = run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 30_000 });
  if (info.status !== 0) {
    throw new Error(
      `Kein Docker-Daemon erreichbar (docker info → ${info.status}):\n${info.stderr}`,
    );
  }
  const compose = run("docker", ["compose", "version"], { timeoutMs: 30_000 });
  if (compose.status !== 0) {
    throw new Error(`docker compose fehlt (Compose-Plugin):\n${compose.stderr}`);
  }
  const img = docker("image", "inspect", IMAGE);
  if (img.status !== 0) {
    throw new Error(`Image ${IMAGE} fehlt (docker build -t ${IMAGE} .):\n${img.stderr}`);
  }
});

const projects: string[] = [];
const containers: string[] = [];
const images: string[] = [];
const tmpDirs: string[] = [];

const removeProject = (project: string): void => {
  const label = `label=com.docker.compose.project=${project}`;
  const ids = docker("ps", "-aq", "--filter", label).stdout.split("\n").filter(Boolean);
  if (ids.length > 0) docker("rm", "-f", "-v", ...ids);
  const nets = docker("network", "ls", "-q", "--filter", label).stdout.split("\n").filter(Boolean);
  if (nets.length > 0) docker("network", "rm", ...nets);
};

afterEach(() => {
  for (const p of projects.splice(0)) removeProject(p);
  for (const c of containers.splice(0)) docker("rm", "-f", "-v", c);
  for (const i of images.splice(0)) docker("rmi", "-f", i);
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const unique = (what: string): string => `carrera-m4-${what}-${randomBytes(4).toString("hex")}`;

const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "carrera-m4-cmp-"));
  tmpDirs.push(d);
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
    "Testvoraussetzung: Host-Port 8080 ist frei (die Compose-Datei bildet 8080:8080 ab); läuft ein anderer Dienst oder ein Container darauf?",
  ).toBe(true);
};

type Reply = { readonly status: number; readonly text: string; readonly json: () => unknown };
const call = (
  port: number,
  method: string,
  path: string,
  o: { readonly host?: string; readonly body?: unknown } = {},
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const raw = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body));
    const headers: Record<string, string> = { host: o.host ?? HOST };
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
          resolve({ status: res.statusCode ?? 0, text, json: () => JSON.parse(text) as unknown });
        });
      },
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const inspect = (name: string, format: string): string => dockerOk("inspect", "-f", format, name);
const logs = (name: string): string => {
  const r = docker("logs", name);
  return `${r.stdout}\n${r.stderr}`;
};

type Deployment = {
  readonly dir: string;
  readonly project: string;
  readonly env: NodeJS.ProcessEnv;
  readonly compose: (...args: ReadonlyArray<string>) => Run;
  /** Die Container des Projekts (über das Compose-Label). */
  readonly ids: () => string[];
  readonly writeEnv: (lines: Readonly<Record<string, string>>) => void;
};

/** Verzeichnis wie im Smoke: Compose-Datei und backup.sh kopiert, data/ leer, .env. */
const deployment = (dotenv: Readonly<Record<string, string>>): Deployment => {
  const dir = newTmp();
  for (const f of ["docker-compose.yml", "backup.sh"]) {
    const src = join(REPO, "deploy", f);
    expect(existsSync(src), `deploy/${f} fehlt`).toBe(true);
    copyFileSync(src, join(dir, f));
    chmodSync(join(dir, f), statSync(src).mode & 0o777);
  }
  mkdirSync(join(dir, "data"));
  chmodSync(join(dir, "data"), 0o777);
  const project = unique("p");
  projects.push(project);
  // Umgebung ohne fremde CARRERA_*/COMPOSE_*-Werte; nur das Projekt kommt von außen
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !k.startsWith("CARRERA_") && !k.startsWith("COMPOSE_"),
      ),
    ),
    COMPOSE_PROJECT_NAME: project,
  };
  const writeEnv = (lines: Readonly<Record<string, string>>): void => {
    writeFileSync(
      join(dir, ".env"),
      Object.entries(lines)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  };
  writeEnv(dotenv);
  return {
    dir,
    project,
    env,
    compose: (...args) => run("docker", ["compose", ...args], { cwd: dir, env }),
    ids: () =>
      docker("ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`)
        .stdout.split("\n")
        .filter(Boolean),
    writeEnv,
  };
};

const baseEnv = (): Record<string, string> => ({
  CARRERA_IMAGE: NAME,
  CARRERA_TAG: TAG,
  CARRERA_ALLOWED_HOSTS: ALLOWED,
});

/** Genau ein Container im Projekt; seine ID. */
const onlyContainer = (d: Deployment): string => {
  const ids = d.ids();
  expect(ids, "genau ein Container im Projekt").toHaveLength(1);
  return ids[0] as string;
};

const ready = async (id: string, port: number, host = HOST, ms = 30_000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (inspect(id, "{{.State.Running}}") !== "true") {
      throw new Error(`Container ${id} läuft nicht:\n${logs(id)}`);
    }
    try {
      if ((await call(port, "GET", "/api/status", { host })).status === 200) return;
    } catch {
      // noch nicht bereit
    }
    await sleep(200);
  }
  throw new Error(`Container ${id} nicht bereit nach ${ms} ms:\n${logs(id)}`);
};

const waitHealth = async (id: string, want: string, ms: number): Promise<number> => {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    last = inspect(
      id,
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}kein-healthcheck{{end}}",
    );
    if (last === want) return Date.now() - t0;
    if (last === "kein-healthcheck") break;
    await sleep(250);
  }
  throw new Error(
    `Container ${id}: Health „${last}“ statt „${want}“ nach ${Date.now() - t0} ms\n${logs(id)}`,
  );
};

/** `docker compose up -d`; `replacing`: ein Container des Projekts belegt 8080 schon. */
const up = async (d: Deployment, replacing = false): Promise<string> => {
  if (!replacing) await require8080();
  const r = d.compose("up", "-d");
  expect(r.status, `docker compose up -d\n${r.stdout}\n${r.stderr}`).toBe(0);
  const id = onlyContainer(d);
  await ready(id, 8080);
  return id;
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
const BESTAND = { schemaVersion: 1, counts: { "kurve-1-90": 8, "gerade-342": 2 } };

const putLayout = async (port: number, name: string, v: number, host = HOST) => {
  const r = await call(port, "PUT", `/api/layouts/${encodeURIComponent(name)}`, {
    host,
    body: { expectedVersion: v, layout: OVAL },
  });
  expect(r.status, r.text).toBe(v === 0 ? 201 : 200);
};

const snapshot = async (port: number, host = HOST): Promise<unknown> => {
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

/** Größenangabe von json-file (`1m`, `1mb`, `1000k`, …) in Byte, dezimal und binär. */
const sizes = (text: string): number[] => {
  const m = /^(\d+)\s*([kmg]?)b?$/i.exec(text.trim());
  if (m === null) return [];
  const n = Number(m[1]);
  const p = { "": 0, k: 1, m: 2, g: 3 }[(m[2] ?? "").toLowerCase() as "" | "k" | "m" | "g"];
  return [n * 1000 ** p, n * 1024 ** p];
};

// ---------------------------------------------------------------------------------------------
// REQ-CMP-1 ohne CARRERA_ALLOWED_HOSTS kein Start
// ---------------------------------------------------------------------------------------------

describe("Compose-Datei", () => {
  for (const variant of ["nicht gesetzt", "leer"] as const) {
    test(`[REQ-CMP-1] CARRERA_ALLOWED_HOSTS ${variant}: docker compose up -d verweigert mit Meldung, die die Variable nennt, und es entsteht kein Container`, async () => {
      await require8080();
      const dotenv: Record<string, string> = { CARRERA_IMAGE: NAME, CARRERA_TAG: TAG };
      if (variant === "leer") dotenv.CARRERA_ALLOWED_HOSTS = "";
      const d = deployment(dotenv);
      const r = d.compose("up", "-d");
      expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
      expect(r.status).not.toBeNull();
      expect(`${r.stdout}\n${r.stderr}`).toContain("CARRERA_ALLOWED_HOSTS");
      // `docker compose ps -a` interpoliert die Datei ebenfalls und scheitert deshalb; dieselbe
      // Frage („Container des Projekts?“) über das Compose-Label
      expect(d.ids()).toStrictEqual([]);
      expect(await portIsFree(8080)).toBe(true);
    });
  }

  // -------------------------------------------------------------------------------------------
  // REQ-CMP-2 Port 8080, ./data, Image aus CARRERA_IMAGE/CARRERA_TAG, Rückweg
  // -------------------------------------------------------------------------------------------

  test("[REQ-CMP-2] mit CARRERA_ALLOWED_HOSTS: Antwort auf Host-Port 8080, Datenbank in ./data, nach down und up -d unverändert; Image aus CARRERA_IMAGE:CARRERA_TAG", async () => {
    const d = deployment(baseEnv());
    const id = await up(d);
    expect((await call(8080, "GET", "/api/status")).json()).toStrictEqual({ status: "ok" });
    const dbFile = join(d.dir, "data", "carrera-planer.sqlite");
    expect(existsSync(dbFile)).toBe(true);
    await putLayout(8080, "Oval", 0);
    await putLayout(8080, "Oval", 1);
    const best = await call(8080, "PUT", "/api/bestand", {
      body: { expectedVersion: 0, inventory: BESTAND },
    });
    expect(best.status, best.text).toBe(200);
    const before = await snapshot(8080);

    expect(inspect(id, "{{.Config.Image}}")).toBe(IMAGE);
    expect(inspect(id, "{{.Image}}")).toBe(dockerOk("image", "inspect", "-f", "{{.Id}}", IMAGE));

    const down = d.compose("down");
    expect(down.status, down.stderr).toBe(0);
    expect(d.ids()).toStrictEqual([]);
    expect(existsSync(dbFile)).toBe(true);
    await up(d);
    expect(await snapshot(8080)).toStrictEqual(before);
  });

  test("[REQ-CMP-2] Rückweg: CARRERA_TAG auf ein zweites, lokal getaggtes Image, up -d läuft danach mit dessen Image-ID, die Daten bleiben", async () => {
    const d = deployment(baseEnv());
    const first = await up(d);
    await putLayout(8080, "Oval", 0);
    const before = await snapshot(8080);

    // zweites Image: dasselbe Image unter anderem Tag, trivial abgeleitet (Label), andere ID
    const altTag = unique("alt").replace("carrera-m4-", "");
    const alt = `${NAME}:${altTag}`;
    images.push(alt);
    const helper = unique("helper");
    containers.push(helper);
    dockerOk("create", "--name", helper, IMAGE);
    dockerOk("commit", "--change", `LABEL carrera.m4.test=${altTag}`, helper, alt);
    const altId = dockerOk("image", "inspect", "-f", "{{.Id}}", alt);
    const baseId = dockerOk("image", "inspect", "-f", "{{.Id}}", IMAGE);
    expect(altId).not.toBe(baseId);
    expect(inspect(first, "{{.Image}}")).toBe(baseId);

    d.writeEnv({ ...baseEnv(), CARRERA_TAG: altTag });
    const second = await up(d, true);
    expect(inspect(second, "{{.Image}}")).toBe(altId);
    expect(inspect(second, "{{.Config.Image}}")).toBe(alt);
    expect(await snapshot(8080)).toStrictEqual(before);
  });

  test("[REQ-CMP-2] ohne CARRERA_IMAGE und CARRERA_TAG nimmt die Compose-Datei ghcr.io/tmogdans/carrera-planer:latest", async () => {
    await require8080();
    const d = deployment({ CARRERA_ALLOWED_HOSTS: ALLOWED });
    const want = "ghcr.io/tmogdans/carrera-planer:latest";
    // Wirkung ohne Netz: Container anlegen, ohne zu ziehen. Liegt das Image lokal, entsteht ein
    // Container mit genau diesem Image; sonst scheitert das Anlegen an genau diesem Namen.
    const r = d.compose("create", "--pull", "never");
    if (r.status === 0) {
      expect(inspect(onlyContainer(d), "{{.Config.Image}}")).toBe(want);
    } else {
      expect(`${r.stdout}\n${r.stderr}`).toContain(want);
      expect(d.ids()).toStrictEqual([]);
    }
  });

  // -------------------------------------------------------------------------------------------
  // REQ-CMP-3 restart, Speicherlimit, Log-Begrenzung
  // -------------------------------------------------------------------------------------------

  test("[REQ-CMP-3] memory.max im Container = 256 MiB, RestartPolicy unless-stopped (beendeter Server startet neu), LogConfig json-file mit max-size 1 MB und max-file 3", async () => {
    const d = deployment(baseEnv());
    const id = await up(d);
    const memoryMax = dockerOk(
      "exec",
      id,
      "node",
      "-e",
      `process.stdout.write(require("node:fs").readFileSync("/sys/fs/cgroup/memory.max", "utf8"))`,
    );
    expect(memoryMax).toBe(String(256 * 1024 * 1024));

    expect(inspect(id, "{{.HostConfig.RestartPolicy.Name}}")).toBe("unless-stopped");
    // Wirkung: der Server endet von innen (SIGTERM an PID 1, Exit-Code 0); Docker startet ihn neu
    expect(inspect(id, "{{.RestartCount}}")).toBe("0");
    dockerOk("exec", id, "node", "-e", `process.kill(1, "SIGTERM")`);
    const until = Date.now() + 30_000;
    while (Date.now() < until && inspect(id, "{{.RestartCount}}") === "0") await sleep(250);
    expect(inspect(id, "{{.RestartCount}}"), logs(id)).toBe("1");
    await ready(id, 8080);

    const log = JSON.parse(inspect(id, "{{json .HostConfig.LogConfig}}")) as {
      Type: string;
      Config: Record<string, string>;
    };
    expect(log.Type).toBe("json-file");
    expect(sizes(log.Config["max-size"] ?? ""), JSON.stringify(log)).toSatisfy((s: number[]) =>
      s.some((n) => n === 1_000_000 || n === 1024 * 1024),
    );
    expect(log.Config["max-file"]).toBe("3");
  });

  // -------------------------------------------------------------------------------------------
  // REQ-CMP-4 healthy über Compose, Prüfbefehl aus dem Image
  // -------------------------------------------------------------------------------------------

  test("[REQ-CMP-4] der Container aus der Compose-Datei wird binnen 30 s healthy, mit dem Healthcheck aus dem Image", async () => {
    await require8080();
    const d = deployment(baseEnv());
    const r = d.compose("up", "-d");
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const id = onlyContainer(d);
    const ms = await waitHealth(id, "healthy", 40_000);
    expect(ms).toBeLessThanOrEqual(30_000);
    const imageHc = dockerOk("image", "inspect", "-f", "{{json .Config.Healthcheck}}", IMAGE);
    expect(imageHc).not.toBe("null");
    expect(inspect(id, "{{json .Config.Healthcheck}}")).toBe(imageHc);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-DATA-3 Sicherung
// ---------------------------------------------------------------------------------------------

describe("Sicherung", () => {
  /** Ordnername `JJJJMMTT-HHMMSS` als UTC-Zeitpunkt in ms; `NaN`, wenn das Format nicht passt. */
  const folderUtc = (folder: string): number => {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(folder);
    if (m === null) return Number.NaN;
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return Date.UTC(y, mo - 1, d, h, mi, se);
  };

  test("[REQ-DATA-3] ./backup.sh stoppt, kopiert alle carrera-planer.sqlite* nach backup/JJJJMMTT-HHMMSS/ (UTC), startet wieder (healthy), Exit 0; ein frischer Container auf einer Kopie liefert denselben Stand, eine spätere Änderung fehlt dort", async () => {
    const d = deployment(baseEnv());
    const id = await up(d);
    await waitHealth(id, "healthy", 40_000);
    await putLayout(8080, "Oval", 0);
    await putLayout(8080, "Oval", 1);
    await putLayout(8080, "Acht / groß", 0);
    const best = await call(8080, "PUT", "/api/bestand", {
      body: { expectedVersion: 0, inventory: BESTAND },
    });
    expect(best.status, best.text).toBe(200);
    const before = await snapshot(8080);
    const startedBefore = inspect(id, "{{.State.StartedAt}}");

    // Zeitzone des Aufrufers fest auf UTC+3: ein Ordnername in Ortszeit fällt so auch auf einem
    // Rechner oder Runner mit TZ=UTC auf
    const t0 = new Date();
    const r = run("./backup.sh", [], {
      cwd: d.dir,
      env: { ...d.env, TZ: "Etc/GMT-3" },
      timeoutMs: 110_000,
    });
    const t1 = new Date();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);

    // der Dienst wurde gestoppt und wieder gestartet und ist wieder healthy
    const after = onlyContainer(d);
    expect(inspect(after, "{{.State.Running}}")).toBe("true");
    expect(inspect(after, "{{.State.StartedAt}}")).not.toBe(startedBefore);
    await waitHealth(after, "healthy", 40_000);
    expect(await snapshot(8080)).toStrictEqual(before);

    // genau ein Sicherungsordner JJJJMMTT-HHMMSS, Zeit in UTC innerhalb des Laufs (±2 s); ein
    // Name in Ortszeit (hier UTC+3) liegt drei Stunden daneben
    const backups = readdirSync(join(d.dir, "backup"));
    expect(backups).toHaveLength(1);
    const folder = backups[0] as string;
    expect(folder).toMatch(/^\d{8}-\d{6}$/);
    const at = folderUtc(folder);
    expect(
      at >= Math.floor(t0.getTime() / 1000) * 1000 - 2_000 && at <= t1.getTime() + 2_000,
      `${folder} liegt nicht im Lauf (UTC ${t0.toISOString()} bis ${t1.toISOString()})`,
    ).toBe(true);
    const files = readdirSync(join(d.dir, "backup", folder));
    expect(files).toContain("carrera-planer.sqlite");
    expect(
      files.every((f) => f.startsWith("carrera-planer.sqlite")),
      files.join(", "),
    ).toBe(true);

    // Änderung nach der Sicherung
    await putLayout(8080, "Oval", 2);

    // frischer Container auf einer Kopie der Sicherung (für UID 1000 beschreibbar)
    const copy = join(newTmp(), "data");
    cpSync(join(d.dir, "backup", folder), copy, { recursive: true });
    chmodSync(copy, 0o777);
    for (const f of readdirSync(copy)) chmodSync(join(copy, f), 0o666);
    const port = await freePort();
    const restored = unique("restore");
    containers.push(restored);
    dockerOk("run", "-d", "--name", restored, "-p", `${port}:8080`, "-v", `${copy}:/data`, IMAGE);
    await ready(restored, port, "localhost:8080");
    expect(await snapshot(port, "localhost:8080")).toStrictEqual(before);
    expect(
      (
        (await call(port, "GET", "/api/layouts/Oval", { host: "localhost:8080" })).json() as {
          version: number;
        }
      ).version,
    ).toBe(2);
  });

  test("[REQ-DATA-3] scheitert ein Schritt (backup ist eine Datei, kein Verzeichnis), endet backup.sh mit Exit-Code ≠ 0, und der Dienst läuft danach wieder (healthy)", async () => {
    const d = deployment(baseEnv());
    const id = await up(d);
    await waitHealth(id, "healthy", 40_000);
    await putLayout(8080, "Oval", 0);
    const before = await snapshot(8080);
    writeFileSync(join(d.dir, "backup"), "kein Verzeichnis");

    const r = run("./backup.sh", [], { cwd: d.dir, env: d.env, timeoutMs: 110_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0);
    expect(r.status).not.toBeNull();

    const after = onlyContainer(d);
    expect(inspect(after, "{{.State.Running}}"), logs(after)).toBe("true");
    await waitHealth(after, "healthy", 40_000);
    expect(await snapshot(8080)).toStrictEqual(before);
  });
});
