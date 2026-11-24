/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): gemeinsame Vertragstypen, Lader und Fixtures für die
 * Tests der Editor-Logik (`src/web/editor/**\/*.test.ts`). Kein Produktcode, keine Logik des
 * Editors: nur die von spec-to-tests gewählte Schnittstelle als Typen, Testdaten und eine
 * Speicher-Attrappe.
 *
 * Liegt bewusst außerhalb von `src/web/editor`, damit der Stryker-Ratchet über `src/web/editor`
 * (REQ-WARCH-4) diese Hilfsdatei nicht mutiert.
 *
 * ## Gewählte Schnittstelle (implement setzt genau diese Module und Exporte um)
 *
 * Alle Funktionen sind rein, außer der Sitzung (`createSession`), die einen eingereichten Speicher
 * und eine eingereichte Uhr benutzt. Der Katalog ist immer Argument (REQ-WARCH-3). Kern, Katalog
 * und Schema werden nur über ihre `index.ts` importiert (REQ-WARCH-2).
 *
 * - `src/web/editor/editor.ts` (EditorApi): Zustand, Befehle, Auswahl, Verlauf.
 *     initialState(): EditorState                       leere Folge, keine Auswahl, Aktion
 *                                                       "keine", Leistenrichtung "links"
 *     apply(catalog, state, command): EditorState       unveränderlich, liefert neuen Zustand
 *     canUndo(state), canRedo(state): boolean
 *     flipAvailable(catalog, state): boolean            REQ-EDIT-4
 *     crossingTarget(catalog, elements): string | undefined
 *                                                       Element-ID der Kreuzung, auf die
 *                                                       „Querung anhängen“ jetzt verweisen würde,
 *                                                       sonst undefined (REQ-EDIT-9)
 *   „Wirksam“ heißt: Die Elementfolge ist danach (inhaltlich) eine andere. Nur wirksame Befehle
 *   legen einen Verlaufseintrag an (REQ-EDIT-14/-15). Der Verlauf steckt opak im Zustand.
 * - `src/web/editor/status.ts` (StatusApi): Status, Lücke/Winkel, Fehlerliste, Verbrauch, Länge.
 * - `src/web/editor/drawing.ts` (DrawingApi): gezeichneter Abschnitt, Zeichengeometrie.
 * - `src/web/editor/session.ts` (SessionApi): Sitzung über Speicher und Uhr (Autosicherung,
 *   benannte Layouts, defekte Sicherungen, Export/Import). Eigenschaften `state`, `name`,
 *   `messages` geben jeweils den aktuellen Stand nach dem letzten Aufruf wieder (Getter).
 *
 * Ein Barrel `src/web/editor/index.ts` ist erlaubt, aber nicht nötig; Logik darin entginge dem
 * Stryker-Ratchet (die Konfiguration nimmt `index.ts` aus), also nur Re-Exporte.
 *
 * Die Module werden in den Tests dynamisch über einen Pfad in einer Variablen geladen. So
 * typchecken und laden die Testdateien, bevor es die Module gibt; die Typen unten sind die
 * Zusicherung an die Implementierung.
 */
import { ParseResult, Schema } from "effect";
import fc from "fast-check";
import { expect } from "vitest";
import { CATALOG } from "../../catalog/index.js";
import type {
  CatalogEntry,
  Coord,
  LayoutElement,
  Offset,
  Pose,
  Rational,
  Step,
  Turn,
} from "../../core/index.js";
import { LayoutSchema } from "../../schema/index.js";

export type { CatalogEntry, Coord, LayoutElement, Offset, Pose, Rational, Step, Turn };
export { CATALOG };

type Catalog = ReadonlyArray<CatalogEntry>;
type Elements = ReadonlyArray<LayoutElement>;

// ---------------------------------------------------------------------------------------------
// Vertragstypen: editor.ts
// ---------------------------------------------------------------------------------------------

/** Aktion bei bestehender Auswahl (Begriffe „Aktion“). */
export type Action = "keine" | "ersetzen" | "davorEinfuegen";

