/**
 * Editor-Logik: Zustand, Befehle, Auswahl, Verlauf, Element-IDs, Leisten-Einteilung
 * (Spec M2, REQ-EDIT-1 bis -17 und -21). Rein und unveränderlich: `apply` liefert einen neuen
 * Zustand. Lage, Fehler und Queranschlüsse kommen ausschließlich vom Kern (REQ-WARCH-3).
 * Zur Form (Funktionsdeklarationen) siehe parts.ts.
 */
import { type LayoutElement, type Turn, trace } from "../../core/index.js";
import { geometryOf, isPlaceable, origin, partOf } from "./parts.js";
import type { Action, Catalog, Command, EditorState, Elements, PaletteEntry } from "./types.js";

/**
 * Vollständiger Zustand. `past`/`future` sind Stapel ganzer Elementfolgen (oberstes Element am
 * Ende). `counter` zählt vergebene IDs monoton hoch und wird von Rückgängig nicht zurückgesetzt;
 * `taken` sammelt alle je geladenen fremden IDs. So kommt eine neue ID in keinem Stand des
 * Verlaufs vor (REQ-EDIT-17).
 */
type Internal = EditorState & {
  readonly past: ReadonlyArray<Elements>;
  readonly future: ReadonlyArray<Elements>;
  readonly counter: number;
  readonly taken: ReadonlySet<string>;
};

type Stack = "past" | "future";

function noAction(): Action {
  return "keine";
}

function other(turn: Turn | undefined): Turn {
  return turn === "links" ? "rechts" : "links";
}

export function initialState(): EditorState {
  const s: Internal = {
    elements: [],
    selection: undefined,
    action: noAction(),
    paletteTurn: "links",
    past: [],
    future: [],
    counter: 1,
    taken: new Set<string>(),
  };
  return s;
}

/** Auswahl nur auf ein vorhandenes Element; ohne Auswahl keine Aktion (REQ-EDIT-13/-14). */
function settle(s: Internal): Internal {
  const selection = s.elements.some((el) => el.id === s.selection) ? s.selection : undefined;
  return { ...s, selection, action: selection === undefined ? noAction() : s.action };
}

/** Wirksam heißt: Die Folge ist danach inhaltlich eine andere (REQ-EDIT-14/-15). */
function commit(s: Internal, elements: Elements, patch: Partial<Internal> = {}): Internal {
  return settle(
    JSON.stringify(elements) === JSON.stringify(s.elements)
      ? { ...s, ...patch }
      : { ...s, ...patch, elements, past: [...s.past, s.elements], future: [] },
  );
}

function selectedIndex(s: Internal): number {
  return s.elements.findIndex((el) => el.id === s.selection);
}

/** Fügt ein Element mit neuer ID ein, die weder vergeben noch je geladen wurde (REQ-EDIT-17). */
function insertFresh(
  s: Internal,
  build: (id: string) => Elements,
  patch: Partial<Internal> = {},
): Internal {
  let n = s.counter;
  while (s.taken.has(`e${n}`)) n++;
  return commit(s, build(`e${n}`), { ...patch, counter: n + 1 });
}

function partElement(id: string, part: string, turn: Turn | undefined): LayoutElement {
  return turn === undefined ? { id, part } : { id, part, turn };
}

function choosePart(catalog: Catalog, s: Internal, partId: string): Internal {
  const g = geometryOf(catalog, partId);
  if (!isPlaceable(g)) return s;
  const curve = g.kind === "kurve";
  const i = selectedIndex(s);
  if (s.action === "ersetzen") {
    const old = s.elements[i] as LayoutElement & { readonly turn?: Turn };
    const oldCurve = geometryOf(catalog, partOf(old))?.kind === "kurve";
    const turn = curve ? (oldCurve ? old.turn : s.paletteTurn) : undefined;
    return commit(s, s.elements.toSpliced(i, 1, partElement(old.id, partId, turn)), {
      action: noAction(),
    });
  }
  const turn = curve ? s.paletteTurn : undefined;
  return s.action === "davorEinfuegen"
    ? insertFresh(s, (id) => s.elements.toSpliced(i, 0, partElement(id, partId, turn)))
    : insertFresh(s, (id) => [...s.elements, partElement(id, partId, turn)]);
}

function appendCrossing(catalog: Catalog, s: Internal): Internal {
  const target = crossingTarget(catalog, s.elements);
  if (target === undefined) return s;
  return insertFresh(s, (id) => [...s.elements, { id, crosses: target }]);
}

function flipSelected(catalog: Catalog, s: Internal): Internal {
  if (!flipAvailable(catalog, s)) return s;
  const i = selectedIndex(s);
  const el = s.elements[i] as { readonly id: string; readonly part: string; readonly turn?: Turn };
  return commit(s, s.elements.toSpliced(i, 1, { ...el, turn: other(el.turn) }));
}

