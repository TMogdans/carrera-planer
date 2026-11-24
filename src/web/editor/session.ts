/**
 * Sitzung über eingereichten Speicher und eingereichte Uhr (Spec M2, REQ-STORE-1 bis -11):
 * Autosicherung, benannte Layouts, defekte Sicherungen, Export und Import. Fehler des Speichers
 * werden zu Meldungen, nie zu Ausnahmen (REQ-STORE-8). Zur Form siehe parts.ts.
 *
 * Schlüssel (Präfix `carrera-planer`):
 * - benannte Layouts unter `carrera-planer:layout:<Name>` (Name getrimmt, nie leer);
 * - der Arbeitsstand ist das namenlose Layout `carrera-planer:layout:` (der leere Name ist als
 *   Speichername ausgeschlossen und wird nicht aufgelistet);
 * - defekte Sicherungen unter `carrera-planer:defekt:<ISO-UTC>[-n]` (REQ-STORE-7).
 * Jeder Wert ist genau das JSON des Layouts (REQ-STORE-1).
 */
import { ParseResult, Schema } from "effect";
import { type Layout, LayoutSchema } from "../../schema/index.js";
import { apply, forgetHistory, initialState } from "./editor.js";
import type {
  Catalog,
  Clock,
  ClockReading,
  Command,
  EditorMessage,
  Elements,
  ImportErrorArt,
  KeyValueStorage,
  SaveResult,
  Session,
} from "./types.js";

/** Präfix aller Schlüssel dieser Anwendung. */
export const STORAGE_PREFIX = "carrera-planer";

/**
 * Fester Schlüssel des Arbeitsstands (REQ-STORE-2). Dieselben Schlüssel bildet die Sitzung intern
 * aus eigenen Literalen (`layoutPrefix`, `defectPrefix`); stimmen sie nicht mit diesen Exporten
 * überein, scheitern die Tests (die Exporte sind Teil des Vertrags).
 */
export const WORKING_KEY = `${STORAGE_PREFIX}:layout:`;

function layoutPrefix(): string {
  return "carrera-planer:layout:";
}

function defectPrefix(): string {
  return "carrera-planer:defekt:";
}

export function layoutKey(name: string): string {
  return layoutPrefix() + name.trim();
}

type Parsed =
  | { readonly ok: true; readonly elements: Elements }
  | { readonly ok: false; readonly art: ImportErrorArt; readonly reason: string };

/** JSON-Parsen und `LayoutSchema`-Dekodierung; nichts wird still bereinigt (REQ-STORE-5/-11). */
function parse(raw: string | null): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(String(raw));
  } catch (e) {
    return { ok: false, art: "keine JSON-Datei", reason: String(e) };
  }
  const r = Schema.decodeUnknownEither(LayoutSchema)(json);
  if (r._tag === "Right") return { ok: true, elements: r.right.elements };
  return {
    ok: false,
    art:
      Object(json).schemaVersion === 1
        ? "Strecke ungültig"
        : "keine Strecke dieses Planers oder andere Version",
    reason: ParseResult.TreeFormatter.formatErrorSync(r.left),
  };
}

