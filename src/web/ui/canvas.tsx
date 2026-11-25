/**
 * Zeichenfläche (Spec M2, REQ-UI-3, -4, -5, -7): Bänder je Element aus der Zeichengeometrie der
 * Logik, Auswahl per Tipp, Zoomen und Verschieben mit Maus und Touch. Gesten auf der Fläche
 * zoomen nicht die Seite (`touch-action: none`).
 */
import { useEffect, useRef } from "preact/hooks";
import type { CatalogEntry, LayoutElement } from "../../core/index.js";
import {
  type Centerline,
  type ElementShape,
  type LabelEntry,
  labelPlan,
  type ScreenPoint,
  SYMBOL_PX,
  SYMBOL_ROW_PX,
  textWidth,
} from "../editor/index.js";
import { PlanSymbol } from "./symbols.js";
import { panBy, type View, zoomAt } from "./view.js";

export type EndMark = { readonly at: ScreenPoint; readonly dir: number };

/** Inhalt der Zeichenfläche ohne `<svg>`-Hülle und ohne Gesten (hook-frei, prüfbar ohne DOM). */
export type PlanContentProps = {
  readonly catalog: ReadonlyArray<CatalogEntry>;
  readonly elements: ReadonlyArray<LayoutElement>;
  readonly shapes: ReadonlyArray<ElementShape>;
  readonly crossingIds: ReadonlySet<string>;
  readonly selectedId: string | undefined;
  readonly targets: ReadonlyArray<ScreenPoint>;
  readonly hotPorts: ReadonlyArray<ScreenPoint>;
  readonly end: EndMark | undefined;
  readonly errorAt: ScreenPoint | undefined;
  readonly view: View;
  /** Schalter „Namen“ (REQ-LBL-5). */
  readonly labelsOn: boolean;
};

type Props = PlanContentProps & {
  readonly onView: (v: View) => void;
  readonly onTap: (id: string | undefined) => void;
  readonly onSize: (width: number, height: number) => void;
};

/** Ab dieser Bewegung (px) ist ein Tipp ein Ziehen und wählt nichts aus. */
const TAP_SLOP = 8;

const f = (n: number): string => n.toFixed(2);

/** Drehsinn eines Bogens von `from` nach `to` als SVG-Sweep-Flag (y nach unten). */
const sweep = (c: Extract<Centerline, { kind: "bogen" }>): 0 | 1 =>
  (c.from.x - c.center.x) * (c.to.y - c.center.y) -
    (c.from.y - c.center.y) * (c.to.x - c.center.x) >
  0
    ? 1
    : 0;

const linePath = (c: Centerline): string =>
  c.kind === "strecke"
    ? `M${f(c.from.x)} ${f(c.from.y)}L${f(c.to.x)} ${f(c.to.y)}`
    : `M${f(c.from.x)} ${f(c.from.y)}A${f(c.radius)} ${f(c.radius)} 0 0 ${sweep(c)} ${f(c.to.x)} ${f(c.to.y)}`;

/** Band als geschlossene Fläche: linker Rand hin, rechter Rand zurück. */
const bandPath = (s: ElementShape): string => {
  const { left, right } = s.band;
  const back =
    right.kind === "strecke"
      ? `L${f(right.from.x)} ${f(right.from.y)}`
      : `A${f(right.radius)} ${f(right.radius)} 0 0 ${1 - sweep(right)} ${f(right.from.x)} ${f(right.from.y)}`;
  return `${linePath(left)}L${f(right.to.x)} ${f(right.to.y)}${back}Z`;
};

/** Querweg einer Kreuzung als 114 mm breites Band zwischen ihren Queranschlüssen. */
const crosswayPath = (a: ScreenPoint, b: ScreenPoint): string => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = (-(b.y - a.y) / len) * 57;
  const ny = ((b.x - a.x) / len) * 57;
  return `M${f(a.x + nx)} ${f(a.y + ny)}L${f(b.x + nx)} ${f(b.y + ny)}L${f(b.x - nx)} ${f(b.y - ny)}L${f(a.x - nx)} ${f(a.y - ny)}Z`;
};

export function Canvas(props: Props) {
  const { view } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const el = wrap.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => propsRef.current.onSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    propsRef.current.onSize(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Gesten: Mausrad zoomt um den Zeiger; ein Zeiger verschiebt; zwei Zeiger zoomen um ihre Mitte.
  useEffect(() => {
    const el = svg.current;
    if (el === null) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let downId: string | undefined;
    let multi = false;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const set = (v: View) => {
      viewRef.current = v;
      propsRef.current.onView(v);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      set(zoomAt(viewRef.current, p.x, p.y, Math.exp(-e.deltaY * 0.0015)));
    };
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        moved = 0;
        multi = false;
        const hit = (e.target as Element | null)?.closest("[data-id]");
        downId = hit?.getAttribute("data-id") ?? undefined;
      } else {
        multi = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (prev === undefined) return;
      const p = local(e);
      if (pointers.size === 1) {
        moved += Math.hypot(p.x - prev.x, p.y - prev.y);
        pointers.set(e.pointerId, p);
        set(panBy(viewRef.current, p.x - prev.x, p.y - prev.y));
        return;
      }
      const others = [...pointers.entries()].filter(([id]) => id !== e.pointerId);
      const other = others[0]?.[1];
      pointers.set(e.pointerId, p);
      if (other === undefined) return;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      const cx = (p.x + other.x) / 2;
      const cy = (p.y + other.y) / 2;
      let v = panBy(viewRef.current, (p.x - prev.x) / 2, (p.y - prev.y) / 2);
      if (before > 0) v = zoomAt(v, cx, cy, after / before);
      set(v);
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && !multi && moved < TAP_SLOP) propsRef.current.onTap(downId);
    };
    // iOS Safari: Seitenzoom per Geste auf der Fläche unterbinden.
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("gesturestart", stop);
    };
  }, []);

  return (
    <div class="canvas" ref={wrap}>
      <svg ref={svg} class="canvas-svg" role="img" aria-label="Strecke">
        <title>Strecke</title>
        <PlanContent
          catalog={props.catalog}
          elements={props.elements}
          shapes={props.shapes}
          crossingIds={props.crossingIds}
          selectedId={props.selectedId}
          targets={props.targets}
          hotPorts={props.hotPorts}
          end={props.end}
          errorAt={props.errorAt}
          view={view}
          labelsOn={props.labelsOn}
        />
      </svg>
    </div>
  );
}

