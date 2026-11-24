/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): gemeinsame Vertragstypen, Lader und Fixtures für
 * die Tests von Bestand, Set-Vorlagen, Bestandsmodus und Einkaufsliste. Kein Produktcode: nur die
 * von spec-to-tests gewählte Schnittstelle als Typen, Testdaten und Erzeuger. Ergänzt
 * `editor-fixtures.ts` (M2), das unverändert bleibt (Entscheidung 14).
 *
 * Liegt außerhalb von `src/web/editor`, damit der Stryker-Ratchet diese Datei nicht mutiert.
 *
 * ## Gewählte Schnittstelle (implement setzt genau diese Module und Exporte um)
 *
 * - `src/schema/index.ts` exportiert zusätzlich `InventorySchema` und `SetTemplateSchema`;
 *   `CatalogEntrySchema` bekommt das optionale Feld `praegung` (REQ-BEST-1, REQ-SET-1,
 *   REQ-PRAEG-1).
 * - `src/catalog/index.ts` exportiert zusätzlich `SET_TEMPLATES: ReadonlyArray<SetTemplate>`
 *   (REQ-SET-2), z. B. aus `src/catalog/sets.ts`.
 * - `src/web/editor/inventory.ts` (InventoryApi): reine Funktionen über Katalog, Bestand und
 *   Elementfolge: Bestand ändern, Set addieren, Befehl im Modus anwenden, Leiste mit Rest,
 *   Einkaufsliste. Der Katalog ist immer Argument; Verbrauch kommt nur aus `consumption` des Kerns
 *   (REQ-BARCH-2).
 * - `src/web/editor/planner-session.ts` (PlannerSessionApi): `createPlannerSession` — die Sitzung
 *   der Oberfläche ab M3a. Sie umfasst alles der M2-Sitzung (`createSession`, unverändert) und
 *   zusätzlich Bestand, Modus und deren Speicherung über denselben eingereichten Speicher und
 *   dieselbe Uhr. Die M2-Sitzung bleibt bestehen, damit die M2-Tests unverändert laufen
 *   (REQ-MODUS-2); wie die Planer-Sitzung sie nutzt (z. B. umhüllt), ist frei.
 *
 * Bestätigungen (Set-Vorlage hinzufügen, Bestand leeren) sind UI; die Logik bekommt sie als
 * ausdrückliches Argument `confirmed` (REQ-SET-4, REQ-BEST-9). Das Löschen defekter
 * Bestandssicherungen geschieht wie in M2 auf Aufruf (die Rückfrage ist UI).
 *
 * Speicherschlüssel legt die Spec fest (REQ-BEST-3, -5, REQ-MODUS-1); sie stehen unten als
 * Konstanten und sind keine Exporte der Implementierung.
 *
 * Die Module werden in den Tests dynamisch über einen Pfad in einer Variablen geladen; so
 * typchecken und laden die Testdateien, bevor es die Module gibt.
 */
import fc from "fast-check";
import * as catalogModule from "../../catalog/index.js";
import { CATALOG } from "../../catalog/index.js";
import type { CatalogEntry, LayoutElement, Turn } from "../../core/index.js";
import type {
  Clock,
  Command,
  EditorMessage,
  EditorState,
  KeyValueStorage,
  Session,
} from "./editor-fixtures.js";

type Catalog = ReadonlyArray<CatalogEntry>;
type Elements = ReadonlyArray<LayoutElement>;

// ---------------------------------------------------------------------------------------------
// Datenvertrag (src/schema) und Daten (src/catalog)
// ---------------------------------------------------------------------------------------------

export type Certainty = "hoch" | "mittel" | "niedrig";

/** Prägungseintrag (REQ-PRAEG-1). */
export type Praegung = {
  readonly value: string;
  readonly source: string;
  readonly certainty: Certainty;
};

/** Katalogeintrag mit dem optionalen Feld `praegung` (REQ-PRAEG-1). */
export type CatalogEntryWithPraegung = CatalogEntry & {
  readonly praegung?: ReadonlyArray<Praegung>;
};

/** Set-Vorlage (REQ-SET-1). */
export type SetTemplate = {
  readonly id: string;
  readonly name: string;
  readonly articleNumber: string;
  readonly source: string;
  readonly certainty: Certainty;
  readonly contents: ReadonlyArray<{ readonly part: string; readonly count: number }>;
};

/** Gespeicherter Bestand (REQ-BEST-1). */
export type InventoryDoc = {
  readonly schemaVersion: 1;
  readonly counts: Readonly<Record<string, number>>;
};

