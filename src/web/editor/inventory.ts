/**
 * Bestand, Set-Vorlagen, Bestandsmodus und Einkaufsliste als reine Funktionen über Katalog,
 * Bestand und Elementfolge (Spec M3a, REQ-BEST-2/-7, REQ-SET-4/-5, REQ-MODUS-2 bis -6,
 * REQ-EINK-1 bis -5). Der Katalog ist immer Argument; der Verbrauch kommt ausschließlich aus
 * `consumption` des Kerns (REQ-BARCH-2). Kein Argument wird verändert. Zur Form siehe parts.ts.
 */
import { SET_TEMPLATES } from "../../catalog/index.js";
import { type CatalogEntry, consumption } from "../../core/index.js";
import { apply, paletteEntries } from "./editor.js";
import { geometryOf } from "./parts.js";
import type {
  Catalog,
  Command,
  EditorState,
  Elements,
  Inventory,
  InventoryChange,
  Mode,
  ModeResult,
  Rejection,
  SearchTerm,
  SetTemplate,
  ShoppingList,
  ShoppingRow,
  StockPaletteEntry,
} from "./types.js";

/** Anzahl eines Teils im Bestand; eine fehlende Teil-ID heißt 0. */
function countOf(inventory: Inventory, partId: string): number {
  return inventory[partId] ?? 0;
}

function entryOf(catalog: Catalog, partId: string): CatalogEntry {
  return catalog.find((entry) => entry.id === partId) as CatalogEntry;
}

/** Bestandsfähig: Katalogeintrag bekannt und keine Baugruppe (Spec M3a, „Begriffe“). */
export function isStockable(catalog: Catalog, partId: string): boolean {
  const g = geometryOf(catalog, partId);
  return g !== undefined && g.kind !== "baugruppe";
}

function rejected(text: string): InventoryChange {
  return { ok: false, text };
}

/** Prüft die Teil-ID und wendet die Änderung an; unbekannt oder Baugruppe wird abgewiesen. */
function changeCount(
  catalog: Catalog,
  inventory: Inventory,
  partId: string,
  next: (count: number) => InventoryChange,
): InventoryChange {
  return isStockable(catalog, partId)
    ? next(countOf(inventory, partId))
    : rejected(`„${partId}“ ist kein Teil, dessen Anzahl der Bestand führt.`);
}

function withCount(inventory: Inventory, partId: string, count: number): InventoryChange {
  return { ok: true, inventory: { ...inventory, [partId]: count } };
}

/** Anzahl auf den eingegebenen Text setzen; nur eine ganze Zahl ≥ 0 in Ziffern (REQ-BEST-2). */
export function setCount(
  catalog: Catalog,
  inventory: Inventory,
  partId: string,
  input: string,
): InventoryChange {
  return changeCount(catalog, inventory, partId, () => {
    const n = Number(input);
    return Number.isSafeInteger(n) && n >= 0 && String(n) === input
      ? withCount(inventory, partId, n)
      : rejected(`„${input}“ ist keine ganze Zahl ab 0.`);
  });
}

export function increment(catalog: Catalog, inventory: Inventory, partId: string): InventoryChange {
  return changeCount(catalog, inventory, partId, (n) => withCount(inventory, partId, n + 1));
}

/** Bei Anzahl 0 unverändert derselbe Bestand, ohne Meldung (REQ-BEST-2). */
export function decrement(catalog: Catalog, inventory: Inventory, partId: string): InventoryChange {
  return changeCount(catalog, inventory, partId, (n) =>
    n === 0 ? { ok: true, inventory } : withCount(inventory, partId, n - 1),
  );
}

export function decrementAvailable(
  catalog: Catalog,
  inventory: Inventory,
  partId: string,
): boolean {
  return isStockable(catalog, partId) && countOf(inventory, partId) >= 1;
}