/** Das mit `LayoutSchema` kodierte Layout (die Kodierung ist für dieses Schema die Identität). */
function layoutOf(elements: Elements): Layout {
  return { schemaVersion: 1, elements };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Exportname ohne Namen aus den lokalen Bestandteilen der Uhr (REQ-STORE-9). */
function stampName({ local }: ClockReading): string {
  return `strecke-${local.year}-${pad(local.month)}-${pad(local.day)}-${pad(local.hour)}${pad(local.minute)}.json`;
}

/** Verbotene Zeichen, C0 und DEL werden zu `_`; C1 bleibt (REQ-STORE-9). */
function fileSafe(name: string): string {
  return [...name]
    .map((ch) => ('/\\:*?"<>|'.includes(ch) || ch <= "\u001f" || ch === "\u007f" ? "_" : ch))
    .join("");
}

/** Dateiname ohne Endung `.json`, Groß-/Kleinschreibung egal (REQ-STORE-10). */
function baseName(fileName: string): string {
  return fileName.toLowerCase().endsWith(".json") ? fileName.slice(0, -5) : fileName;
}

export function createSession(deps: {
  readonly catalog: Catalog;
  readonly storage: KeyValueStorage;
  readonly clock: Clock;
  /**
   * Liste, in die die Sitzung ihre Meldungen schreibt (Spec M3a): Die Planer-Sitzung reicht ihre
   * eigene ein, damit Layout- und Bestandsmeldungen in einer zeitlichen Reihenfolge stehen.
   * Ohne Angabe eine eigene, leere Liste.
   */
  readonly messages?: EditorMessage[];
}): Session {
  const { catalog, storage, clock, messages = [] } = deps;
  let state = initialState();
  let name: string | undefined;
  /** Kaputter Arbeitsstand ließ sich nicht verschieben: in dieser Sitzung nicht überschreiben. */
  let keepWorking = false;

  const report = (e: unknown): void => {
    messages.push({ kind: "speicherFehler", reason: String(e), text: String(e) });
  };

  const attempt = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      report(e);
      return fallback;
    }
  };

  const persist = (): void => {
    if (keepWorking) return;
    attempt(
      () => storage.setItem(layoutPrefix(), JSON.stringify(layoutOf(state.elements))),
      undefined,
    );
  };

  const dispatch = (command: Command): void => {
    // „Neu“ beginnt eine Strecke ohne Namen: Export dann mit Zeitstempel (REQ-STORE-9).
    if (command.type === "new") name = undefined;
    const next = apply(catalog, state, command);
    const changed = next.elements !== state.elements;
    state = next;
    if (changed) persist();
  };

  /** Schlüssel mit dem Präfix, ohne das Präfix; bei Speicherfehler leer. */
  const keysWith = (prefix: string): string[] =>
    attempt(
      () =>
        Array.from({ length: storage.length }, (_, i) => storage.key(i) as string)
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length)),
      [],
    );

  /** Kaputten Arbeitsstand unter einen freien Ausweichschlüssel verschieben (REQ-STORE-7). */
  const moveDefect = (raw: string, reason: string): void => {
    try {
      const base = defectPrefix() + clock().utc.toISOString();
      let key = base;
      let n = 1;
      while (storage.getItem(key) !== null) {
        n++;
        key = `${base}-${n}`;
      }
      storage.setItem(key, raw);
      messages.push({
        kind: "arbeitsstandVerschoben",
        backupKey: key,
        reason,
        text: `Der gesicherte Arbeitsstand war kaputt und liegt jetzt unter „${key}“: ${reason}`,
      });
      // Erst jetzt darf der Arbeitsstand überschrieben werden (leere Folge), damit ein erneuter
      // Start denselben Fund nicht noch einmal verschiebt.
      persist();
    } catch (e) {
      keepWorking = true;
      messages.push({
        kind: "arbeitsstandNichtVerschoben",
        reason,
        text: `Der gesicherte Arbeitsstand ist kaputt (${reason}) und ließ sich nicht verschieben (${String(e)}). Er bleibt unverändert gespeichert und wird in dieser Sitzung nicht überschrieben.`,
      });
    }
  };

  attempt(() => {
    const raw = storage.getItem(layoutPrefix());
    if (raw === null) return;
    const p = parse(raw);
    if (p.ok) state = forgetHistory(apply(catalog, state, { type: "load", elements: p.elements }));
    else moveDefect(raw, p.reason);
  }, undefined);

  return {
    get state() {
      return state;
    },
    get name() {
      return name;
    },
    get messages() {
      return messages;
    },
    dispatch,
    saveAs(raw: string, options?: { readonly overwrite: boolean }): SaveResult {
      const trimmed = raw.trim();
      if (trimmed === "") return { ok: false, reason: "nameLeer" };
      const key = layoutKey(raw);
      return attempt<SaveResult>(
        () => {
          if (options?.overwrite !== true && storage.getItem(key) !== null) {
            return { ok: false, reason: "existiert" };
          }
          storage.setItem(key, JSON.stringify(layoutOf(state.elements)));
          name = trimmed;
          return { ok: true };
        },
        { ok: false, reason: "speicherFehler" },
      );
    },
    savedNames: () =>
      keysWith(layoutPrefix())
        .filter((n) => n !== "")
        .sort((a, b) => a.localeCompare(b, "de")),
    load(layoutName: string): void {
      try {
        const p = parse(storage.getItem(layoutKey(layoutName)));
        if (p.ok) {
          dispatch({ type: "load", elements: p.elements });
          name = layoutName;
        } else {
          messages.push({
            kind: "ladenFehlgeschlagen",
            name: layoutName,
            reason: p.reason,
            text: `„${layoutName}“ ließ sich nicht laden: ${p.reason}`,
          });
        }
      } catch (e) {
        report(e);
      }
    },
    deleteSaved: (layoutName: string) =>
      attempt(() => storage.removeItem(layoutKey(layoutName)), undefined),
    defectBackups: () => keysWith(defectPrefix()).map((t) => defectPrefix() + t),
    defectRawText: (key: string) => attempt(() => storage.getItem(key) ?? undefined, undefined),
    deleteDefect: (key: string) => attempt(() => storage.removeItem(key), undefined),
    exportFile: () => ({
      fileName: name === undefined ? stampName(clock()) : `${fileSafe(name)}.json`,
      text: JSON.stringify(layoutOf(state.elements), null, 2),
    }),
    importFile(fileName: string, text: string): void {
      const p = parse(text);
      if (p.ok) {
        dispatch({ type: "load", elements: p.elements });
        name = baseName(fileName);
      } else {
        messages.push({
          kind: "importFehlgeschlagen",
          fileName,
          art: p.art,
          reason: p.reason,
          text: `„${fileName}“ ließ sich nicht importieren: ${p.art} (${p.reason})`,
        });
      }
    },
  };
}
