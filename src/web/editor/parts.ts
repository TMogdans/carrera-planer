/**
 * Gemeinsame Hilfen der Editor-Logik: Startpose und Katalog-Nachschlagen (Spec M2, „Begriffe“).
 *
 * Hinweis zur Form (gilt für alle Module in src/web/editor): Die Tests laden die Module dynamisch
 * innerhalb eines Tests. Code, der schon beim Laden des Moduls ausgewertet wird, ordnet Strykers
 * perTest-Abdeckung nur dem ersten ladenden Test zu. Deshalb stehen hier Funktionsdeklarationen und
 * keine auf Modulebene ausgewerteten Ausdrücke.
 */
import type { CatalogEntry, Coord, LayoutElement, Pose } from "../../core/index.js";
import type { Catalog } from "./types.js";

type Geometry = CatalogEntry["geometry"];
export type PlaceableGeometry = Extract<
  Geometry,
  { readonly kind: "gerade" | "kurve" | "kreuzung" }
>;

function zero(): Coord {
  return { a: { num: 0n, den: 1n }, b: { num: 0n, den: 1n } };
}

/** Feste Startpose (0, 0, k = 0); sie gehört nicht zum Layout. */
export function origin(): Pose {
  return { x: zero(), y: zero(), dir: 0 };
}

/**
 * Teil-ID eines Elements; bei einer Querung `undefined`. Die Querung hat zur Laufzeit kein Feld
 * `part`, das Lesen liefert dort also `undefined` (keine eigene Fallunterscheidung nötig).
 */
export function partOf(el: LayoutElement | undefined): string | undefined {
  return (el as { readonly part?: string } | undefined)?.part;
}

/** Katalog-Geometrie zu einer Teil-ID; unbekannt oder ohne Teil-ID `undefined`. */
export function geometryOf(catalog: Catalog, partId: string | undefined): Geometry | undefined {
  return catalog.find((entry) => entry.id === partId)?.geometry;
}

/** Platzierbar heißt: Geometrie gerade, kurve oder kreuzung (M1). */
export function isPlaceable(g: Geometry | undefined): g is PlaceableGeometry {
  return g?.kind === "gerade" || g?.kind === "kurve" || g?.kind === "kreuzung";
}