function deleteSelected(s: Internal): Internal {
  if (s.selection === undefined) return s;
  const i = selectedIndex(s);
  const elements = s.elements.toSpliced(i, 1);
  // Danach ist das Element an derselben Stelle ausgewählt, sonst das neue letzte (REQ-EDIT-5).
  return commit(s, elements, { selection: elements[Math.min(i, elements.length - 1)]?.id });
}

/** Voriges/nächstes Element; die Folge gilt dabei als Ring (eine Strecke ist ein Rundkurs). */
function step(s: Internal, delta: number): Internal {
  const n = s.elements.length;
  return settle({ ...s, selection: s.elements[(selectedIndex(s) + delta + n) % n]?.id });
}

/** Rückgängig (`past` → `future`) und Wiederholen (`future` → `past`) in einem (REQ-EDIT-14). */
function travel(s: Internal, from: Stack, to: Stack): Internal {
  const target = s[from].at(-1);
  if (target === undefined) return s;
  const moved = { [from]: s[from].slice(0, -1), [to]: [...s[to], s.elements] };
  return settle({ ...s, ...moved, elements: target });
}

function load(s: Internal, elements: Elements): Internal {
  return commit(s, elements, {
    selection: undefined,
    taken: new Set([...s.taken, ...elements.map((el) => el.id)]),
  });
}

export function apply(catalog: Catalog, state: EditorState, command: Command): EditorState {
  const s = state as Internal;
  switch (command.type) {
    case "choosePart":
      return choosePart(catalog, s, command.partId);
    case "appendCrossing":
      return appendCrossing(catalog, s);
    case "togglePaletteTurn":
      return { ...s, paletteTurn: other(s.paletteTurn) };
    case "flipSelected":
      return flipSelected(catalog, s);
    case "deleteSelected":
      return deleteSelected(s);
    case "new":
      return commit(s, []);
    case "load":
      return load(s, command.elements);
    case "select":
      return settle({ ...s, selection: command.id });
    case "selectPrevious":
      return step(s, -1);
    case "selectNext":
      return step(s, 1);
    case "clearSelection":
      return settle({ ...s, selection: undefined });
    case "setAction":
      return settle({ ...s, action: command.action });
    case "undo":
      return travel(s, "past", "future");
    case "redo":
      return travel(s, "future", "past");
  }
}

/**
 * Derselbe Zustand ohne Verlauf. Für die Wiederherstellung des gesicherten Arbeitsstands beim
 * Start: Der Verlauf wird nicht gespeichert (REQ-EDIT-16), die geladenen IDs bleiben vergeben.
 */
export function forgetHistory(state: EditorState): EditorState {
  const s: Internal = { ...(state as Internal), past: [], future: [] };
  return s;
}

export function canUndo(state: EditorState): boolean {
  return (state as Internal).past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return (state as Internal).future.length > 0;
}

/** „Richtung umschalten“ nur für ein ausgewähltes Kurven-Element (REQ-EDIT-4). */
export function flipAvailable(catalog: Catalog, state: EditorState): boolean {
  const s = state as Internal;
  return geometryOf(catalog, partOf(s.elements[selectedIndex(s)]))?.kind === "kurve";
}

/**
 * Ziel von „Querung anhängen“ (REQ-EDIT-9): die früheste Kreuzung, für die der Kern eine probehalber
 * angehängte Querung fehlerfrei verfolgt. Damit entscheidet der Kern über exakte Ankunft,
 * „bereits gequert“ und Fehler davor. Nur Kreuzungen werden probiert (sonst 1000 Proben bei 1000
 * Elementen, REQ-EDIT-20). Die Probe-ID ist die ID der Kreuzung mit angehängtem NUL-Zeichen und
 * kollidiert nur mit absichtlich so gewählten fremden IDs (bekannte Grenze: dann gilt die Querung
 * als nicht verfügbar).
 */
export function crossingTarget(catalog: Catalog, elements: Elements): string | undefined {
  for (const el of elements) {
    if (
      geometryOf(catalog, partOf(el))?.kind === "kreuzung" &&
      // biome-ignore lint/style/useTemplate: Verkettung mit Literal hat genau einen Mutanten (NUL weg → Kollision → rot); ein Template würde zu "" mutiert und bliebe unbemerkt.
      trace(catalog, [...elements, { id: el.id + "\u0000", crosses: el.id }], origin()).ok
    ) {
      return el.id;
    }
  }
  return undefined;
}

/** Leisten-Einteilung aus dem übergebenen Katalog (REQ-EDIT-21). */
export function paletteEntries(catalog: Catalog): ReadonlyArray<PaletteEntry> {
  const isComponent = (id: string): boolean =>
    catalog.some(
      (entry) =>
        entry.geometry.kind === "baugruppe" && entry.geometry.parts.some((p) => p.part === id),
    );
  return catalog.map((entry) => ({
    partId: entry.id,
    name: entry.name,
    kind:
      entry.geometry.kind === "masseFehlen"
        ? isComponent(entry.id)
          ? "ausgeblendet"
          : "masseFehlen"
        : isPlaceable(entry.geometry)
          ? "platzierbar"
          : "masseFehlen",
  }));
}