/** `SET_TEMPLATES` aus `src/catalog/index.ts`; wirft, solange es fehlt (rot statt still leer). */
export const productTemplates = (): ReadonlyArray<SetTemplate> => {
  const t = (catalogModule as unknown as { readonly SET_TEMPLATES?: ReadonlyArray<SetTemplate> })
    .SET_TEMPLATES;
  if (t === undefined) throw new Error("src/catalog exportiert SET_TEMPLATES nicht");
  return t;
};

// ---------------------------------------------------------------------------------------------
// Vertragstypen: inventory.ts
// ---------------------------------------------------------------------------------------------

/**
 * Bestand: Teil-ID → Anzahl. Eine fehlende Teil-ID heißt Anzahl 0. Einträge, die der Katalog nicht
 * kennt oder die eine Baugruppe bezeichnen, dürfen darin stehen (REQ-BEST-7); sie zählen nicht.
 */
export type Inventory = Readonly<Record<string, number>>;

/** Ergebnis einer Bestandsänderung: neuer Bestand oder Abweisung mit Meldungstext. */
export type InventoryChange =
  | { readonly ok: true; readonly inventory: Inventory }
  | { readonly ok: false; readonly text: string };

export type Mode = "sandbox" | "bestand";

/**
 * Abweisung eines Befehls im Modus „Bestand“ (REQ-MODUS-3). partId/name: das betroffene Teil
 * (Verbrauch gestiegen und über dem Bestand); bei nicht bestimmbarem Verbrauch frei.
 */
export type Rejection = {
  readonly partId: string | undefined;
  readonly name: string | undefined;
  readonly text: string;
};

export type ModeResult = {
  readonly state: EditorState;
  /** undefined: Befehl wurde angewandt (wie `apply`); sonst ist `state` der unveränderte Zustand. */
  readonly rejection: Rejection | undefined;
};

/**
 * Leisteneintrag im Modus „Bestand“ (REQ-MODUS-5): die M2-Felder plus Bestand und Rest.
 * stock: Bestand bei bestandsfähigen Einträgen, sonst (Baugruppe) undefined.
 * rest: Bestand − Verbrauch bei bestandsfähigen Einträgen; undefined bei Baugruppen und wenn der
 *   Verbrauch nicht bestimmbar ist.
 * locked: nur platzierbare Einträge können gesperrt sein (Rest ≤ 0 oder Verbrauch unbestimmbar).
 */
export type StockPaletteEntry = {
  readonly partId: string;
  readonly name: string;
  readonly kind: "platzierbar" | "ausgeblendet" | "masseFehlen";
  readonly stock: number | undefined;
  readonly rest: number | undefined;
  readonly locked: boolean;
};

/**
 * Suchbegriff einer Zeile (REQ-EINK-3). `text` ist die Anzeige: bei Artikelnummern die Nummer
 * selbst, bei Prägungen „Prägung <Wert>“, bei Hinweisen der Hinweistext.
 */
export type SearchTerm =
  | { readonly kind: "artikelnummer"; readonly value: string; readonly text: string }
  | { readonly kind: "praegung"; readonly value: string; readonly text: string }
  | { readonly kind: "hinweis"; readonly text: string };

export type ShoppingRow = {
  readonly partId: string;
  readonly name: string;
  /** Verbrauch */
  readonly needed: number;
  /** Bestand */
  readonly have: number;
  /** Fehlmenge */
  readonly missing: number;
  readonly searchTerms: ReadonlyArray<SearchTerm>;
};

/**
 * Einkaufsliste (REQ-EINK-1/-2). ok: Zeilen in Katalogreihenfolge, Summe der Fehlmengen; `text`
 * ist „alles vorhanden“ ohne Zeilen und undefined mit Zeilen. Nicht bestimmbar: ok false, Text
 * „Einkaufsliste nicht bestimmbar“.
 */
export type ShoppingList =
  | {
      readonly ok: true;
      readonly rows: ReadonlyArray<ShoppingRow>;
      readonly total: number;
      readonly text: "alles vorhanden" | undefined;
    }
  | { readonly ok: false; readonly text: string };

