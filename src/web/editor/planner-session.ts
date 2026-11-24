/**
 * Planer-Sitzung der Oberfläche ab M3a (Spec M3a, REQ-BEST-2 bis -9, REQ-SET-4, REQ-MODUS-1 bis
 * -4): die M2-Sitzung (`createSession`, unverändert im Verhalten) plus Bestand und Modus über
 * denselben eingereichten Speicher und dieselbe Uhr. Befehle laufen durch die Bestandsprüfung
 * (`applyInMode`); Laden und Import gehen direkt an die M2-Sitzung und werden nie abgewiesen.
 * Fehler des Speichers werden zu Meldungen, nie zu Ausnahmen. Zur Form siehe parts.ts.
 *
 * Schlüssel: `carrera-planer:bestand` (Bestand als JSON des mit `InventorySchema` kodierten
 * Dokuments; die Kodierung ist für dieses Schema die Identität), `carrera-planer:bestand:defekt:<ISO-UTC>[-n]` (kaputte Bestände),
 * `carrera-planer:modus` (zuletzt gewählter Modus). Keiner beginnt mit einem Layout-Präfix aus M2.
 */
import { ParseResult, Schema } from "effect";
import { InventorySchema } from "../../schema/index.js";
import * as logic from "./inventory.js";
import { createSession } from "./session.js";
import type {
  Catalog,
  Clock,
  Command,
  EditorMessage,
  Inventory,
  InventoryChange,
  KeyValueStorage,
  Mode,
  PlannerMessage,
  PlannerSession,
  Session,
  SetTemplate,
} from "./types.js";

function inventoryKey(): string {
  return "carrera-planer:bestand";
}

function inventoryDefectPrefix(): string {
  return "carrera-planer:bestand:defekt:";
}

function modeKey(): string {
  return "carrera-planer:modus";
}

type Parsed =
  | { readonly ok: true; readonly inventory: Inventory }
  | { readonly ok: false; readonly reason: string };

/** JSON-Parsen und `InventorySchema`-Dekodierung; nichts wird still bereinigt (REQ-BEST-5). */
function parseInventory(raw: string): Parsed {
  try {
    const r = Schema.decodeUnknownEither(InventorySchema)(JSON.parse(raw));
    return r._tag === "Right"
      ? { ok: true, inventory: r.right.counts }
      : { ok: false, reason: ParseResult.TreeFormatter.formatErrorSync(r.left) };
  } catch (e) {
    // kein JSON
    return { ok: false, reason: String(e) };
  }
}

function isMode(value: string): value is Mode {
  return value === "sandbox" || value === "bestand";
}