/** Beobachtbarer Teil des Editorzustands; der Verlauf ist opak. */
export type EditorState = {
  readonly elements: Elements;
  /** Element-ID des ausgewählten Elements oder undefined. */
  readonly selection: string | undefined;
  readonly action: Action;
  /** Leisten-Kurvenrichtung (REQ-EDIT-3). */
  readonly paletteTurn: Turn;
};

export type Command =
  /** Tipp auf ein Leistenteil: anhängen, ersetzen oder davor einfügen je nach Aktion. */
  | { readonly type: "choosePart"; readonly partId: string }
  | { readonly type: "appendCrossing" }
  | { readonly type: "togglePaletteTurn" }
  /** „Richtung umschalten“ für das ausgewählte Kurven-Element. */
  | { readonly type: "flipSelected" }
  | { readonly type: "deleteSelected" }
  | { readonly type: "new" }
  /** Ersetzt die Folge durch eine (bereits geprüfte) Elementfolge; hebt die Auswahl auf. */
  | { readonly type: "load"; readonly elements: Elements }
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "selectPrevious" }
  | { readonly type: "selectNext" }
  | { readonly type: "clearSelection" }
  | { readonly type: "setAction"; readonly action: Action }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export type EditorApi = {
  initialState(): EditorState;
  apply(catalog: Catalog, state: EditorState, command: Command): EditorState;
  canUndo(state: EditorState): boolean;
  canRedo(state: EditorState): boolean;
  flipAvailable(catalog: Catalog, state: EditorState): boolean;
  crossingTarget(catalog: Catalog, elements: Elements): string | undefined;
};

// ---------------------------------------------------------------------------------------------
// Vertragstypen: status.ts
// ---------------------------------------------------------------------------------------------

export type StatusView =
  | { readonly kind: "leer" }
  | { readonly kind: "geschlossen" }
  /** gapText z. B. "342 mm", "< 1 mm"; angleDeg = Kern-Winkel × 45 (positiv = nach links drehen). */
  | { readonly kind: "offen"; readonly gapText: string; readonly angleDeg: number }
  | { readonly kind: "fehlerhaft" };

/** Ein Eintrag der Fehlerliste (REQ-STAT-3); numbers = Nummern (Index + 1), aufsteigend. */
export type ErrorEntry = {
  readonly numbers: ReadonlyArray<number>;
  readonly name: string;
  readonly text: string;
};

export type ConsumptionView =
  | {
      readonly ok: true;
      /** Nur Einträge mit Anzahl ≥ 1, in Katalogreihenfolge. */
      readonly entries: ReadonlyArray<{
        readonly partId: string;
        readonly name: string;
        readonly count: number;
      }>;
      readonly total: number;
    }
  | { readonly ok: false; readonly text: string };

export type StatusApi = {
  statusOf(catalog: Catalog, elements: Elements): StatusView;
  /** Lücke als Text aus dem exakten Kern-Versatz (REQ-STAT-2). */
  formatGap(offset: Offset): string;
  errorEntries(catalog: Catalog, elements: Elements): ReadonlyArray<ErrorEntry>;
  consumptionView(catalog: Catalog, elements: Elements): ConsumptionView;
  /** Gesamtlänge in mm (Gleitkomma) oder undefined, wenn ein Element keine bekannte Länge hat. */
  totalLength(catalog: Catalog, elements: Elements): number | undefined;
  /** "1,76 m" bzw. "–" für undefined. */
  formatLength(mm: number | undefined): string;
};

// ---------------------------------------------------------------------------------------------
// Vertragstypen: drawing.ts
// ---------------------------------------------------------------------------------------------

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

/**
 * Zeichengeometrie eines gezeichneten Elements. band.left/band.right sind die beiden Ränder des
 * 114 mm breiten Bands, je 57 mm neben der Mittellinie, links/rechts in Fahrtrichtung (M1-Sinn:
 * links = gegen den Uhrzeigersinn); Strecke bleibt Strecke, Bogen bleibt Bogen um denselben
 * Mittelpunkt. ports nur bei Kreuzungen: ihre Queranschlüsse (links/rechts wie im Kern).
 * Eine Querung hat als Mittellinie die Strecke vom Ankunfts- zum gegenüberliegenden Anschluss.
 */
