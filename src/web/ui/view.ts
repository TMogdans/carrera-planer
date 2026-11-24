/**
 * Ansicht der Zeichenfläche: Maßstab und Verschiebung (Spec M2, REQ-UI-7). Bildschirm-Pixel =
 * mm · scale + (tx, ty). Die Ansicht gehört nicht zum Verlauf und wird nicht gespeichert.
 */
import type { ScreenPoint } from "../editor/index.js";

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