/**
 * Beschriftung und Symbol eines Elements (Spec plan-beschriftung-symbole, REQ-LBL-8, REQ-SYM-2):
 * am Ort aus REQ-LBL-3, auf Bildschirmpixel zurückskaliert, nie gedreht. Die Gruppe trägt die
 * Element-ID, damit ein Tipp darauf das Element auswählt (REQ-LBL-9); eigene Ereignis-Handler gibt
 * es nicht, Ziehen und Mausrad bleiben bei der Zeichenfläche (REQ-LBL-10).
 */
function PlanLabel({ entry, px }: { readonly entry: LabelEntry; readonly px: number }) {
  const { variant, symbol, text } = entry;
  const row = variant === "symbolUndName";
  // Zeile „Symbol + Name“: W = 20 + B, als Ganzes um den Ort zentriert.
  const left = row ? -(SYMBOL_ROW_PX + textWidth(entry.fullName)) / 2 : -SYMBOL_PX / 2;
  return (
    <g
      data-id={entry.id}
      class="plan-label"
      transform={`translate(${entry.at.x} ${entry.at.y}) scale(${px})`}
    >
      {symbol !== undefined && (
        <PlanSymbol kind={symbol} name={entry.fullName} x={left} y={-SYMBOL_PX / 2} />
      )}
      {text !== undefined && (
        <text
          class="plan-label-text"
          x={row ? left + SYMBOL_ROW_PX : 0}
          y={0}
          font-size={12}
          text-anchor={row ? "start" : "middle"}
          dominant-baseline="central"
        >
          {text}
        </text>
      )}
    </g>
  );
}

/**
 * Inhalt der Zeichenfläche samt Ansichts-Transformation, ohne `<svg>`-Hülle und ohne Hooks.
 * Ebenen von unten nach oben: Bänder (mit Querwegen), Querungen, Auswahl, Beschriftungen und
 * Symbole (REQ-LBL-9), Zielmarken, hervorgehobene Queranschlüsse, Startmarke, Endpfeil,
 * Fehlermarke.
 */
export function PlanContent(props: PlanContentProps) {
  const { view } = props;
  const px = 1 / view.scale; // 1 Bildschirm-Pixel in mm
  const parts = props.shapes.filter((s) => !props.crossingIds.has(s.id));
  const crossings = props.shapes.filter((s) => props.crossingIds.has(s.id));
  const selected = props.shapes.find((s) => s.id === props.selectedId);
  const end = props.end;
  const labels = labelPlan(
    props.catalog,
    props.elements,
    props.shapes,
    view.scale,
    props.labelsOn,
  ).filter((e) => e.variant !== "keine");

  return (
    <g transform={`matrix(${view.scale} 0 0 ${view.scale} ${view.tx} ${view.ty})`}>
      {parts.map((s) => (
        <g key={s.id} data-id={s.id} class="part">
          <path class="band" d={bandPath(s)} vector-effect="non-scaling-stroke" />
          {s.ports !== undefined && (
            <path
              class="crossway"
              d={crosswayPath(s.ports.left, s.ports.right)}
              vector-effect="non-scaling-stroke"
            />
          )}
          <path class="centerline" d={linePath(s.centerline)} vector-effect="non-scaling-stroke" />
        </g>
      ))}
      {crossings.map((s) => (
        <g key={s.id} data-id={s.id} class="part querung">
          <path class="band" d={bandPath(s)} vector-effect="non-scaling-stroke" />
          <path class="centerline" d={linePath(s.centerline)} vector-effect="non-scaling-stroke" />
        </g>
      ))}
      {selected !== undefined && (
        <path class="selected" d={bandPath(selected)} vector-effect="non-scaling-stroke" />
      )}
      {labels.map((e) => (
        <PlanLabel key={e.id} entry={e} px={px} />
      ))}
      {props.targets.map((t) => (
        <circle
          key={`t${t.x},${t.y}`}
          class="target"
          cx={t.x}
          cy={t.y}
          r={14 * px}
          vector-effect="non-scaling-stroke"
        />
      ))}
      {props.hotPorts.map((t) => (
        <circle key={`h${t.x},${t.y}`} class="hot-port" cx={t.x} cy={t.y} r={18 * px} />
      ))}
      <circle class="start" cx={0} cy={0} r={7 * px} />
      {end !== undefined && (
        <path
          class="end-arrow"
          transform={`translate(${end.at.x} ${end.at.y}) rotate(${-end.dir * 45}) scale(${px})`}
          d="M18 0L-6 -12L-6 12Z"
        />
      )}
      {props.errorAt !== undefined && (
        <g transform={`translate(${props.errorAt.x} ${props.errorAt.y}) scale(${px})`}>
          <circle class="error-mark" r={14} />
          <text class="error-mark-text" text-anchor="middle" dy="5">
            !
          </text>
        </g>
      )}
    </g>
  );
}