export type ElementShape = {
  readonly id: string;
  readonly index: number;
  readonly centerline: Centerline;
  readonly band: { readonly left: Centerline; readonly right: Centerline };
  readonly ports?: { readonly left: ScreenPoint; readonly right: ScreenPoint };
};

export type DrawnSection = {
  /** Erster Fehlerindex (0-basiert) oder undefined ohne Fehler. */
  readonly firstErrorIndex: number | undefined;
  /** Kern-Schritte (trace) des gezeichneten Abschnitts, ein Schritt je gezeichnetem Element. */
  readonly steps: ReadonlyArray<Step>;
  readonly drawnCount: number;
  readonly notDrawnCount: number;
};

export type DrawingApi = {
  drawnSection(catalog: Catalog, elements: Elements): DrawnSection;
  /** Je Element des gezeichneten Abschnitts eine Form, in Folgereihenfolge. */
  drawing(catalog: Catalog, elements: Elements): ReadonlyArray<ElementShape>;
  /** a + b·√2 → Zahl (mm). */
  coordToNumber(c: Coord): number;
};

// ---------------------------------------------------------------------------------------------
// Vertragstypen: session.ts
// ---------------------------------------------------------------------------------------------

/** Verhalten von Web Storage; im Browser `localStorage`, hier eine Attrappe. */
export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

export type ClockReading = {
  /** Zeitpunkt (für den Ausweichschlüssel, toISOString()). */
  readonly utc: Date;
  /** Lokale Bestandteile für den Dateinamen; month 1–12, hour 0–23. */
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

/** Meldungen bleiben in `session.messages` (angehängt), bis die UI sie schließt. */
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
  /** Zuletzt beim Speichern, Laden oder Import verwendeter Name (Namensvorschlag). */
  readonly name: string | undefined;
  readonly messages: ReadonlyArray<EditorMessage>;
  /** Befehl anwenden; nach jedem wirksamen Befehl Autosicherung unter WORKING_KEY. */
  dispatch(command: Command): void;
  saveAs(name: string, options?: { readonly overwrite: boolean }): SaveResult;
  savedNames(): ReadonlyArray<string>;
  load(name: string): void;
  deleteSaved(name: string): void;
  /** Schlüssel der defekten Sicherungen. */
  defectBackups(): ReadonlyArray<string>;
  defectRawText(key: string): string | undefined;
  deleteDefect(key: string): void;
  exportFile(): { readonly fileName: string; readonly text: string };
  importFile(fileName: string, text: string): void;
};

export type SessionApi = {
  /** Präfix je Anwendung; Ausweichschlüssel `${STORAGE_PREFIX}:defekt:<ISO-UTC>`. */
  readonly STORAGE_PREFIX: string;
  /** Fester Schlüssel des Arbeitsstands. */
  readonly WORKING_KEY: string;
  /** Speicherschlüssel eines benannten Layouts (Name nach Trimmen). */
  layoutKey(name: string): string;
  createSession(deps: {
    readonly catalog: Catalog;
    readonly storage: KeyValueStorage;
    readonly clock: Clock;
  }): Session;
};

// ---------------------------------------------------------------------------------------------
// Lader
// ---------------------------------------------------------------------------------------------

const EDITOR_MODULE = "../editor/editor.js";
const STATUS_MODULE = "../editor/status.js";
const DRAWING_MODULE = "../editor/drawing.js";
const SESSION_MODULE = "../editor/session.js";

export const MODULE_PATHS = [EDITOR_MODULE, STATUS_MODULE, DRAWING_MODULE, SESSION_MODULE];

export const loadEditor = async (): Promise<EditorApi> =>
  (await import(/* @vite-ignore */ EDITOR_MODULE)) as EditorApi;
export const loadStatus = async (): Promise<StatusApi> =>
  (await import(/* @vite-ignore */ STATUS_MODULE)) as StatusApi;
export const loadDrawing = async (): Promise<DrawingApi> =>
  (await import(/* @vite-ignore */ DRAWING_MODULE)) as DrawingApi;