/** Inhalt einer Set-Vorlage addieren; alle anderen Einträge bleiben (REQ-SET-4). */
export function addSet(inventory: Inventory, template: SetTemplate): Inventory {
  const out: Record<string, number> = { ...inventory };
  for (const { part, count } of template.contents) out[part] = countOf(out, part) + count;
  return out;
}

/** Nicht zählende Teil-IDs (unbekannt oder Baugruppe) mit Anzahl ≥ 1, sortiert (REQ-BEST-7). */
export function ignoredPartIds(catalog: Catalog, inventory: Inventory): ReadonlyArray<string> {
  return Object.keys(inventory)
    .filter((id) => !isStockable(catalog, id) && countOf(inventory, id) >= 1)
    .sort();
}

/**
 * Bestandsprüfung eines Teil-Befehls (REQ-MODUS-3): abgewiesen, wenn der Verbrauch danach nicht
 * bestimmbar ist, oder für das erste Teil, dessen Verbrauch gestiegen ist und den Bestand
 * übersteigt. Ein vorher nicht bestimmbarer Verbrauch zählt je Teil als 0.
 */
function shortage(
  catalog: Catalog,
  inventory: Inventory,
  before: Elements,
  after: Elements,
): Rejection | undefined {
  const used = consumption(catalog, after);
  if (!used.ok) {
    return {
      partId: undefined,
      name: undefined,
      text: "Der Verbrauch der Strecke ist nicht bestimmbar (Teil unbekannt); im Bestandsmodus lassen sich keine Teile hinzufügen.",
    };
  }
  const prior = consumption(catalog, before);
  const was: Readonly<Record<string, number>> = prior.ok ? prior.counts : {};
  const partId = Object.keys(used.counts).find((p) => {
    const n = used.counts[p] as number;
    return n > (was[p] ?? 0) && n > countOf(inventory, p);
  });
  if (partId === undefined) return undefined;
  const name = entryOf(catalog, partId).name;
  return {
    partId,
    name,
    text: `„${name}“: nicht genug im Bestand (vorhanden ${countOf(inventory, partId)}, benötigt ${used.counts[partId]}).`,
  };
}

/**
 * Befehl im Modus anwenden (REQ-MODUS-2 bis -4). In der Sandbox genau M2 `apply`. Im Modus
 * „Bestand“ wird nur „Teil wählen“ (Anhängen, Davor einfügen, Ersetzen) geprüft; alle anderen
 * Befehle, auch Laden, Neu, Rückgängig und Wiederholen, wirken wie in der Sandbox.
 */
export function applyInMode(
  catalog: Catalog,
  inventory: Inventory,
  mode: Mode,
  state: EditorState,
  command: Command,
): ModeResult {
  const next = apply(catalog, state, command);
  const rejection =
    mode === "bestand" && command.type === "choosePart"
      ? shortage(catalog, inventory, state.elements, next.elements)
      : undefined;
  return rejection === undefined ? { state: next, rejection } : { state, rejection };
}

/**
 * Leisten-Einteilung im Modus „Bestand“ (REQ-MODUS-5): die M2-Einteilung ohne bestandsfähige
 * Einträge mit Bestand 0 und ohne nicht gedeckte Baugruppen; je bestandsfähigem Eintrag Bestand
 * und Rest. Platzierbare Einträge mit Rest ≤ 0 oder unbestimmtem Rest sind gesperrt.
 */
export function stockPalette(
  catalog: Catalog,
  inventory: Inventory,
  elements: Elements,
): ReadonlyArray<StockPaletteEntry> {
  const used = consumption(catalog, elements);
  return paletteEntries(catalog).flatMap((p, i): StockPaletteEntry[] => {
    const g = (catalog[i] as CatalogEntry).geometry;
    // Baugruppe nur, wenn jeder Bestandteil mindestens so oft im Bestand ist, wie sie braucht.
    if (g.kind === "baugruppe") {
      return g.parts.every((part) => countOf(inventory, part.part) >= part.count)
        ? [{ ...p, stock: undefined, rest: undefined, locked: false }]
        : [];
    }
    const stock = countOf(inventory, p.partId);
    if (stock === 0) return [];
    const rest = used.ok ? stock - (used.counts[p.partId] ?? 0) : undefined;
    return [{ ...p, stock, rest, locked: p.kind === "platzierbar" && (rest ?? 0) <= 0 }];
  });
}

