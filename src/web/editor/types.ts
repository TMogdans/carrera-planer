/**
 * Typen der Editor-Logik (Spec M2, .specify/specs/m2-editor/spec.md). Sie spiegeln die von
 * spec-to-tests gewählte Schnittstelle (src/web/test-support/editor-fixtures.ts); die Übereinstimmung
 * prüft `tsc` über `src/web/editor/index.ts`. Nur Typen, keine Laufzeit.
 */
import type { CatalogEntry, LayoutElement, Turn } from "../../core/index.js";

export type Catalog = ReadonlyArray<CatalogEntry>;
export type Elements = ReadonlyArray<LayoutElement>;

/** Aktion bei bestehender Auswahl. */
export type Action = "keine" | "ersetzen" | "davorEinfuegen";

/** Beobachtbarer Teil des Editorzustands; der Verlauf steckt opak in der Implementierung. */
export type EditorState = {
  readonly elements: Elements;
  readonly selection: string | undefined;
  readonly action: Action;
  readonly paletteTurn: Turn;
};

export type Command =
  | { readonly type: "choosePart"; readonly partId: string }
  | { readonly type: "appendCrossing" }
  | { readonly type: "togglePaletteTurn" }
  | { readonly type: "flipSelected" }
  | { readonly type: "deleteSelected" }
  | { readonly type: "new" }
  | { readonly type: "load"; readonly elements: Elements }
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "selectPrevious" }
  | { readonly type: "selectNext" }
  | { readonly type: "clearSelection" }
  | { readonly type: "setAction"; readonly action: Action }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export type PaletteKind = "platzierbar" | "ausgeblendet" | "masseFehlen";
export type PaletteEntry = {
  readonly partId: string;
  readonly name: string;
  readonly kind: PaletteKind;
};

export type StatusView =
  | { readonly kind: "leer" }
  | { readonly kind: "geschlossen" }
  | { readonly kind: "offen"; readonly gapText: string; readonly angleDeg: number }
  | { readonly kind: "fehlerhaft" };

export type ErrorEntry = {
  readonly numbers: ReadonlyArray<number>;
  readonly name: string;
  readonly text: string;
};

export type ConsumptionView =
  | {
      readonly ok: true;
      readonly entries: ReadonlyArray<{
        readonly partId: string;
        readonly name: string;
        readonly count: number;
      }>;
      readonly total: number;
    }
  | { readonly ok: false; readonly text: string };

/** Bildschirmkoordinaten in mm: x = x, y = −y. */
export type ScreenPoint = { readonly x: number; readonly y: number };

export type Centerline =
  | { readonly kind: "strecke"; readonly from: ScreenPoint; readonly to: ScreenPoint }
  | {
      readonly kind: "bogen";
      readonly from: ScreenPoint;
      readonly to: ScreenPoint;
      readonly center: ScreenPoint;
      readonly radius: number;
    };

export type ElementShape = {
  readonly id: string;
  readonly index: number;
  readonly centerline: Centerline;
  readonly band: { readonly left: Centerline; readonly right: Centerline };
  readonly ports?: { readonly left: ScreenPoint; readonly right: ScreenPoint };
};

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

export type ClockReading = {
  readonly utc: Date;
  readonly local: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
  };
};
export type Clock = () => ClockReading;

export type ImportErrorArt =
  | "keine JSON-Datei"
  | "keine Strecke dieses Planers oder andere Version"
  | "Strecke ungültig";

export type EditorMessage =
  | {
      readonly kind: "ladenFehlgeschlagen";
      readonly name: string;
      readonly reason: string;
      readonly text: string;
    }
  | {
      readonly kind: "arbeitsstandVerschoben";
      readonly backupKey: string;
      readonly reason: string;
      readonly text: string;
    }
  | { readonly kind: "arbeitsstandNichtVerschoben"; readonly reason: string; readonly text: string }
  | { readonly kind: "speicherFehler"; readonly reason: string; readonly text: string }
  | {
      readonly kind: "importFehlgeschlagen";
      readonly fileName: string;
      readonly art: ImportErrorArt;
      readonly reason: string;
      readonly text: string;
    };

export type SaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "nameLeer" | "existiert" | "speicherFehler" };

