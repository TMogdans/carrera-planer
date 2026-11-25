/**
 * Einstellungen des Servers (Spec M3b Teil A, REQ-SRV-1 und REQ-SRV-7): Umgebungsvariablen mit
 * Vorgaben, Port, Erlaubtliste der `Host`-Angaben. Reine Funktionen ohne I/O.
 */
import { resolve } from "node:path";

// ---------------------------------------------------------------------------------------------
// Einstellungen (REQ-SRV-1, REQ-SRV-7)
// ---------------------------------------------------------------------------------------------

export type Env = Readonly<Record<string, string | undefined>>;

/** Wirksame Konfiguration; `staticDir` ist aufgelöst, `db` so wie angegeben. */
export type Config = {
  readonly host: string;
  readonly port: number;
  readonly db: string;
  readonly staticDir: string;
  readonly allowed: ReadonlyArray<string>;
};

/**
 * Host-Angabe in Vergleichsform `name:port` (klein geschrieben, ohne Port gilt `defaultPort`);
 * `""` für eine ungültige Angabe (leer, mit Schema, Pfad, Abfrage, Port 0 oder außerhalb 1–65535).
 * Geparst als Autorität einer URL ohne Standardport, damit `:80` erhalten bleibt.
 */
export function hostKey(raw: string, defaultPort: number): string {
  const entry = raw.trim().toLowerCase();
  const url = URL.parse(`x://${entry}`);
  if (url === null || entry === "" || url.host !== entry || url.port === "0") return "";
  return url.port === "" ? `${entry}:${defaultPort}` : entry;
}

function readPort(text: string): number {
  const port = Number(text);
  if (!(Number.isInteger(port) && port > 0 && port < 65536 && String(port) === text)) {
    throw new Error(`CARRERA_PORT ungültig: „${text}“ (erwartet eine ganze Zahl von 1 bis 65535)`);
  }
  return port;
}

function readAllowedHosts(text: string, port: number): ReadonlyArray<string> {
  return (text === "" ? [] : text.split(",")).map((entry) => {
    const key = hostKey(entry, port);
    if (key === "") {
      throw new Error(
        `CARRERA_ALLOWED_HOSTS: ungültiger Eintrag „${entry}“ (erwartet Name oder Adresse, optional mit :Port 1–65535)`,
      );
    }
    return key;
  });
}

/**
 * Wirksame Konfiguration aus den Umgebungsvariablen mit den Vorgaben aus REQ-SRV-1. Wirft mit
 * Meldung (Name der Variable, Wert) bei ungültigem Port oder Eintrag der Erlaubtliste.
 */
export function resolveConfig(env: Env): Config {
  const host = env.CARRERA_HOST ?? "0.0.0.0";
  const port = readPort(env.CARRERA_PORT ?? "8080");
  const entries = readAllowedHosts(env.CARRERA_ALLOWED_HOSTS ?? "", port);
  const defaults = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  return {
    host,
    port,
    db: env.CARRERA_DB ?? "data/carrera-planer.sqlite",
    staticDir: resolve(env.CARRERA_STATIC ?? "dist"),
    allowed: [...(host === "0.0.0.0" ? defaults : [...defaults, `${host}:${port}`]), ...entries],
  };
}
