/**
 * Gezeichneter Abschnitt und Zeichengeometrie (Spec M2, REQ-EDIT-18 und -19).
 *
 * Posen kommen vom Kern (`trace`); hier wird nur noch in Gleitkomma-Bildschirmkoordinaten
 * umgerechnet (x = x, y = −y, mm). Für die Lage wird nichts selbst gerechnet. Das Band ist
 * 114 mm breit: Ränder je 57 mm neben der Mittellinie. Zur Form siehe parts.ts.
 */
import { type Coord, type Pose, type Step, type TraceResult, trace } from "../../core/index.js";
import { geometryOf, origin, partOf } from "./parts.js";
import type { Catalog, Centerline, ElementShape, Elements, ScreenPoint } from "./types.js";

/** a + b·√2 → Zahl in mm (Gleitkomma; nur für die Darstellung). */
export function coordToNumber(c: Coord): number {
  return Number(c.a.num) / Number(c.a.den) + (Number(c.b.num) / Number(c.b.den)) * Math.SQRT2;
}

export type DrawnSection = {
  readonly firstErrorIndex: number | undefined;
  readonly steps: ReadonlyArray<Step>;
  readonly drawnCount: number;
  readonly notDrawnCount: number;
};

/**
 * Elemente vor dem ersten Fehlerindex; ohne Fehler die ganze Folge. Der Anfang vor dem ersten
 * Fehler ist nach M1 allein fehlerfrei verfolgbar (Spec M2, Entscheidung 3).
 */
export function drawnSection(catalog: Catalog, elements: Elements): DrawnSection {
  const full = trace(catalog, elements, origin());
  const firstErrorIndex = full.ok
    ? undefined
    : Math.min(...full.errors.map((e) => ("indices" in e ? Math.min(...e.indices) : e.index)));
  const drawnCount = firstErrorIndex ?? elements.length;
  const prefix = trace(catalog, elements.slice(0, drawnCount), origin()) as Extract<
    TraceResult,
    { readonly ok: true }
  >;
  return {
    firstErrorIndex,
    steps: prefix.steps,
    drawnCount,
    notDrawnCount: elements.length - drawnCount,
  };
}

function screen(p: Pose): ScreenPoint {
  return { x: coordToNumber(p.x), y: -coordToNumber(p.y) };
}

/** Punkt im Abstand d links (d > 0) bzw. rechts (d < 0) der Fahrtrichtung, Bildschirm. */
function aside(p: ScreenPoint, dir: number, d: number): ScreenPoint {
  const theta = (dir * Math.PI) / 4;
  return { x: p.x - d * Math.sin(theta), y: p.y - d * Math.cos(theta) };
}

function shapeOf(
  catalog: Catalog,
  elements: Elements,
  from: Pose,
  step: Step,
  index: number,
): ElementShape {
  const el = elements[index] as Elements[number];
  const to = step.pose;
  const a = screen(from);
  const b = screen(to);
  const edge = (d: number): { readonly from: ScreenPoint; readonly to: ScreenPoint } => ({
    from: aside(a, from.dir, d),
    to: aside(b, to.dir, d),
  });
  const g = geometryOf(catalog, partOf(el));
  let centerline: Centerline;
  let left: Centerline;
  let right: Centerline;
  if (g?.kind === "kurve") {
    const links = (el as { readonly turn?: string }).turn === "links";
    const center = aside(a, from.dir, links ? g.radius : -g.radius);
    const arc = (e: { readonly from: ScreenPoint; readonly to: ScreenPoint }): Centerline => ({
      kind: "bogen",
      ...e,
      center,
      radius: Math.hypot(e.from.x - center.x, e.from.y - center.y),
    });
    centerline = { kind: "bogen", from: a, to: b, center, radius: g.radius };
    left = arc(edge(57));
    right = arc(edge(-57));
  } else {
    centerline = { kind: "strecke", from: a, to: b };
    left = { kind: "strecke", ...edge(57) };
    right = { kind: "strecke", ...edge(-57) };
  }
  const shape: ElementShape = { id: el.id, index, centerline, band: { left, right } };
  const ports = step.crossPorts;
  return ports === undefined
    ? shape
    : { ...shape, ports: { left: screen(ports.left), right: screen(ports.right) } };
}

/** Zeichengeometrie je Element des gezeichneten Abschnitts, in Folgereihenfolge. */
export function drawing(catalog: Catalog, elements: Elements): ReadonlyArray<ElementShape> {
  return drawnSection(catalog, elements).steps.map((step, index, steps) =>
    shapeOf(catalog, elements, steps[index - 1]?.pose ?? origin(), step, index),
  );
}