export const loadSession = async (): Promise<SessionApi> =>
  (await import(/* @vite-ignore */ SESSION_MODULE)) as SessionApi;

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const ZERO: Coord = { a: { num: 0n, den: 1n }, b: { num: 0n, den: 1n } };
/** Startpose des Editors (0, 0, k = 0). */
export const ORIGIN: Pose = { x: ZERO, y: ZERO, dir: 0 };

const L: Turn = "links";
const R: Turn = "rechts";

/** Oval aus dem Bestand (REQ-CORE-13 (c)), alle Kurven links. */
export const OVAL: Elements = [
  { id: "o1", part: "kurve-1-90", turn: L },
  { id: "o2", part: "kurve-1-90", turn: L },
  { id: "o3", part: "gerade-342" },
  { id: "o4", part: "kurve-1-90", turn: L },
  { id: "o5", part: "kurve-1-90", turn: L },
  { id: "o6", part: "gerade-342" },
];

/** Acht aus der M1-Tabelle „Acht“ (REQ-CORE-30), IDs e1 … e10. */
export const ACHT: Elements = [
  { id: "e1", part: "kreuzung" },
  { id: "e2", part: "kurve-1-90", turn: R },
  { id: "e3", part: "kurve-1-90", turn: R },
  { id: "e4", part: "kurve-1-90", turn: R },
  { id: "e5", part: "gerade-114" },
  { id: "e6", crosses: "e1" },
  { id: "e7", part: "anschlussstueck" },
  { id: "e8", part: "kurve-1-90", turn: L },
  { id: "e9", part: "kurve-1-90", turn: L },
  { id: "e10", part: "kurve-1-90", turn: L },
];

/** Acht mit Gerade 171 statt Gerade 114 an Nr. 5 (REQ-CORE-31 (a)). */
export const ACHT_G171: Elements = ACHT.map((el) =>
  el.id === "e5" ? { id: "e5", part: "gerade-171" } : el,
);

/** Element ersetzen (Testdaten bauen). */
export const replaceAt = (elements: Elements, index: number, el: LayoutElement): Elements =>
  elements.map((e, i) => (i === index ? el : e));

export const isCurve = (catalog: Catalog, partId: string): boolean =>
  catalog.find((e) => e.id === partId)?.geometry.kind === "kurve";

export const isPlaceable = (catalog: Catalog, partId: string): boolean => {
  const kind = catalog.find((e) => e.id === partId)?.geometry.kind;
  return kind === "gerade" || kind === "kurve" || kind === "kreuzung";
};

export const PLACEABLE_IDS = CATALOG.filter((e) => isPlaceable(CATALOG, e.id)).map((e) => e.id);
export const UNPLACEABLE_IDS = CATALOG.filter((e) => !isPlaceable(CATALOG, e.id)).map((e) => e.id);
export const UNKNOWN_ID = "gibt-es-nicht";

/** Zustand mit geladener Folge (ein Verlaufseintrag „laden“). */
export const loaded = (api: EditorApi, elements: Elements, catalog: Catalog = CATALOG) =>
  api.apply(catalog, api.initialState(), { type: "load", elements });

/** Mehrere Befehle nacheinander anwenden. */
export const run = (
  api: EditorApi,
  state: EditorState,
  commands: ReadonlyArray<Command>,
  catalog: Catalog = CATALOG,
): EditorState => commands.reduce((s, c) => api.apply(catalog, s, c), state);

/** Alle Stände, die vom Zustand aus über Rückgängig und Wiederholen erreichbar sind. */
export const historyStates = (api: EditorApi, state: EditorState): ReadonlyArray<Elements> => {
  const out: Elements[] = [state.elements];
  let back = state;
  while (api.canUndo(back)) {
    back = api.apply(CATALOG, back, { type: "undo" });
    out.push(back.elements);
  }
  let forward = state;
  while (api.canRedo(forward)) {
    forward = api.apply(CATALOG, forward, { type: "redo" });
    out.push(forward.elements);
  }
  return out;
};

/** Inhaltlicher Schlüssel eines Elements (für Vergleiche „wirksam“). */
export const elementKey = (el: LayoutElement): string =>
  "crosses" in el ? `${el.id}|>${el.crosses}` : `${el.id}|${el.part}|${el.turn ?? ""}`;