export function createPlannerSession(deps: {
  readonly catalog: Catalog;
  readonly templates: ReadonlyArray<SetTemplate>;
  readonly storage: KeyValueStorage;
  readonly clock: Clock;
}): PlannerSession {
  const { catalog, templates, storage, clock } = deps;
  // Eine gemeinsame Liste: Meldungen der M2-Sitzung und des Bestands in zeitlicher Reihenfolge.
  const messages: PlannerMessage[] = [];
  const session = createSession({
    catalog,
    storage,
    clock,
    messages: messages as EditorMessage[],
  });
  let inventory: Inventory = {};
  let mode: Mode = "sandbox";
  /**
   * Kaputter Bestand im Speicher, der nicht verschoben wurde (Start: REQ-BEST-5; Abgleich:
   * REQ-BEST-10): in dieser Sitzung nicht überschreiben, bis ein Abgleich einen gültigen Wert liest.
   */
  let keepStored = false;

  const attempt = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      messages.push({ kind: "speicherFehler", reason: String(e), text: String(e) });
      return fallback;
    }
  };

  const persist = (): void => {
    if (keepStored) return;
    attempt(
      () =>
        storage.setItem(inventoryKey(), JSON.stringify({ schemaVersion: 1, counts: inventory })),
      undefined,
    );
  };

  /** Kaputten Bestand unter einen freien Ausweichschlüssel verschieben (REQ-BEST-5). */
  const moveDefect = (raw: string, reason: string): void => {
    try {
      const base = inventoryDefectPrefix() + clock().utc.toISOString();
      let key = base;
      let n = 1;
      while (storage.getItem(key) !== null) {
        n++;
        key = `${base}-${n}`;
      }
      storage.setItem(key, raw);
      messages.push({
        kind: "bestandVerschoben",
        backupKey: key,
        reason,
        text: `Der gespeicherte Bestand war kaputt und liegt jetzt unter „${key}“; es gilt ein leerer Bestand. Grund: ${reason}`,
      });
      // Erst jetzt darf der Bestand überschrieben werden; ein späterer Start findet dann einen
      // gültigen leeren Bestand und verschiebt denselben Fund nicht noch einmal.
      persist();
    } catch (e) {
      keepStored = true;
      messages.push({
        kind: "bestandNichtVerschoben",
        reason,
        text: `Der gespeicherte Bestand ist kaputt (${reason}) und ließ sich nicht verschieben (${String(e)}). Er bleibt unverändert gespeichert; Änderungen am Bestand gelten nur bis zum Neuladen der Seite.`,
      });
    }
  };

  /**
   * Gelesenen gültigen Bestand übernehmen (Start, Abgleich). Gemeldet werden nicht zählende
   * Teil-IDs (REQ-BEST-7), die im bisherigen Bestand der Seite nicht standen; beim Start ist der
   * bisherige Bestand leer. Ein Schreibschutz endet.
   */
  const adopt = (next: Inventory): void => {
    const known = logic.ignoredPartIds(catalog, inventory);
    const ignored = logic.ignoredPartIds(catalog, next).filter((id) => !known.includes(id));
    inventory = next;
    keepStored = false;
    if (ignored.length > 0) {
      messages.push({
        kind: "bestandIgnoriert",
        partIds: ignored,
        text: `Der gespeicherte Bestand nennt Teile, die der Katalog nicht kennt oder die Baugruppen sind; sie zählen nicht und bleiben gespeichert: ${ignored.map((id) => `„${id}“`).join()}`,
      });
    }
  };

  attempt(() => {
    const raw = storage.getItem(inventoryKey());
    if (raw === null) return;
    const p = parseInventory(raw);
    if (p.ok) adopt(p.inventory);
    else moveDefect(raw, p.reason);
  }, undefined);

  attempt(() => {
    const raw = storage.getItem(modeKey());
    if (raw === null) return;
    if (isMode(raw)) mode = raw;
    else {
      messages.push({
        kind: "modusUngueltig",
        value: raw,
        text: `Der gespeicherte Modus „${raw}“ ist ungültig; es gilt „Sandbox“.`,
      });
    }
  }, undefined);

  /** Ergebnis einer Bestandsänderung übernehmen: Abweisung melden, sonst übernehmen und sichern. */
  const change = (partId: string, r: InventoryChange): void => {
    if (!r.ok) {
      messages.push({ kind: "bestandAbgewiesen", partId, text: r.text });
      return;
    }
    if (r.inventory === inventory) return;
    inventory = r.inventory;
    persist();
  };

  /** Was die Planer-Sitzung zur M2-Sitzung hinzufügt oder ersetzt (nur `dispatch`). */
  const own: Omit<PlannerSession, keyof Session> & Pick<PlannerSession, "dispatch"> = {
    get mode() {
      return mode;
    },
    get inventory() {
      return inventory;
    },
    dispatch(command: Command): void {
      const r = logic.applyInMode(catalog, inventory, mode, session.state, command);
      if (r.rejection === undefined) session.dispatch(command);
      else {
        messages.push({
          kind: "befehlAbgewiesen",
          partId: r.rejection.partId,
          text: r.rejection.text,
        });
      }
    },
    setMode(next: Mode): void {
      mode = next;
      attempt(() => storage.setItem(modeKey(), next), undefined);
    },
    setCount: (partId: string, input: string) =>
      change(partId, logic.setCount(catalog, inventory, partId, input)),
    increment: (partId: string) => change(partId, logic.increment(catalog, inventory, partId)),
    decrement: (partId: string) => change(partId, logic.decrement(catalog, inventory, partId)),
    addSet(templateId: string, confirmed: boolean): void {
      const template = templates.find((t) => t.id === templateId);
      if (!confirmed || template === undefined) return;
      inventory = logic.addSet(inventory, template);
      persist();
    },
    clearInventory(confirmed: boolean): void {
      if (!confirmed) return;
      inventory = {};
      persist();
    },
    inventoryDefectBackups: () =>
      attempt(
        () =>
          Array.from({ length: storage.length }, (_, i) => storage.key(i) as string).filter((k) =>
            k.startsWith(inventoryDefectPrefix()),
          ),
        [],
      ),
    inventoryDefectRawText: (key: string) =>
      attempt(() => storage.getItem(key) ?? undefined, undefined),
    deleteInventoryDefect: (key: string) => attempt(() => storage.removeItem(key), undefined),
    /**
     * Abgleich zwischen Tabs (REQ-BEST-10): nur für den Bestandsschlüssel oder null. Der Wert wird
     * neu aus dem Speicher gelesen; ein fehlender Schlüssel gilt als leerer Bestand. Ein kaputter
     * Wert wird nicht verschoben (jedes Tab bekommt das Ereignis), der Bestand der Seite bleibt und
     * die Sitzung schreibt ihn nicht mehr. Der Abgleich selbst schreibt nie.
     */
    storageChanged(key: string | null): void {
      if (key !== null && key !== inventoryKey()) return;
      attempt(() => {
        const raw = storage.getItem(inventoryKey());
        const p: Parsed = raw === null ? { ok: true, inventory: {} } : parseInventory(raw);
        if (p.ok) {
          adopt(p.inventory);
          return;
        }
        keepStored = true;
        messages.push({
          kind: "bestandAbgleichKaputt",
          reason: p.reason,
          text: `Ein anderes Tab hat einen kaputten Bestand gespeichert (${p.reason}). Diese Seite behält ihre Zahlen; Änderungen am Bestand gelten nur bis zum Neuladen, dann wird der kaputte Wert beiseitegelegt.`,
        });
      }, undefined);
    },
  };

  // Alles der M2-Sitzung übernehmen, Getter als Getter (Zustand, Name und die gemeinsame
  // Meldungsliste bleiben live); darüber die eigenen Eigenschaften.
  return Object.defineProperties(
    Object.defineProperties({}, Object.getOwnPropertyDescriptors(session)),
    Object.getOwnPropertyDescriptors(own),
  ) as PlannerSession;
}