export type Session = {
  readonly state: EditorState;
  readonly name: string | undefined;
  readonly messages: ReadonlyArray<EditorMessage>;
  dispatch(command: Command): void;
  saveAs(name: string, options?: { readonly overwrite: boolean }): SaveResult;
  savedNames(): ReadonlyArray<string>;
  load(name: string): void;
  deleteSaved(name: string): void;
  defectBackups(): ReadonlyArray<string>;
  defectRawText(key: string): string | undefined;
  deleteDefect(key: string): void;
  exportFile(): { readonly fileName: string; readonly text: string };
  importFile(fileName: string, text: string): void;
};

// ---------------------------------------------------------------------------------------------
// M3a: Bestand, Set-Vorlagen, Modus, Einkaufsliste (Spec .specify/specs/m3a-bestand/spec.md).
// Spiegeln die Vertragstypen aus src/web/test-support/bestand-fixtures.ts; die Übereinstimmung
// prüft `tsc` über `src/web/editor/index.ts`.
// ---------------------------------------------------------------------------------------------

export type Certainty = "hoch" | "mittel" | "niedrig";

/**
 * Set-Vorlage, wie die Logik sie braucht. Strukturell weiter als der Schema-Typ (Inhalt als
 * gewöhnliche Liste), damit auch geprüfte Katalogdaten und Testvorlagen passen.
 */
export type SetTemplate = {
  readonly id: string;
  readonly name: string;
  readonly articleNumber: string;
  readonly source: string;
  readonly certainty: Certainty;
  readonly contents: ReadonlyArray<{ readonly part: string; readonly count: number }>;
};

/** Teil-ID → Anzahl; fehlend heißt 0. Nicht zählende Einträge (REQ-BEST-7) dürfen darin stehen. */
export type Inventory = Readonly<Record<string, number>>;

export type InventoryChange =
  | { readonly ok: true; readonly inventory: Inventory }
  | { readonly ok: false; readonly text: string };

export type Mode = "sandbox" | "bestand";

export type Rejection = {
  readonly partId: string | undefined;
  readonly name: string | undefined;
  readonly text: string;
};

export type ModeResult = {
  readonly state: EditorState;
  readonly rejection: Rejection | undefined;
};

export type StockPaletteEntry = {
  readonly partId: string;
  readonly name: string;
  readonly kind: PaletteKind;
  readonly stock: number | undefined;
  readonly rest: number | undefined;
  readonly locked: boolean;
};

export type SearchTerm =
  | { readonly kind: "artikelnummer"; readonly value: string; readonly text: string }
  | { readonly kind: "praegung"; readonly value: string; readonly text: string }
  | { readonly kind: "hinweis"; readonly text: string };

export type ShoppingRow = {
  readonly partId: string;
  readonly name: string;
  readonly needed: number;
  readonly have: number;
  readonly missing: number;
  readonly searchTerms: ReadonlyArray<SearchTerm>;
};

export type ShoppingList =
  | {
      readonly ok: true;
      readonly rows: ReadonlyArray<ShoppingRow>;
      readonly total: number;
      readonly text: "alles vorhanden" | undefined;
    }
  | { readonly ok: false; readonly text: string };

export type InventoryMessage =
  | { readonly kind: "bestandAbgewiesen"; readonly partId: string; readonly text: string }
  | {
      readonly kind: "bestandVerschoben";
      readonly backupKey: string;
      readonly reason: string;
      readonly text: string;
    }
  | { readonly kind: "bestandNichtVerschoben"; readonly reason: string; readonly text: string }
  | {
      readonly kind: "bestandIgnoriert";
      readonly partIds: ReadonlyArray<string>;
      readonly text: string;
    }
  | { readonly kind: "modusUngueltig"; readonly value: string; readonly text: string }
  | { readonly kind: "bestandAbgleichKaputt"; readonly reason: string; readonly text: string }
  | {
      readonly kind: "befehlAbgewiesen";
      readonly partId: string | undefined;
      readonly text: string;
    };

export type PlannerMessage = EditorMessage | InventoryMessage;

export type PlannerSession = Omit<Session, "messages"> & {
  readonly messages: ReadonlyArray<PlannerMessage>;
  readonly mode: Mode;
  readonly inventory: Inventory;
  setMode(mode: Mode): void;
  setCount(partId: string, input: string): void;
  increment(partId: string): void;
  decrement(partId: string): void;
  addSet(templateId: string, confirmed: boolean): void;
  clearInventory(confirmed: boolean): void;
  inventoryDefectBackups(): ReadonlyArray<string>;
  inventoryDefectRawText(key: string): string | undefined;
  deleteInventoryDefect(key: string): void;
  /** Änderung des Speichers von außen (anderes Tab; null = alles), REQ-BEST-10. */
  storageChanged(key: string | null): void;
};