export type InventoryApi = {
  /** Katalogeintrag bekannt und keine Baugruppe („bestandsfähig“). */
  isStockable(catalog: Catalog, partId: string): boolean;
  /** Anzahl auf den eingegebenen Text setzen (Zahlenfeld); nur ganze Zahl ≥ 0 (REQ-BEST-2). */
  setCount(catalog: Catalog, inventory: Inventory, partId: string, input: string): InventoryChange;
  increment(catalog: Catalog, inventory: Inventory, partId: string): InventoryChange;
  /**
   * Bei Anzahl 0 ändert „−1“ nichts und liefert keine Meldung (REQ-BEST-2, Überarbeitung 2): bei
   * bestandsfähiger ID `{ ok: true }` mit unverändertem Bestand. Unbekannte und Baugruppen-IDs
   * werden wie bei Setzen und „+1“ abgewiesen.
   */
  decrement(catalog: Catalog, inventory: Inventory, partId: string): InventoryChange;
  /** „−1“ verfügbar: bestandsfähig und Anzahl ≥ 1. */
  decrementAvailable(catalog: Catalog, inventory: Inventory, partId: string): boolean;
  /** Inhalt einer Set-Vorlage addieren (REQ-SET-4). */
  addSet(inventory: Inventory, template: SetTemplate): Inventory;
  /**
   * Teil-IDs im Bestand, die nicht bestandsfähig sind und Anzahl ≥ 1 haben (REQ-BEST-7: die zu
   * meldenden; Einträge mit Anzahl 0 werden mitgeführt, aber nicht gemeldet), aufsteigend sortiert.
   */
  ignoredPartIds(catalog: Catalog, inventory: Inventory): ReadonlyArray<string>;
  /** Befehl im Modus anwenden; „sandbox“ wirkt exakt wie M2 `apply` (REQ-MODUS-2/-3/-4). */
  applyInMode(
    catalog: Catalog,
    inventory: Inventory,
    mode: Mode,
    state: EditorState,
    command: Command,
  ): ModeResult;
  /** Leisten-Einteilung im Modus „Bestand“ (REQ-MODUS-5). */
  stockPalette(
    catalog: Catalog,
    inventory: Inventory,
    elements: Elements,
  ): ReadonlyArray<StockPaletteEntry>;
  shoppingList(catalog: Catalog, inventory: Inventory, elements: Elements): ShoppingList;
  /**
   * Kurzform für die Statusleiste (REQ-EINK-5): „Bestand reicht“ bei leerer Liste, „fehlt 1 Teil“
   * bei Summe 1, „fehlen n Teile“ bei Summe n ≥ 2, „Einkaufsliste nicht bestimmbar“ bei nicht
   * bestimmbarem Verbrauch.
   */
  shoppingShort(list: ShoppingList): string;
};

// ---------------------------------------------------------------------------------------------
// Vertragstypen: planner-session.ts
// ---------------------------------------------------------------------------------------------

export type InventoryMessage =
  /** Bestandsänderung abgewiesen (REQ-BEST-2). */
  | { readonly kind: "bestandAbgewiesen"; readonly partId: string; readonly text: string }
  /** Kaputter Bestand verschoben (REQ-BEST-5). */
  | {
      readonly kind: "bestandVerschoben";
      readonly backupKey: string;
      readonly reason: string;
      readonly text: string;
    }
  /** Kaputter Bestand ließ sich nicht verschieben (REQ-BEST-5). */
  | { readonly kind: "bestandNichtVerschoben"; readonly reason: string; readonly text: string }
  /**
   * Unbekannte oder Baugruppen-IDs mit Anzahl ≥ 1 im gespeicherten Bestand (REQ-BEST-7),
   * aufsteigend sortiert. Gibt es keine, entsteht keine solche Meldung.
   */
  | {
      readonly kind: "bestandIgnoriert";
      readonly partIds: ReadonlyArray<string>;
      readonly text: string;
    }
  /** Ungültiger gespeicherter Modus (REQ-MODUS-1). */
  | { readonly kind: "modusUngueltig"; readonly value: string; readonly text: string }
  /** Befehl im Modus „Bestand“ abgewiesen (REQ-MODUS-3). */
  | {
      readonly kind: "befehlAbgewiesen";
      readonly partId: string | undefined;
      readonly text: string;
    };

/**
 * Speicherfehler beim Bestand (REQ-BEST-6) und beim Modus (REQ-MODUS-1) melden sich wie in M2 als
 * `speicherFehler`.
 */
export type PlannerMessage = EditorMessage | InventoryMessage;