export const sameElements = (a: Elements, b: Elements): boolean =>
  a.length === b.length && a.every((el, i) => elementKey(el) === elementKey(b[i] as LayoutElement));

/** Layout-Dekodierung mit dem M1-Schema (wirft nicht). */
export const decodeLayout = Schema.decodeUnknownEither(LayoutSchema);

/** Text der Schema-Prüfung für einen JSON-Text, der parst, aber das Schema verletzt. */
export const schemaReason = (raw: string): string => {
  const r = decodeLayout(JSON.parse(raw));
  if (r._tag === "Right") throw new Error("Testdaten-Fehler: Layout ist schema-gültig");
  return ParseResult.TreeFormatter.formatErrorSync(r.left);
};

/** Kodiertes Layout als JSON-Objekt (Erwartung an gespeicherte/exportierte Werte). */
export const layoutJson = (elements: Elements): unknown => ({ schemaVersion: 1, elements });

// ---------------------------------------------------------------------------------------------
// Exakte Zahlen
// ---------------------------------------------------------------------------------------------

export const rat = (num: bigint, den: bigint = 1n): Rational => ({ num, den });
export const coord = (a: Rational, b: Rational = rat(0n)): Coord => ({ a, b });

/** Exakter Wert von a + b·√2, als Gleitkomma über bigint mit 40 Nachkommastellen (Orakel). */
export const coordExact = (c: Coord): number => {
  const S = 10n ** 40n;
  const sqrt2S = isqrt(2n * S * S);
  // a = an/ad, b = bn/bd; Wert·S = (an·S·bd + bn·sqrt2S·ad)/(ad·bd)
  const num = c.a.num * S * c.b.den + c.b.num * sqrt2S * c.a.den;
  const den = c.a.den * c.b.den;
  const scaled = (num * 10n ** 6n) / (den * S); // Mikrometer, abgeschnitten
  return Number(scaled) / 1e6;
};

const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};

export const expectNear = (actual: number, expected: number, tol = 0.01): void => {
  expect(
    Math.abs(actual - expected),
    `erwartet ${expected}, erhalten ${actual}`,
  ).toBeLessThanOrEqual(tol);
};

export const expectPointNear = (actual: ScreenPoint, expected: ScreenPoint, tol = 0.01): void => {
  expectNear(actual.x, expected.x, tol);
  expectNear(actual.y, expected.y, tol);
};

// ---------------------------------------------------------------------------------------------
// Speicher-Attrappe und Uhr
// ---------------------------------------------------------------------------------------------

export type StorageOp = {
  readonly op: "get" | "set" | "remove" | "key" | "length";
  readonly key: string;
};

/**
 * Web-Storage-Attrappe auf einer Map. `fail(op, key)` entscheidet, ob ein Zugriff wirft
 * (nicht verfügbar, voll, gesperrt). Jeder Zugriff wird in `log` protokolliert.
 */
export class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  readonly log: StorageOp[] = [];
  fail: (op: StorageOp["op"], key: string) => boolean = () => false;

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, v);
  }

  private check(op: StorageOp["op"], key: string): void {
    this.log.push({ op, key });
    if (this.fail(op, key)) throw new Error(`Speicher gesperrt (${op} ${key})`);
  }

  getItem(key: string): string | null {
    this.check("get", key);
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.check("set", key);
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.check("remove", key);
    this.data.delete(key);
  }
  key(index: number): string | null {
    this.check("key", String(index));
    return [...this.data.keys()][index] ?? null;
  }
  get length(): number {
    this.check("length", "");
    return this.data.size;
  }

  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.data);
  }
}

export const fixedClock =
  (
    iso: string,
    local: ClockReading["local"] = { year: 2026, month: 11, day: 24, hour: 8, minute: 15 },
  ): Clock =>
  () => ({ utc: new Date(iso), local });

// ---------------------------------------------------------------------------------------------
// Erzeuger (fast-check)
// ---------------------------------------------------------------------------------------------

export const ALL_PART_IDS = [...CATALOG.map((e) => e.id), UNKNOWN_ID];

/**
 * Layouts mit fremd gewählten Element-IDs (für „Laden“): IDs, die eine Implementierung
 * plausibel selbst vergeben könnte, damit Kollisionen auffallen (REQ-EDIT-17).
 */
