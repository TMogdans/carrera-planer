#!/usr/bin/env node
/**
 * Messwerkzeug (Spec M4, REQ-MESS-1). Node 22, ohne Abhängigkeiten; läuft auf dem
 * Entwicklungsrechner gegen den Planer auf dem Raspi:
 *
 *   node deploy/measure.mjs <Basis-URL> <typisch|groß> --container <Name> [--ssh <Host>]
 *
 * Legt die Layouts des Profils unter dem Präfix `messung-` an, misst je 20 Durchläufe von
 * `GET /api/layouts` (liste), `GET /api/layouts/{name}` (get) und `PUT /api/layouts/{name}` (put),
 * liest danach `VmHWM` aus `/proc/1/status` und `/sys/fs/cgroup/memory.peak` im Container über
 * `docker exec` (mit `--ssh` über `ssh <Host> docker exec …`) und löscht genau seine eigenen
 * Layouts wieder. Ausgabe: genau ein JSON-Objekt auf der Standardausgabe; Meldungen auf stderr.
 * Gibt es vor dem Start schon Layouts mit dem Präfix, bricht es ab, ohne etwas zu schreiben.
 */
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const PREFIX = "messung-";
const LAYOUTS = 40;
const RUNS = 20;
/** Körpergrenze des Servers (REQ-API-13 aus M3b). */
const BODY_LIMIT = 1024 * 1024;

const USAGE =
  "Aufruf: node deploy/measure.mjs <Basis-URL> <typisch|groß> --container <Name> [--ssh <Host>]";

/** Fehler mit Exit-Code; `main` gibt die Meldung aus. */
class Abbruch extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--container" || arg === "--ssh") {
      const value = argv[i + 1];
      if (value === undefined || value === "") throw new Abbruch(`${arg} ohne Wert\n${USAGE}`, 2);
      options[arg.slice(2)] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  const [base, profil, ...rest] = positional;
  if (base === undefined || rest.length > 0 || options.container === undefined) {
    throw new Abbruch(USAGE, 2);
  }
  if (profil !== "typisch" && profil !== "groß") {
    throw new Abbruch(`Profil „${profil}“ unbekannt (typisch oder groß)\n${USAGE}`, 2);
  }
  return { base: base.replace(/\/+$/, ""), profil, container: options.container, ssh: options.ssh };
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

const element = (i) =>
  i % 3 === 2
    ? { id: `e${i}`, part: "gerade-342" }
    : { id: `e${i}`, part: "kurve-1-90", turn: i % 2 === 0 ? "links" : "rechts" };

/** Layout mit `count` Elementen. */
const layoutOf = (count) => ({
  schemaVersion: 1,
  elements: Array.from({ length: count }, (_, i) => element(i)),
});

/**
 * Profil „groß“: so viele Elemente, dass der Körper eines `PUT` knapp unter 1 MiB bleibt (mit
 * Platz für eine mehrstellige `expectedVersion`).
 */
const largeLayout = () => {
  const reserve = 64;
  let size = JSON.stringify({ expectedVersion: 0, layout: layoutOf(0) }).length;
  let count = 0;
  for (;;) {
    const next = size + JSON.stringify(element(count)).length + 1;
    if (next > BODY_LIMIT - reserve) break;
    size = next;
    count++;
  }
  return layoutOf(count);
};

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

async function request(base, method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, text };
}

async function expectStatus(base, method, path, want, body) {
  const r = await request(base, method, path, body);
  if (r.status !== want) {
    throw new Abbruch(`${method} ${path} → ${r.status} statt ${want}: ${r.text.slice(0, 500)}`, 1);
  }
  return r.text;
}

const layoutPath = (name) => `/api/layouts/${encodeURIComponent(name)}`;

/** Dauer in ms eines Aufrufs, der den erwarteten Status liefern muss. */
async function timed(base, method, path, want, body) {
  const t0 = performance.now();
  const text = await expectStatus(base, method, path, want, body);
  return { ms: performance.now() - t0, text };
}

const round = (x) => Math.round(x * 1000) / 1000;

function summary(name, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
  return { name, n: samples.length, maxMs: round(sorted.at(-1)), medianMs: round(median) };
}