export type PlannerSession = Omit<Session, "messages"> & {
  readonly messages: ReadonlyArray<PlannerMessage>;
  readonly mode: Mode;
  /** Aktueller Bestand im Speicher der Seite, einschließlich Einträgen nach REQ-BEST-7. */
  readonly inventory: Inventory;
  /** Moduswechsel (REQ-MODUS-1): kein Verlaufseintrag, kein Schreiben des Arbeitsstands. */
  setMode(mode: Mode): void;
  setCount(partId: string, input: string): void;
  increment(partId: string): void;
  decrement(partId: string): void;
  /** Set-Vorlage (ID aus `templates`) addieren; nur mit confirmed = true (REQ-SET-4). */
  addSet(templateId: string, confirmed: boolean): void;
  /** „Bestand leeren“; nur mit confirmed = true (REQ-BEST-9). */
  clearInventory(confirmed: boolean): void;
  /** Schlüssel defekter Bestandssicherungen (REQ-BEST-5). */
  inventoryDefectBackups(): ReadonlyArray<string>;
  inventoryDefectRawText(key: string): string | undefined;
  deleteInventoryDefect(key: string): void;
};

export type PlannerSessionApi = {
  createPlannerSession(deps: {
    readonly catalog: Catalog;
    readonly templates: ReadonlyArray<SetTemplate>;
    readonly storage: KeyValueStorage;
    readonly clock: Clock;
  }): PlannerSession;
};

// ---------------------------------------------------------------------------------------------
// Lader und Schlüssel
// ---------------------------------------------------------------------------------------------

const INVENTORY_MODULE = "../editor/inventory.js";
const PLANNER_SESSION_MODULE = "../editor/planner-session.js";

export const BESTAND_MODULE_PATHS = [INVENTORY_MODULE, PLANNER_SESSION_MODULE];

export const loadInventory = async (): Promise<InventoryApi> =>
  (await import(/* @vite-ignore */ INVENTORY_MODULE)) as InventoryApi;
export const loadPlannerSession = async (): Promise<PlannerSessionApi> =>
  (await import(/* @vite-ignore */ PLANNER_SESSION_MODULE)) as PlannerSessionApi;

/** Feste Schlüssel aus der Spec. */
export const INVENTORY_KEY = "carrera-planer:bestand";
export const INVENTORY_DEFECT_PREFIX = "carrera-planer:bestand:defekt:";
export const MODE_KEY = "carrera-planer:modus";

// ---------------------------------------------------------------------------------------------
// Fixtures aus der Spec (unabhängig von den Produktdaten)
// ---------------------------------------------------------------------------------------------

/** Tabelle „Set-Vorlagen M3a“, als Bestand. */
export const MACH8: Inventory = {
  "gerade-342": 4,
  "gerade-114": 1,
  "kurve-1-90": 6,
  engstelle: 1,
  kreuzung: 1,
  anschlussstueck: 1,
  rundenzaehler: 1,
  "looping-teil": 8,
  "steilkehre-teil": 4,
};
export const AUSBAU1: Inventory = { "kurve-1-90": 2, "spurwechsel-gerade": 2, "gerade-342": 2 };
export const AUSBAU3: Inventory = { "gerade-342": 8, "kurve-1-45": 4, "steilkurve-1-45": 4 };
export const WIRELESS: Inventory = { "wireless-anschluss": 1 };
/** Summenzeile unter der Tabelle (49 Teile). */
export const SUMME3: Inventory = {
  "gerade-342": 14,
  "gerade-114": 1,
  "kurve-1-90": 8,
  "kurve-1-45": 4,
  "steilkurve-1-45": 4,
  "spurwechsel-gerade": 2,
  engstelle: 1,
  kreuzung: 1,
  anschlussstueck: 1,
  rundenzaehler: 1,
  "looping-teil": 8,
  "steilkehre-teil": 4,
};

const template = (
  id: string,
  name: string,
  articleNumber: string,
  certainty: Certainty,
  inv: Inventory,
): SetTemplate => ({
  id,
  name,
  articleNumber,
  source: "Spec M3a, Tabelle Set-Vorlagen",
  certainty,
  contents: Object.entries(inv).map(([part, count]) => ({ part, count })),
});

/** Vorlagen für Sitzungstests (eingereicht, unabhängig von `SET_TEMPLATES`). */
export const T_MACH8 = template("t-mach8", "Mach 8", "20062492", "hoch", MACH8);
export const T_AUSBAU1 = template("t-ausbau1", "Ausbauset 1", "20061600", "niedrig", AUSBAU1);
export const T_AUSBAU3 = template("t-ausbau3", "Ausbauset 3", "20061614", "mittel", AUSBAU3);
export const T_WIRELESS = template(
  "t-wireless",
  "Wireless Upgrade Kit",
  "20061676",
  "hoch",
  WIRELESS,
);
export const TEMPLATES: ReadonlyArray<SetTemplate> = [T_MACH8, T_AUSBAU1, T_AUSBAU3, T_WIRELESS];

