/**
 * Teilenamen und Symbole im Plan (Spec plan-beschriftung-symbole, REQ-LBL-1 bis -4, REQ-SYM-1):
 * Beschriftungstext, Breitenschätzung, Platzregel, Ort und Symbolzuordnung. Rein: kein Preact,
 * kein DOM; der Katalog ist immer Argument (REQ-PARCH-1).
 *
 * Die Zeichengeometrie (`drawing`) wird nicht neu gerechnet; `labelPlan` bekommt sie und
 * bestimmt je Ansicht (Maßstab) Variante und Ort (REQ-PARCH-3). Für Katalog-IDs, die der
 * übergebene Katalog nicht kennt, sind `labelVariant` und `labelPlan` nicht definiert: gezeichnete
 * Elemente haben immer einen Katalogeintrag (M2: nur verfolgbare Elemente werden gezeichnet).
 */
import type {
  Catalog,
  ElementShape,
  Elements,
  LabelEntry,
  LabelTexts,
  LabelVariant,
  ScreenPoint,
  SymbolKind,
} from "./types.js";

/** Breitenschätzung je Zeichen in Bildschirm-Pixeln („Begriffe“). */
const CHAR_PX = 7.5;
/** Plakette des Symbols in Bildschirm-Pixeln (REQ-SYM-2). */
export const SYMBOL_PX = 16;
/** Plakette plus Abstand vor dem Namen (REQ-SYM-2). */
export const SYMBOL_ROW_PX = 20;

export function labelTexts(catalog: Catalog, partId: string): LabelTexts | undefined {
  const entry = catalog.find((e) => e.id === partId);
  if (entry === undefined) return undefined;
  // Erstes Wort, das für die Kurzform wegfällt (REQ-LBL-1).
  const prefix = ["Gerade ", "Kurve "].find((p) => entry.name.startsWith(p));
  return {
    full: entry.name,
    short: prefix === undefined ? undefined : entry.name.slice(prefix.length),
  };
}

/**
 * Symbolzuordnung allein an der Katalog-ID (REQ-SYM-1). Bewusst im Funktionsrumpf statt als
 * Tabelle auf Modulebene: Mutanten in Modulkonstanten sieht Stryker nur mit den Tests, die das
 * Modul zuerst geladen haben.
 */
export function symbolOf(partId: string): SymbolKind | undefined {
  switch (partId) {
    case "rundenzaehler":
      return "zielflagge";
    case "anschlussstueck":
    case "wireless-anschluss":
      return "stecker";
    case "spurwechsel-gerade":
    case "spurwechselkurve":
      return "spurwechsel";
    case "engstelle":
      return "engstelle";
  }
  return undefined;
}

/** Breite in Bildschirm-Pixeln: 7,5 je Unicode-Codepoint. */
export function textWidth(text: string): number {
  return [...text].length * CHAR_PX;
}

/** Platzregel (REQ-LBL-2) für den Platz `room` in Bildschirm-Pixeln. */
export function labelVariant(
  catalog: Catalog,
  partId: string,
  room: number,
  on: boolean,
): LabelVariant {
  const texts = labelTexts(catalog, partId) as LabelTexts;
  if (symbolOf(partId) !== undefined) {
    if (on && SYMBOL_ROW_PX + textWidth(texts.full) <= room) return "symbolUndName";
    return SYMBOL_PX <= room ? "nurSymbol" : "keine";
  }
  if (!on) return "keine";
  if (textWidth(texts.full) <= room) return "voll";
  if (texts.short !== undefined && textWidth(texts.short) <= room) return "kurz";
  return "keine";
}

/** Mitte der Mittellinie (REQ-LBL-3): Streckenmitte bzw. Bogenpunkt gleichen Abstands. */
export function labelPoint(shape: ElementShape): ScreenPoint {
  const c = shape.centerline;
  const mid = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
  if (c.kind === "strecke") return mid;
  const dx = mid.x - c.center.x;
  const dy = mid.y - c.center.y;
  const k = c.radius / Math.hypot(dx, dy);
  return { x: c.center.x + dx * k, y: c.center.y + dy * k };
}

const textOf = (variant: LabelVariant, texts: LabelTexts): string | undefined => {
  if (variant === "kurz") return texts.short;
  return variant === "voll" || variant === "symbolUndName" ? texts.full : undefined;
};

/**
 * Je gezeichnetem Teil-Element (Querungen ausgenommen, REQ-LBL-4) ein Eintrag in
 * Folgereihenfolge, auch mit Variante „keine“. P = Sehne der Mittellinie · scale.
 */
export function labelPlan(
  catalog: Catalog,
  elements: Elements,
  shapes: ReadonlyArray<ElementShape>,
  scale: number,
  on: boolean,
): ReadonlyArray<LabelEntry> {
  return shapes.flatMap((shape): LabelEntry[] => {
    const el = elements[shape.index] as Elements[number];
    if ("crosses" in el) return [];
    const texts = labelTexts(catalog, el.part) as LabelTexts;
    const c = shape.centerline;
    const room = Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y) * scale;
    const variant = labelVariant(catalog, el.part, room, on);
    return [
      {
        id: el.id,
        partId: el.part,
        variant,
        text: textOf(variant, texts),
        fullName: texts.full,
        symbol: symbolOf(el.part),
        at: labelPoint(shape),
      },
    ];
  });
}