// ---------------------------------------------------------------------------------------------
// Speicher im Container
// ---------------------------------------------------------------------------------------------

/** Datei im Container lesen; `null`, wenn es sie dort nicht gibt. */
function readInContainer(args, file) {
  const command = ["docker", "exec", args.container, "cat", file];
  const [exe, ...rest] = args.ssh === undefined ? command : ["ssh", args.ssh, ...command];
  const r = spawnSync(exe, rest, { encoding: "utf8", timeout: 60_000 });
  if (r.error !== undefined) throw new Abbruch(`${exe} nicht ausführbar: ${r.error.message}`, 1);
  if (r.status === 0) return r.stdout;
  if (/No such file or directory/.test(r.stderr)) return null;
  throw new Abbruch(`${[exe, ...rest].join(" ")} → ${r.status}: ${r.stderr.trim()}`, 1);
}

function memory(args) {
  const status = readInContainer(args, "/proc/1/status");
  const hwm = status === null ? null : /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
  if (hwm === null) throw new Abbruch(`VmHWM in /proc/1/status von ${args.container} fehlt`, 1);
  const peak = readInContainer(args, "/sys/fs/cgroup/memory.peak");
  const peakBytes = peak === null ? null : Number(peak.trim());
  if (peakBytes !== null && !Number.isFinite(peakBytes)) {
    throw new Abbruch(`memory.peak unlesbar: ${JSON.stringify(peak)}`, 1);
  }
  return {
    vmHwmMiB: round(Number(hwm[1]) / 1024),
    memoryPeakMiB: peakBytes === null ? null : round(peakBytes / 1048576),
  };
}

// ---------------------------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------------------------

async function measure(args) {
  const zeitpunkt = new Date().toISOString();
  const { base } = args;
  const existing = JSON.parse(await expectStatus(base, "GET", "/api/layouts", 200));
  const taken = existing.map((s) => s.name).filter((n) => n.startsWith(PREFIX));
  if (taken.length > 0) {
    throw new Abbruch(
      `Es gibt schon Layouts mit dem Präfix ${PREFIX} (${taken.join(", ")}); nichts geschrieben. Erst aufräumen.`,
      1,
    );
  }

  const layout = args.profil === "typisch" ? layoutOf(200) : largeLayout();
  const names = Array.from(
    { length: LAYOUTS },
    (_, i) => `${PREFIX}${String(i + 1).padStart(2, "0")}`,
  );
  /** Eigene Layouts mit aktueller Version; nur diese werden am Ende gelöscht. */
  const versions = new Map();
  try {
    for (const name of names) {
      await expectStatus(base, "PUT", layoutPath(name), 201, { expectedVersion: 0, layout });
      versions.set(name, 1);
    }

    const liste = [];
    const get = [];
    const put = [];
    for (let i = 0; i < RUNS; i++) {
      liste.push((await timed(base, "GET", "/api/layouts", 200)).ms);
    }
    for (let i = 0; i < RUNS; i++) {
      get.push((await timed(base, "GET", layoutPath(names[i % LAYOUTS]), 200)).ms);
    }
    for (let i = 0; i < RUNS; i++) {
      const name = names[i % LAYOUTS];
      const expectedVersion = versions.get(name);
      const r = await timed(base, "PUT", layoutPath(name), 200, { expectedVersion, layout });
      versions.set(name, JSON.parse(r.text).version);
      put.push(r.ms);
    }

    return {
      profil: args.profil,
      zeitpunkt,
      layouts: versions.size,
      vorgaenge: [summary("liste", liste), summary("get", get), summary("put", put)],
      speicher: memory(args),
    };
  } finally {
    // Jedes eigene Layout einzeln löschen; ein Fehlschlag hält die übrigen nicht auf
    for (const [name, version] of versions) {
      try {
        await expectStatus(base, "DELETE", `${layoutPath(name)}?version=${version}`, 204);
      } catch (error) {
        process.stderr.write(`measure.mjs: Aufräumen von ${name} gescheitert: ${error.message}\n`);
        process.exitCode = 1;
      }
    }
  }
}

async function main() {
  try {
    const result = await measure(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `measure.mjs: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = error instanceof Abbruch ? error.code : 1;
  }
}

await main();