/** Bestand ohne Einträge mit Anzahl 0 (Anzahl 0 und fehlender Schlüssel gelten als gleich). */
export const normalized = (inv: Inventory): Record<string, number> =>
  Object.fromEntries(
    Object.entries(inv)
      .filter(([, n]) => n !== 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

export const countIn = (inv: Inventory, partId: string): number => inv[partId] ?? 0;

/** Summe zweier Bestände. */
export const plus = (a: Inventory, b: Inventory): Inventory => {
  const out: Record<string, number> = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
};

export const sumOf = (inv: Inventory): number => Object.values(inv).reduce((s, n) => s + n, 0);

/** Bestandsfähige Katalog-IDs (keine Baugruppe), in Katalogreihenfolge. */
export const STOCKABLE_IDS = CATALOG.filter((e) => e.geometry.kind !== "baugruppe").map(
  (e) => e.id,
);
export const ASSEMBLY_IDS = CATALOG.filter((e) => e.geometry.kind === "baugruppe").map((e) => e.id);

/** Kodiertes Bestandsdokument (Erwartung an den gespeicherten Wert). */
export const inventoryDoc = (counts: Inventory): InventoryDoc => ({ schemaVersion: 1, counts });

/** Gespeicherten Bestand lesen (JSON), normalisiert; undefined ohne Schlüssel. */
export const storedCounts = (
  data: ReadonlyMap<string, string>,
): Record<string, number> | undefined => {
  const raw = data.get(INVENTORY_KEY);
  if (raw === undefined) return undefined;
  const doc = JSON.parse(raw) as InventoryDoc;
  return normalized(doc.counts);
};

// ---------------------------------------------------------------------------------------------
// Erzeuger (fast-check)
// ---------------------------------------------------------------------------------------------

const UNKNOWN_INVENTORY_IDS = ["gibt-es-nicht", "kurve-9-90"];

/** Bestände über bestandsfähige IDs (Anzahlen 0 … 12). */
export const stockInventoryArb: fc.Arbitrary<Inventory> = fc.dictionary(
  fc.constantFrom(...STOCKABLE_IDS),
  fc.nat({ max: 12 }),
  { maxKeys: STOCKABLE_IDS.length },
);

/** Bestände einschließlich unbekannter IDs und Baugruppen-IDs (REQ-BEST-7). */
export const anyInventoryArb: fc.Arbitrary<Inventory> = fc.dictionary(
  fc.constantFrom(...STOCKABLE_IDS, ...ASSEMBLY_IDS, ...UNKNOWN_INVENTORY_IDS),
  fc.nat({ max: 12 }),
  { maxKeys: 12 },
);

/** Nur die nicht zählenden Einträge (unbekannt oder Baugruppe). */
export const ignoredOnlyArb: fc.Arbitrary<Inventory> = fc.dictionary(
  fc.constantFrom(...ASSEMBLY_IDS, ...UNKNOWN_INVENTORY_IDS),
  fc.integer({ min: 1, max: 12 }),
  { maxKeys: 4 },
);

/** Set-Vorlagen über bestandsfähige Teile (je Teil-ID höchstens einmal, count ≥ 1). */
export const templateArb: fc.Arbitrary<SetTemplate> = fc
  .uniqueArray(fc.constantFrom(...STOCKABLE_IDS), { minLength: 1, maxLength: 6 })
  .chain((parts) =>
    fc.tuple(
      fc.constant(parts),
      fc.array(fc.integer({ min: 1, max: 9 }), {
        minLength: parts.length,
        maxLength: parts.length,
      }),
      fc.nat({ max: 99 }),
    ),
  )
  .map(([parts, counts, n]) => ({
    id: `gen-${n}`,
    name: `Generiert ${n}`,
    articleNumber: String(20069000 + n),
    source: "Test",
    certainty: "niedrig" as const,
    contents: parts.map((part, i) => ({ part, count: counts[i] as number })),
  }));

/** Folgen aus Katalog-Teilen (auch Baugruppen und nicht platzierbare), Querungen; ohne unbekannte. */
export const catalogElementsArb: fc.Arbitrary<Elements> = fc
  .array(
    fc.record({
      cross: fc.nat({ max: 7 }),
      part: fc.constantFrom(...CATALOG.map((e) => e.id)),
      turn: fc.constantFrom<Turn | undefined>(undefined, "links", "rechts"),
      ref: fc.nat(),
    }),
    { maxLength: 25 },
  )
  .map((raw) =>
    raw.map((r, i): LayoutElement => {
      const id = `c${i}`;
      if (r.cross === 0 && i > 0) return { id, crosses: `c${r.ref % i}` };
      return r.turn === undefined ? { id, part: r.part } : { id, part: r.part, turn: r.turn };
    }),
  );