function hint(text: string): SearchTerm {
  return { kind: "hinweis", text };
}

/**
 * Suchbegriffe einer Zeile (REQ-EINK-3): Artikelnummern und Prägungen; ohne beides ein Hinweis,
 * die Baugruppen mit Artikelnummer, die das Teil enthalten, und danach die Set-Vorlagen, die das
 * Teil enthalten, in Vorlagenreihenfolge (Spec gerade-100).
 */
function searchTerms(
  catalog: Catalog,
  templates: ReadonlyArray<SetTemplate>,
  entry: CatalogEntry,
): ReadonlyArray<SearchTerm> {
  const numbers = entry.articleNumbers === "keineEigene" ? [] : entry.articleNumbers;
  const terms: SearchTerm[] = [
    ...numbers.map((value): SearchTerm => ({ kind: "artikelnummer", value, text: value })),
    ...(entry.praegung ?? []).map(
      ({ value }): SearchTerm => ({ kind: "praegung", value, text: `Prägung ${value}` }),
    ),
  ];
  if (terms.length > 0) return terms;
  const containers = catalog.flatMap((e) =>
    e.articleNumbers !== "keineEigene" &&
    e.geometry.kind === "baugruppe" &&
    e.geometry.parts.some((p) => p.part === entry.id)
      ? [hint(`enthalten in ${e.name}, Art.-Nr. ${e.articleNumbers.join(", ")}`)]
      : [],
  );
  const packs = templates.flatMap((t) =>
    t.contents.some((c) => c.part === entry.id)
      ? [hint(`enthalten in ${t.name}, Art.-Nr. ${t.articleNumber}`)]
      : [],
  );
  return [hint("keine Artikelnummer, keine Prägung bekannt"), ...containers, ...packs];
}

/**
 * Einkaufsliste (REQ-EINK-1/-2): je Teil mit Verbrauch über dem Bestand eine Zeile, in
 * Katalogreihenfolge. Baugruppen kommen im Verbrauch des Kerns nicht vor, nur ihre Bestandteile.
 * `templates` (Vorgabe `SET_TEMPLATES`) liefert die Vorlagen-Hinweise der Suchbegriffe.
 */
export function shoppingList(
  catalog: Catalog,
  inventory: Inventory,
  elements: Elements,
  templates: ReadonlyArray<SetTemplate> = SET_TEMPLATES,
): ShoppingList {
  const used = consumption(catalog, elements);
  if (!used.ok) return { ok: false, text: "Einkaufsliste nicht bestimmbar" };
  const order = (partId: string): number => catalog.findIndex((e) => e.id === partId);
  const rows = Object.entries(used.counts)
    .filter(([partId, needed]) => needed > countOf(inventory, partId))
    .sort(([a], [b]) => order(a) - order(b))
    .map(([partId, needed]): ShoppingRow => {
      const entry = entryOf(catalog, partId);
      const have = countOf(inventory, partId);
      return {
        partId,
        name: entry.name,
        needed,
        have,
        missing: needed - have,
        searchTerms: searchTerms(catalog, templates, entry),
      };
    });
  const total = rows.reduce((sum, r) => sum + r.missing, 0);
  return { ok: true, rows, total, text: rows.length === 0 ? "alles vorhanden" : undefined };
}

/** Kurzform für die Statusleiste (REQ-EINK-5). */
export function shoppingShort(list: ShoppingList): string {
  if (!list.ok) return list.text;
  return list.total === 0
    ? "Bestand reicht"
    : list.total === 1
      ? "fehlt 1 Teil"
      : `fehlen ${list.total} Teile`;
}
