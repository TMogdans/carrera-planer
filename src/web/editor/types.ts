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
