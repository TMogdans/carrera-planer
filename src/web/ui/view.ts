/**
 * Ansicht der Zeichenfläche: Maßstab und Verschiebung (Spec M2, REQ-UI-7). Bildschirm-Pixel =
 * mm · scale + (tx, ty). Die Ansicht gehört nicht zum Verlauf und wird nicht gespeichert.
 */
import type { Centerline, ScreenPoint } from "../editor/index.js";

export type View = { readonly scale: number; readonly tx: number; readonly ty: number };
export type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const MIN_SCALE = 0.01;
const MAX_SCALE = 20;

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoomt um einen Bildschirmpunkt (Mauszeiger, Fingermitte); der Punkt bleibt stehen. */
export const zoomAt = (v: View, px: number, py: number, factor: number): View => {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
};

export const panBy = (v: View, dx: number, dy: number): View => ({
  ...v,
  tx: v.tx + dx,
  ty: v.ty + dy,
});

export const toScreen = (v: View, p: ScreenPoint): ScreenPoint => ({
  x: p.x * v.scale + v.tx,
  y: p.y * v.scale + v.ty,
});

/** Zeigt die ganze Box mit Rand (Einpassen). */
export const fitBox = (box: Box, width: number, height: number, margin = 40): View => {
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const scale = clampScale(Math.min((width - 2 * margin) / w, (height - 2 * margin) / h, 1.5));
  return {
    scale,
    tx: width / 2 - ((box.minX + box.maxX) / 2) * scale,
    ty: height / 2 - ((box.minY + box.maxY) / 2) * scale,
  };
};

/**
 * Verschiebt die Ansicht ohne Zoom so, dass der Punkt mit Rand sichtbar ist (REQ-UI-7, Frage 12).
 * Liegt er schon im sichtbaren Bereich, bleibt die Ansicht unverändert.
 */
export const follow = (
  v: View,
  p: ScreenPoint,
  width: number,
  height: number,
  margin = 60,
): View => {
  const s = toScreen(v, p);
  const m = Math.min(margin, width / 4, height / 4);
  const dx = s.x < m ? m - s.x : s.x > width - m ? width - m - s.x : 0;
  const dy = s.y < m ? m - s.y : s.y > height - m ? height - m - s.y : 0;
  return dx === 0 && dy === 0 ? v : panBy(v, dx, dy);
};

const TAU = 2 * Math.PI;
const norm = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Punkte, die die Box einer Linie bestimmen: Endpunkte, bei Bögen zusätzlich die
 * achsparallelen Extrempunkte, die im überstrichenen Winkel liegen. */
const extremes = (c: Centerline): ScreenPoint[] => {
  if (c.kind === "strecke") return [c.from, c.to];
  const a0 = Math.atan2(c.from.y - c.center.y, c.from.x - c.center.x);
  const a1 = Math.atan2(c.to.y - c.center.y, c.to.x - c.center.x);
  // Drehsinn (Bildschirm, y nach unten): Kreuzprodukt > 0 heißt wachsender Winkel.
  const cross =
    (c.from.x - c.center.x) * (c.to.y - c.center.y) -
    (c.from.y - c.center.y) * (c.to.x - c.center.x);
  const inArc = (t: number): boolean =>
    cross > 0 ? norm(t - a0) <= norm(a1 - a0) : norm(a0 - t) <= norm(a0 - a1);
  const axes = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].filter(inArc);
  return [
    c.from,
    c.to,
    ...axes.map((t) => ({
      x: c.center.x + c.radius * Math.cos(t),
      y: c.center.y + c.radius * Math.sin(t),
    })),
  ];
};

/** Box über alle Linien (bei Bändern also inklusive der ±57-mm-Ränder) und weitere Punkte. */
export const boundsOf = (lines: ReadonlyArray<Centerline>, ...more: ScreenPoint[]): Box => {
  const pts = [...more, ...lines.flatMap(extremes)];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
};