const FOREIGN_IDS = [
  "1",
  "2",
  "3",
  "e1",
  "e2",
  "e3",
  "e11",
  "el-1",
  "el-2",
  "id-1",
  "id-2",
  "n1",
  "x1",
  "a",
  "b",
  "0",
  "el1",
  "elem-1",
  "element-1",
  "e-1",
];
export const LOADABLE: ReadonlyArray<Elements> = [
  ACHT,
  OVAL.map((el, i) => ({ ...el, id: String(i + 1) })),
  FOREIGN_IDS.map((id) => ({ id, part: "gerade-114" })),
  [
    { id: "e1", part: "looping" },
    { id: "e2", part: "kurve-1-90" },
    { id: "1", crosses: "e9" },
  ],
  [],
];

/** Befehl, wie ihn der Erzeuger liefert; `selectIndex` wird zur Laufzeit in eine ID übersetzt. */
export type GenCommand = Command | { readonly type: "selectIndex"; readonly n: number };

/** Alle Befehle außer Rückgängig/Wiederholen. */
export const editCommandArb: fc.Arbitrary<GenCommand> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .constantFrom(...ALL_PART_IDS)
      .map((partId): GenCommand => ({ type: "choosePart", partId })),
  },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "appendCrossing" }) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "togglePaletteTurn" }) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "flipSelected" }) },
  { weight: 2, arbitrary: fc.constant<GenCommand>({ type: "deleteSelected" }) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "new" }) },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(...LOADABLE)
      .map((elements): GenCommand => ({ type: "load", elements })),
  },
  { weight: 3, arbitrary: fc.nat().map((n): GenCommand => ({ type: "selectIndex", n })) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "selectPrevious" }) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "selectNext" }) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "clearSelection" }) },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom<Action>("keine", "ersetzen", "davorEinfuegen")
      .map((action): GenCommand => ({ type: "setAction", action })),
  },
);

export const anyCommandArb: fc.Arbitrary<GenCommand> = fc.oneof(
  { weight: 8, arbitrary: editCommandArb },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "undo" }) },
  { weight: 1, arbitrary: fc.constant<GenCommand>({ type: "redo" }) },
);

export const resolve = (state: EditorState, g: GenCommand): Command => {
  if (g.type !== "selectIndex") return g;
  const el = state.elements[g.n % Math.max(1, state.elements.length)];
  return el === undefined ? { type: "clearSelection" } : { type: "select", id: el.id };
};

/**
 * Beliebige Elementfolgen mit eindeutigen IDs u0, u1, …, auch fehlerhafte: unbekannte und nicht
 * platzierbare Teile, fehlende/überzählige Richtungen, Querungen auf beliebige frühere Elemente.
 */
export const elementsArb: fc.Arbitrary<Elements> = fc
  .array(
    fc.record({
      cross: fc.boolean().chain((b) => (b ? fc.boolean() : fc.constant(false))),
      part: fc.constantFrom(...ALL_PART_IDS),
      turn: fc.constantFrom<Turn | undefined>(undefined, "links", "rechts"),
      ref: fc.nat(),
    }),
    { maxLength: 25 },
  )
  .map((raw) =>
    raw.map((r, i): LayoutElement => {
      const id = `u${i}`;
      if (r.cross && i > 0) return { id, crosses: `u${r.ref % i}` };
      return r.turn === undefined ? { id, part: r.part } : { id, part: r.part, turn: r.turn };
    }),
  );

/** Fehlerfreie Folgen ohne Querung: platzierbare Teile, Kurven mit, andere ohne Richtung. */
export const validElementsArb: fc.Arbitrary<Elements> = fc
  .array(
    fc.record({
      part: fc.constantFrom(...PLACEABLE_IDS),
      turn: fc.constantFrom<Turn>("links", "rechts"),
    }),
    { maxLength: 25 },
  )
  .map((raw) =>
    raw.map(
      (r, i): LayoutElement =>
        isCurve(CATALOG, r.part)
          ? { id: `v${i}`, part: r.part, turn: r.turn }
          : { id: `v${i}`, part: r.part },
    ),
  );
