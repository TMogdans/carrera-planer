/**
 * Spec plan-beschriftung-symbole (.specify/specs/plan-beschriftung-symbole/spec.md): Darstellung
 * der Beschriftungen und Symbole am Preact-VNode-Baum, ohne DOM. Abnahmetests REQ-LBL-7 (Teil),
 * REQ-LBL-8, REQ-LBL-9, REQ-LBL-10 (Teil), REQ-SYM-2, REQ-SYM-3 (Teil), REQ-SYM-4, REQ-SYM-5.
 *
 * Die Datei liegt in src/web/editor statt in src/web/ui, damit sie zu den verwalteten Tests gehört
 * (.devloop/managed-tests.json): implement darf hier nur `.skip` entfernen. Sie lädt die
 * Oberflächen-Module nur dynamisch; die Editor-Logik selbst importiert weiter kein Preact
 * (REQ-PARCH-1, labels-architecture.test.ts).
 *
 * ## Gewählte Schnittstelle (implement setzt genau diese um)
 *
 * - `src/web/ui/canvas.tsx` exportiert zusätzlich `PlanContent(props: PlanContentProps)`: eine
 *   Komponente **ohne Hooks**, die den Inhalt der Zeichenfläche liefert, einschließlich der
 *   Ansichts-Transformation (bisher `<g transform="matrix(…)">` in `Canvas`), ohne `<svg>`-Hülle.
 *   `Canvas` rendert sie. Kind-Komponenten darin sind ebenfalls hook-frei (der Test ruft sie als
 *   Funktionen auf).
 * - `src/web/ui/labels-toggle.tsx` exportiert `LabelsToggle({ on, onToggle })`: hook-freier Knopf
 *   „Namen“ der Werkzeugleiste.
 *
 * Woran der Test Beschriftung und Symbol im Baum erkennt (Teil des Vertrags):
 * - Beschriftung = `<text>`-Element mit einem Vorfahren (oder selbst) mit `data-id`. Andere
 *   `<text>`-Elemente (Fehlermarke „!“) haben keinen `data-id`-Vorfahren.
 * - Symbol = das Elternelement eines `<title>` mit `data-id`-Vorfahren (REQ-SYM-4: jedes Symbol
 *   trägt genau ein `<title>`). Die Plakette ist das flächengrößte `<rect>` darin.
 * - Schriftgröße steht als `font-size` (Attribut oder `style`) am Text oder einem Vorfahren im
 *   Baum, nicht nur im Stylesheet; Lage und Größe ergeben sich aus den `transform`-Attributen
 *   (auch verschachtelte `<svg>` mit `viewBox` werden berücksichtigt).
 * - Ebenen: Bänder, Querwege, Querungen und Auswahl sind an den bestehenden Klassen `band`,
 *   `crossway`, `querung`, `selected` erkennbar, die Marken an `target`, `hot-port`, `start`,
 *   `end-arrow`, `error-mark`.
 *
 * Orakel: Texte und Varianten aus der Tabelle in REQ-LBL-2, Orte aus der Zeichengeometrie
 * (Streckenmitte, Bogenmitte) unabhängig gerechnet, Bildschirmpunkt = mm · s + (tx, ty).
 *
 * Nur im Smoke prüfbar (keine Testfälle hier): Tippziel 44 × 44 und kein waagerechtes Scrollen
 * (REQ-LBL-7), Kontraste und Lesbarkeit (REQ-LBL-10, REQ-SYM-3), Gesten im Browser
 * (REQ-LBL-10), Erkennbarkeit der Formen in Graustufen (REQ-SYM-3), Netzwerk-Reiter (REQ-SYM-5).
 */
import { describe, expect, test } from "vitest";
import {
  ACHT,
  CATALOG,
  type CatalogEntry,
  type Centerline,
  type ElementShape,
  type LayoutElement,
  loadDrawing,
  type ScreenPoint,
} from "../test-support/editor-fixtures.js";

type Catalog = ReadonlyArray<CatalogEntry>;
type Elements = ReadonlyArray<LayoutElement>;
type View = { readonly scale: number; readonly tx: number; readonly ty: number };

type PlanContentProps = {
  readonly catalog: Catalog;
  readonly elements: Elements;
  readonly shapes: ReadonlyArray<ElementShape>;
  readonly crossingIds: ReadonlySet<string>;
  readonly selectedId: string | undefined;
  readonly targets: ReadonlyArray<ScreenPoint>;
  readonly hotPorts: ReadonlyArray<ScreenPoint>;
  readonly end: { readonly at: ScreenPoint; readonly dir: number } | undefined;
  readonly errorAt: ScreenPoint | undefined;
  readonly view: View;
  readonly labelsOn: boolean;
};
type CanvasApi = { PlanContent(props: PlanContentProps): unknown };
type ToggleApi = {
  LabelsToggle(props: { readonly on: boolean; readonly onToggle: () => void }): unknown;
};

const CANVAS_MODULE = "../ui/canvas.js";
const TOGGLE_MODULE = "../ui/labels-toggle.js";
const loadCanvas = async (): Promise<CanvasApi> =>
  (await import(/* @vite-ignore */ CANVAS_MODULE)) as CanvasApi;
const loadToggle = async (): Promise<ToggleApi> =>
  (await import(/* @vite-ignore */ TOGGLE_MODULE)) as ToggleApi;

// ---------------------------------------------------------------------------------------------
// VNode-Baum auswerten
// ---------------------------------------------------------------------------------------------

type Tree =
  | { readonly tag: "#text"; readonly text: string }
  | {
      readonly tag: string;
      readonly props: Readonly<Record<string, unknown>>;
      readonly children: ReadonlyArray<Tree>;
    };

/** VNode → Baum; Funktionskomponenten werden aufgerufen (sie müssen hook-frei sein). */
const expand = (v: unknown): Tree[] => {
  if (v === null || v === undefined || typeof v === "boolean") return [];
  if (typeof v === "string" || typeof v === "number") return [{ tag: "#text", text: String(v) }];
  if (Array.isArray(v)) return v.flatMap(expand);
  const node = v as { readonly type: unknown; readonly props: Record<string, unknown> };
  if (typeof node.type === "function") {
    const fn = node.type as ((p: unknown) => unknown) & { prototype?: { render?: unknown } };
    if (fn.prototype?.render !== undefined) throw new Error("Klassenkomponente im Baum");
    return expand(fn(node.props));
  }
  if (typeof node.type !== "string") throw new Error(`unbekannter Knoten ${String(node.type)}`);
  const { children, ...props } = node.props ?? {};
  return [{ tag: node.type, props, children: expand(children) }];
};

type Mat = readonly [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Mat, x: number, y: number): ScreenPoint => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});
const NUM = /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g;
const nums = (s: string): number[] => (s.match(NUM) ?? []).map(Number);

const parseTransform = (t: unknown): Mat => {
  if (t === undefined || t === null || t === "") return ID;
  let m: Mat = ID;
  for (const [, fn, args] of String(t).matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = nums(args ?? "");
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let n: Mat;
    switch (fn) {
      case "matrix":
        n = [a[0] ?? 1, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1, a[4] ?? 0, a[5] ?? 0];
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r: Mat = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
        const cx = a[1] ?? 0;
        const cy = a[2] ?? 0;
        n = mul(mul([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case "skewX":
        n = [1, 0, Math.tan(rad), 1, 0, 0];
        break;
      case "skewY":
        n = [1, Math.tan(rad), 0, 1, 0, 0];
        break;
      default:
        throw new Error(`unbekannte Transformation ${fn}`);
    }
    m = mul(m, n);
  }
  return m;
};

const num = (v: unknown, fallback = 0): number => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = nums(String(v))[0];
  return n === undefined ? fallback : n;
};

/** Eigene Transformation eines Elements (transform; verschachteltes svg: x, y, viewBox). */
const ownMatrix = (tag: string, props: Readonly<Record<string, unknown>>): Mat => {
  const t = parseTransform(props.transform);
  if (tag !== "svg") return t;
  let m = mul(t, [1, 0, 0, 1, num(props.x), num(props.y)]);
  const vb = props.viewBox ?? props.viewbox;
  if (vb !== undefined) {
    const [vx = 0, vy = 0, vw = 1, vh = 1] = nums(String(vb));
    const w = num(props.width, vw);
    const h = num(props.height, vh);
    m = mul(m, [w / vw, 0, 0, h / vh, -vx * (w / vw), -vy * (h / vh)]);
  }
  return m;
};

type Flat = {
  readonly i: number;
  readonly tag: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly parent: number;
  /** Transformation dieses Elements zum Bildschirm (inklusive seiner eigenen). */
  readonly m: Mat;
  readonly text: string;
};

/** Vorordnung (Dokumentreihenfolge) mit Eltern und wirksamer Transformation. */
const flatten = (roots: ReadonlyArray<Tree>): Flat[] => {
  const out: Flat[] = [];
  const textOf = (t: Tree): string =>
    t.tag === "#text" ? (t as { text: string }).text : childrenOf(t).map(textOf).join("");
  const walk = (t: Tree, parent: number, m: Mat): void => {
    if (t.tag === "#text") return;
    const props = (t as { props: Readonly<Record<string, unknown>> }).props;
    const own = mul(m, ownMatrix(t.tag, props));
    const i = out.length;
    out.push({ i, tag: t.tag, props, parent, m: own, text: textOf(t) });
    for (const c of childrenOf(t)) walk(c, i, own);
  };
  for (const r of roots) walk(r, -1, ID);
  return out;
};
const childrenOf = (t: Tree): ReadonlyArray<Tree> =>
  t.tag === "#text" ? [] : (t as { children: ReadonlyArray<Tree> }).children;

const ancestors = (flat: ReadonlyArray<Flat>, n: Flat): Flat[] => {
  const out: Flat[] = [];
  for (let p = n.parent; p >= 0; p = (flat[p] as Flat).parent) out.push(flat[p] as Flat);
  return out;
};
const selfAndAncestors = (flat: ReadonlyArray<Flat>, n: Flat): Flat[] => [n, ...ancestors(flat, n)];
const descendants = (flat: ReadonlyArray<Flat>, n: Flat): Flat[] =>
  flat.filter((x) => x.i !== n.i && ancestors(flat, x).some((a) => a.i === n.i));
const dataIdOf = (flat: ReadonlyArray<Flat>, n: Flat): string | undefined => {
  const hit = selfAndAncestors(flat, n).find((a) => a.props["data-id"] !== undefined);
  return hit === undefined ? undefined : String(hit.props["data-id"]);
};
const classesOf = (n: Flat): ReadonlyArray<string> =>
  String(n.props.class ?? n.props.className ?? "")
    .split(/\s+/)
    .filter((c) => c !== "");

/** Wert einer geerbten Präsentationseigenschaft (Attribut oder style) am Element oder darüber. */
const styleValue = (n: Flat, name: string): unknown => {
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const direct = n.props[name] ?? n.props[camel];
  if (direct !== undefined) return direct;
  const style = n.props.style;
  if (typeof style === "string") {
    const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));
    if (m !== null) return (m[1] as string).trim();
  } else if (typeof style === "object" && style !== null) {
    const o = style as Record<string, unknown>;
    if (o[name] !== undefined) return o[name];
    if (o[camel] !== undefined) return o[camel];
  }
  return undefined;
};
const inherited = (flat: ReadonlyArray<Flat>, n: Flat, name: string): unknown => {
  for (const a of selfAndAncestors(flat, n)) {
    const v = styleValue(a, name);
    if (v !== undefined) return v;
  }
  return undefined;
};

/** Beschriftungen: `<text>` mit data-id-Vorfahren. */
const labelTexts = (flat: ReadonlyArray<Flat>): Flat[] =>
  flat.filter((n) => n.tag === "text" && dataIdOf(flat, n) !== undefined);
/** Symbole: Elternelement eines `<title>` mit data-id-Vorfahren. */
const symbolRoots = (flat: ReadonlyArray<Flat>): Flat[] =>
  flat
    .filter((n) => n.tag === "title" && dataIdOf(flat, n) !== undefined)
    .map((n) => flat[n.parent] as Flat);

/** Punkte eines Pfads (End- und Kontrollpunkte; bei Bögen der Endpunkt). */
const pathPoints = (d: string): Array<[number, number]> => {
  const tokens = d.match(/[a-zA-Z]|[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  const pts: Array<[number, number]> = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  const isNum = (t: string | undefined) => t !== undefined && !/^[a-zA-Z]$/.test(t);
  const take = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pair = (): [number, number] => {
      const x = take();
      const y = take();
      return rel ? [cx + x, cy + y] : [x, y];
    };
    if (C === "Z") {
      cx = sx;
      cy = sy;
      continue;
    }
    if (C === "H") {
      const x = take();
      cx = rel ? cx + x : x;
    } else if (C === "V") {
      const y = take();
      cy = rel ? cy + y : y;
    } else if (C === "A") {
      for (let k = 0; k < 5; k++) take();
      [cx, cy] = pair();
    } else {
      const n = { M: 1, L: 1, T: 1, S: 2, Q: 2, C: 3 }[C];
      if (n === undefined) throw new Error(`Pfadbefehl ${cmd}`);
      let p: [number, number] = [cx, cy];
      for (let k = 0; k < n; k++) {
        p = pair();
        if (k < n - 1) pts.push(p);
      }
      [cx, cy] = p;
      if (C === "M") {
        sx = cx;
        sy = cy;
        cmd = rel ? "l" : "L";
      }
    }
    pts.push([cx, cy]);
  }
  return pts;
};

/** Geometriepunkte eines Elements in Bildschirmkoordinaten. */
const screenPoints = (n: Flat): ScreenPoint[] => {
  const p = n.props;
  const at = (x: number, y: number) => apply(n.m, x, y);
  switch (n.tag) {
    case "rect": {
      const x = num(p.x);
      const y = num(p.y);
      const w = num(p.width);
      const h = num(p.height);
      return [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)];
    }
    case "circle":
    case "ellipse": {
      const x = num(p.cx);
      const y = num(p.cy);
      const rx = num(p.rx, num(p.r));
      const ry = num(p.ry, num(p.r));
      return [at(x - rx, y), at(x + rx, y), at(x, y - ry), at(x, y + ry)];
    }
    case "line":
      return [at(num(p.x1), num(p.y1)), at(num(p.x2), num(p.y2))];
    case "polyline":
    case "polygon": {
      const v = nums(String(p.points ?? ""));
      const out: ScreenPoint[] = [];
      for (let k = 0; k + 1 < v.length; k += 2) out.push(at(v[k] as number, v[k + 1] as number));
      return out;
    }
    case "path":
      return pathPoints(String(p.d ?? "")).map(([x, y]) => at(x, y));
    default:
      return [];
  }
};

const isPureTranslation = (m: Mat): boolean =>
  Math.abs(m[0] - 1) < 1e-9 &&
  Math.abs(m[3] - 1) < 1e-9 &&
  Math.abs(m[1]) < 1e-9 &&
  Math.abs(m[2]) < 1e-9;
const isUnrotated = (m: Mat): boolean =>
  Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12 && m[0] > 0 && Math.abs(m[0] - m[3]) < 1e-9;

/** Schriftgröße in Bildschirm-Pixeln. */
const fontPx = (flat: ReadonlyArray<Flat>, n: Flat): number => {
  const v = inherited(flat, n, "font-size");
  if (v === undefined) throw new Error("keine font-size im Baum");
  return num(v, Number.NaN) * Math.sqrt(Math.abs(n.m[0] * n.m[3] - n.m[1] * n.m[2]));
};

/** Ankerpunkt eines Texts auf dem Bildschirm (x, y, numerisches dx). */
const textAnchor = (n: Flat): ScreenPoint =>
  apply(n.m, num(n.props.x) + (typeof n.props.dx === "number" ? n.props.dx : 0), num(n.props.y));

/** Senkrecht mittig: dominant-baseline central/middle oder dy ≈ 0,35 em (3,6 … 4,8 px). */
const verticallyCentered = (flat: ReadonlyArray<Flat>, n: Flat): boolean => {
  const base = String(inherited(flat, n, "dominant-baseline") ?? "");
  if (base === "central" || base === "middle") return true;
  const dy = n.props.dy;
  if (dy === undefined) return false;
  const s = String(dy);
  if (s.endsWith("em")) {
    const em = num(s);
    return em >= 0.3 && em <= 0.4;
  }
  const px = num(s) * Math.sqrt(Math.abs(n.m[0] * n.m[3]));
  return px >= 3.6 && px <= 4.8;
};

/** Plakette: flächengrößtes rect eines Symbols, als Bildschirm-Box. */
const plateOf = (flat: ReadonlyArray<Flat>, root: Flat) => {
  const rects = [root, ...descendants(flat, root)].filter((n) => n.tag === "rect");
  const boxes = rects.map((r) => {
    const pts = screenPoints(r);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      node: r,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  });
  boxes.sort(
    (a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY),
  );
  const plate = boxes[0];
  if (plate === undefined) throw new Error("Symbol ohne Plakette (rect)");
  return plate;
};

// ---------------------------------------------------------------------------------------------
// Szenen und Orakel
// ---------------------------------------------------------------------------------------------

const B = (text: string): number => [...text].length * 7.5;

const midOf = (c: Centerline): ScreenPoint => {
  const m = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
  if (c.kind === "strecke") return m;
  const dx = m.x - c.center.x;
  const dy = m.y - c.center.y;
  const len = Math.hypot(dx, dy);
  return { x: c.center.x + (dx / len) * c.radius, y: c.center.y + (dy / len) * c.radius };
};

const TX = 37;
const TY = 211;
const toScreen = (s: number, p: ScreenPoint): ScreenPoint => ({ x: p.x * s + TX, y: p.y * s + TY });

const near = (a: number, b: number, what: string, tol = 0.01): void => {
  expect(Math.abs(a - b), `${what}: erwartet ${b}, erhalten ${a}`).toBeLessThanOrEqual(tol);
};

/** Tabelle in REQ-LBL-2 (ein Element je Zeile). */
const TABLE_SCENE: Elements = [
  { id: "g100", part: "gerade-100" },
  { id: "g342", part: "gerade-342" },
  { id: "k145", part: "kurve-1-45", turn: "links" },
  { id: "kr", part: "kreuzung" },
  { id: "rz", part: "rundenzaehler" },
  { id: "as", part: "anschlussstueck" },
];
type Expect = {
  readonly text: string | undefined;
  readonly symbol: boolean;
  readonly line: boolean;
};
const none: Expect = { text: undefined, symbol: false, line: false };
const onlySymbol: Expect = { text: undefined, symbol: true, line: false };
const plain = (text: string): Expect => ({ text, symbol: false, line: false });
const withSymbol = (text: string): Expect => ({ text, symbol: true, line: true });
const TABLE: ReadonlyArray<readonly [number, Readonly<Record<string, Expect>>]> = [
  [0.15, { g100: none, g342: plain("342"), k145: none, kr: none, rz: onlySymbol, as: onlySymbol }],
  [
    0.4,
    {
      g100: plain("100"),
      g342: plain("Gerade 342"),
      k145: plain("1/45°"),
      kr: plain("Kreuzung"),
      rz: onlySymbol,
      as: onlySymbol,
    },
  ],
  [
    1.14,
    {
      g100: plain("Gerade 100"),
      g342: plain("Gerade 342"),
      k145: plain("Kurve 1/45°"),
      kr: plain("Kreuzung"),
      rz: withSymbol("Rundenzähler"),
      as: withSymbol("Anschlussstück"),
    },
  ],
];

/** Alle Symbolteile (zwei davon mit demselben Spurwechsel-Zeichen) und zwei ohne Symbol. */
const SYMBOL_SCENE: Elements = [
  { id: "rz", part: "rundenzaehler" },
  { id: "as", part: "anschlussstueck" },
  { id: "swg", part: "spurwechsel-gerade" },
  { id: "en", part: "engstelle" },
  { id: "swk", part: "spurwechselkurve", turn: "links" },
  { id: "g", part: "gerade-342" },
  { id: "kr", part: "kreuzung" },
];
const FULL_NAMES: Readonly<Record<string, string>> = {
  rz: "Rundenzähler",
  as: "Anschlussstück",
  swg: "Spurwechsel gerade",
  en: "Engstelle",
  swk: "Spurwechselkurve",
};

type Scene = {
  readonly flat: ReadonlyArray<Flat>;
  readonly shapes: ReadonlyArray<ElementShape>;
};

const render = async (
  elements: Elements,
  scale: number,
  labelsOn: boolean,
  extra: Partial<PlanContentProps> = {},
): Promise<Scene> => {
  const { PlanContent } = await loadCanvas();
  const D = await loadDrawing();
  const shapes = D.drawing(CATALOG, elements);
  const props: PlanContentProps = {
    catalog: CATALOG,
    elements,
    shapes,
    crossingIds: new Set(elements.filter((e) => "crosses" in e).map((e) => e.id)),
    selectedId: undefined,
    targets: [],
    hotPorts: [],
    end: undefined,
    errorAt: undefined,
    view: { scale, tx: TX, ty: TY },
    labelsOn,
    ...extra,
  };
  const flat = flatten(expand(PlanContent(props)));
  // Kanarienvogel: die Ansichts-Transformation ist Teil der Ausgabe (Startmarke bei (tx, ty)),
  // und jedes gezeichnete Element hat sein Band.
  const start = flat.find((n) => n.tag === "circle" && classesOf(n).includes("start"));
  expect(start, "Startmarke fehlt").toBeDefined();
  const s0 = apply((start as Flat).m, num(start?.props.cx), num(start?.props.cy));
  near(s0.x, TX, "Startmarke x");
  near(s0.y, TY, "Startmarke y");
  expect(flat.filter((n) => classesOf(n).includes("band"))).toHaveLength(shapes.length);
  return { flat, shapes };
};

const shapeById = (scene: Scene, id: string): ElementShape => {
  const s = scene.shapes.find((x) => x.id === id);
  if (s === undefined) throw new Error(`kein Element ${id}`);
  return s;
};

const textsById = (flat: ReadonlyArray<Flat>, id: string): Flat[] =>
  labelTexts(flat).filter((n) => dataIdOf(flat, n) === id);
const symbolsById = (flat: ReadonlyArray<Flat>, id: string): Flat[] =>
  symbolRoots(flat).filter((n) => dataIdOf(flat, n) === id);

// ---------------------------------------------------------------------------------------------
// REQ-LBL-7: Schalter (Komponente)
// ---------------------------------------------------------------------------------------------

describe("Schalter „Namen“", () => {
  test("[REQ-LBL-7] Knopf „Namen“: aria-pressed zeigt den Zustand, Antippen schaltet um, Text als ausblendbares Label neben einem Zeichen", async () => {
    const { LabelsToggle } = await loadToggle();
    for (const on of [true, false]) {
      let calls = 0;
      const flat = flatten(expand(LabelsToggle({ on, onToggle: () => calls++ })));
      const buttons = flat.filter((n) => n.tag === "button");
      expect(buttons).toHaveLength(1);
      const button = buttons[0] as Flat;
      expect(button.props.type).toBe("button");
      expect(String(button.props["aria-pressed"])).toBe(String(on));
      // auf schmalen Bildschirmen nur das Zeichen: Text in span.label (wie die übrigen Knöpfe)
      const label = descendants(flat, button).find(
        (n) => n.tag === "span" && classesOf(n).includes("label"),
      );
      expect(label?.text).toBe("Namen");
      const icon = button.text.replace("Namen", "").trim();
      expect(icon.length).toBeGreaterThan(0);
      const onClick = button.props.onClick;
      expect(typeof onClick).toBe("function");
      (onClick as (e: unknown) => void)({});
      expect(calls).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-LBL-8: Textelemente
// ---------------------------------------------------------------------------------------------

describe("Beschriftung in der SVG-Ausgabe", () => {
  test("[REQ-LBL-8] je Element genau ein Textelement mit genau dem Text der Variante (Tabelle REQ-LBL-2), sonst keins", async () => {
    for (const [s, rows] of TABLE) {
      const { flat } = await render(TABLE_SCENE, s, true);
      for (const [id, e] of Object.entries(rows)) {
        const texts = textsById(flat, id);
        expect({ s, id, texts: texts.map((t) => t.text) }).toEqual({
          s,
          id,
          texts: e.text === undefined ? [] : [e.text],
        });
      }
      expect(labelTexts(flat)).toHaveLength(Object.values(rows).filter((e) => e.text).length);
    }
  });

  test("[REQ-LBL-8] Ort, waagerecht zentriert, senkrecht mittig; reine Verschiebung und 12 px Schrift bei s = 0,15 / 1 / 20", async () => {
    for (const s of [0.15, 0.4, 1, 1.14, 20]) {
      const scene = await render(TABLE_SCENE, s, true);
      const texts = labelTexts(scene.flat);
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) {
        const id = dataIdOf(scene.flat, t) as string;
        expect(isPureTranslation(t.m), `${id} bei s=${s}: ${t.m.join(",")}`).toBe(true);
        near(fontPx(scene.flat, t), 12, `Schrift ${id} bei s=${s}`);
        expect(verticallyCentered(scene.flat, t), `${id} senkrecht mittig`).toBe(true);
        const at = toScreen(s, midOf(shapeById(scene, id).centerline));
        const p = textAnchor(t);
        near(p.y, at.y, `${id} y bei s=${s}`);
        if (symbolsById(scene.flat, id).length === 0) {
          expect(inherited(scene.flat, t, "text-anchor")).toBe("middle");
          near(p.x, at.x, `${id} x bei s=${s}`);
        }
      }
    }
  });

  test("[REQ-LBL-8] Schalter aus: kein Beschriftungs-Textelement, bei keinem Maßstab", async () => {
    for (const s of [0.15, 0.4, 1.14, 20]) {
      const { flat } = await render(TABLE_SCENE, s, false);
      expect(labelTexts(flat)).toEqual([]);
      // Gegenprobe: an zeigt bei s ≥ 0,4 Texte
      if (s >= 0.4)
        expect(labelTexts((await render(TABLE_SCENE, s, true)).flat).length).toBe(
          4 + (s >= 1 ? 2 : 0),
        );
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-LBL-9: Ebenen und data-id
// ---------------------------------------------------------------------------------------------

describe("Ebenen", () => {
  const LOWER = ["band", "crossway", "querung", "selected"];
  const UPPER = ["target", "hot-port", "start", "end-arrow", "error-mark"];

  test("[REQ-LBL-9] Beschriftungen und Symbole nach Bändern, Querwegen, Querungen und Auswahl, vor allen Marken", async () => {
    const extra: Partial<PlanContentProps> = {
      selectedId: "e5",
      targets: [{ x: 10, y: 20 }],
      hotPorts: [{ x: 30, y: 40 }],
      end: { at: { x: 50, y: 60 }, dir: 0 },
      errorAt: { x: 70, y: 80 },
    };
    const { flat } = await render(ACHT, 1.14, true, extra);
    const lower = flat.filter((n) => classesOf(n).some((c) => LOWER.includes(c)));
    const upper = flat.filter((n) => classesOf(n).some((c) => UPPER.includes(c)));
    // Kanarienvogel: alle Ebenen sind da
    for (const c of [...LOWER, ...UPPER]) {
      expect(
        flat.some((n) => classesOf(n).includes(c)),
        `Klasse ${c}`,
      ).toBe(true);
    }
    const labelNodes = [...labelTexts(flat), ...symbolRoots(flat)];
    const labelSet = new Set(
      labelNodes.flatMap((n) => [n, ...descendants(flat, n)]).map((n) => n.i),
    );
    // 9 Teil-Elemente (ohne Querung) mit Text, das Anschlussstück zusätzlich mit Symbol
    expect(labelTexts(flat).length).toBe(9);
    expect(symbolRoots(flat).length).toBe(1);
    const firstLabel = Math.min(...[...labelSet]);
    const lastLabel = Math.max(...[...labelSet]);
    const lastLower = Math.max(
      ...lower.flatMap((n) => [n, ...descendants(flat, n)]).map((n) => n.i),
    );
    const firstUpper = Math.min(...upper.map((n) => n.i));
    expect(lastLower, "Bänder/Querungen/Auswahl vor den Beschriftungen").toBeLessThan(firstLabel);
    expect(lastLabel, "Beschriftungen vor den Marken").toBeLessThan(firstUpper);
  });

  test("[REQ-LBL-9] jede Beschriftung und jedes Symbol liegt unter data-id ihres Elements; das ausgewählte behält seine", async () => {
    const expected: Readonly<Record<string, string>> = {
      e1: "Kreuzung",
      e2: "Kurve 1/90°",
      e3: "Kurve 1/90°",
      e4: "Kurve 1/90°",
      e5: "Gerade 114",
      e7: "Anschlussstück",
      e8: "Kurve 1/90°",
      e9: "Kurve 1/90°",
      e10: "Kurve 1/90°",
    };
    for (const selectedId of [undefined, "e5", "e7", "e1"]) {
      const { flat } = await render(ACHT, 1.14, true, { selectedId });
      const got = Object.fromEntries(labelTexts(flat).map((t) => [dataIdOf(flat, t), t.text]));
      expect({ selectedId, got }).toEqual({ selectedId, got: expected });
      expect(symbolRoots(flat).map((n) => dataIdOf(flat, n))).toEqual(["e7"]);
      // die Querung e6 trägt keinen Namen
      expect(textsById(flat, "e6")).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-LBL-10: Gesten (Baumteil)
// ---------------------------------------------------------------------------------------------

describe("Gesten", () => {
  test("[REQ-LBL-10] Beschriftungen und Symbole tragen keine eigenen Ereignis-Handler (Tipp, Ziehen und Mausrad bleiben bei der Zeichenfläche)", async () => {
    for (const [elements, s] of [
      [TABLE_SCENE, 1.14],
      [SYMBOL_SCENE, 0.4],
      [ACHT, 1.14],
    ] as const) {
      const { flat } = await render(elements, s, true, { selectedId: elements[0]?.id });
      const nodes = [...labelTexts(flat), ...symbolRoots(flat)];
      expect(nodes.length).toBeGreaterThan(0);
      for (const n of nodes) {
        for (const x of [...selfAndAncestors(flat, n), ...descendants(flat, n)]) {
          const handlers = Object.keys(x.props).filter((k) => /^on/i.test(k));
          expect({ tag: x.tag, handlers }).toEqual({ tag: x.tag, handlers: [] });
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-SYM-2 bis REQ-SYM-5
// ---------------------------------------------------------------------------------------------

describe("Symbole", () => {
  test("[REQ-SYM-2] genau ein Symbol je Symbolteil mit Variante nur Symbol / Symbol + Name, auch bei ausgeschaltetem Schalter; keins bei anderen Teilen", async () => {
    for (const on of [true, false]) {
      for (const s of [0.15, 0.4, 1.14, 20]) {
        const { flat } = await render(SYMBOL_SCENE, s, on);
        for (const el of SYMBOL_SCENE) {
          const count = symbolsById(flat, el.id).length;
          expect({ on, s, id: el.id, count }).toEqual({
            on,
            s,
            id: el.id,
            count: FULL_NAMES[el.id] === undefined ? 0 : 1,
          });
        }
      }
    }
    // unter 16 px Platz: kein Symbol (Rundenzähler 114 mm · 0,14 = 15,96 px)
    const tiny = await render([{ id: "rz", part: "rundenzaehler" }], 0.14, true);
    expect(symbolRoots(tiny.flat)).toEqual([]);
    const enough = await render([{ id: "rz", part: "rundenzaehler" }], 0.1404, true);
    expect(symbolRoots(enough.flat)).toHaveLength(1);
  });

  test("[REQ-SYM-2] Plakette 16 × 16 px ohne Drehung bei jedem s; nur Symbol: mittig auf dem Ort; alle Formen auf der Plakette", async () => {
    for (const s of [0.15, 0.4, 1, 1.14, 20]) {
      const scene = await render(SYMBOL_SCENE, s, false);
      for (const root of symbolRoots(scene.flat)) {
        const id = dataIdOf(scene.flat, root) as string;
        for (const n of [root, ...descendants(scene.flat, root)]) {
          expect(isUnrotated(n.m), `${id} ${n.tag} bei s=${s}: ${n.m.join(",")}`).toBe(true);
        }
        const plate = plateOf(scene.flat, root);
        near(plate.maxX - plate.minX, 16, `${id} Breite bei s=${s}`);
        near(plate.maxY - plate.minY, 16, `${id} Höhe bei s=${s}`);
        const at = toScreen(s, midOf(shapeById(scene, id).centerline));
        near((plate.minX + plate.maxX) / 2, at.x, `${id} Mitte x bei s=${s}`);
        near((plate.minY + plate.maxY) / 2, at.y, `${id} Mitte y bei s=${s}`);
        for (const n of descendants(scene.flat, root)) {
          for (const p of screenPoints(n)) {
            expect(p.x, `${id} ${n.tag} links der Plakette`).toBeGreaterThanOrEqual(
              plate.minX - 0.5,
            );
            expect(p.x, `${id} ${n.tag} rechts der Plakette`).toBeLessThanOrEqual(plate.maxX + 0.5);
            expect(p.y, `${id} ${n.tag} über der Plakette`).toBeGreaterThanOrEqual(
              plate.minY - 0.5,
            );
            expect(p.y, `${id} ${n.tag} unter der Plakette`).toBeLessThanOrEqual(plate.maxY + 0.5);
          }
        }
      }
    }
  });

  test("[REQ-SYM-2] Symbol + Name: Zeile W = 20 + B um den Ort zentriert, Plakette links, Textanfang bei x − W/2 + 20, keine Überlappung", async () => {
    for (const s of [1.14, 20]) {
      const scene = await render(SYMBOL_SCENE, s, true);
      const ids = Object.keys(FULL_NAMES);
      for (const id of ids) {
        const name = FULL_NAMES[id] as string;
        const roots = symbolsById(scene.flat, id);
        const texts = textsById(scene.flat, id);
        // Spurwechselkurve (Sehne 241,8 mm) und alle anderen haben bei s = 1,14 Platz für die Zeile
        expect({ id, s, symbols: roots.length, texts: texts.map((t) => t.text) }).toEqual({
          id,
          s,
          symbols: 1,
          texts: [name],
        });
        const at = toScreen(s, midOf(shapeById(scene, id).centerline));
        const W = 20 + B(name);
        const plate = plateOf(scene.flat, roots[0] as Flat);
        near(plate.minX, at.x - W / 2, `${id} Plakette links bei s=${s}`);
        near(plate.maxX, at.x - W / 2 + 16, `${id} Plakette rechts bei s=${s}`);
        near((plate.minY + plate.maxY) / 2, at.y, `${id} Plakette Mitte y bei s=${s}`);
        const t = texts[0] as Flat;
        const anchor = inherited(scene.flat, t, "text-anchor");
        expect(
          anchor === undefined || anchor === "start",
          `${id} text-anchor ${String(anchor)}`,
        ).toBe(true);
        const p = textAnchor(t);
        near(p.x, at.x - W / 2 + 20, `${id} Textanfang bei s=${s}`);
        near(p.y, at.y, `${id} Text y bei s=${s}`);
        expect(plate.maxX).toBeLessThanOrEqual(p.x);
        expect(isPureTranslation(t.m)).toBe(true);
        near(fontPx(scene.flat, t), 12, `${id} Schrift bei s=${s}`);
      }
    }
  });

  test("[REQ-SYM-3] die vier Symbole unterscheiden sich in der Form (Geometrie ohne Farbe); beide Spurwechsel haben dasselbe Zeichen", async () => {
    for (const s of [0.4, 1.14]) {
      const scene = await render(SYMBOL_SCENE, s, false);
      type Sig = ReadonlyArray<readonly [string, ReadonlyArray<ScreenPoint>]>;
      /** Geometrie relativ zur Plakette, ohne Farben, Klassen und title. */
      const signature = (id: string): Sig => {
        const root = symbolsById(scene.flat, id)[0];
        if (root === undefined) throw new Error(`kein Symbol für ${id}`);
        const plate = plateOf(scene.flat, root);
        return [root, ...descendants(scene.flat, root)]
          .filter((n) => n.tag !== "title")
          .map(
            (n) =>
              [
                n.tag,
                screenPoints(n).map((p) => ({ x: p.x - plate.minX, y: p.y - plate.minY })),
              ] as const,
          )
          .filter(([, pts]) => pts.length > 0);
      };
      const same = (a: Sig, b: Sig): boolean =>
        a.length === b.length &&
        a.every(([tag, pts], k) => {
          const [tagB, ptsB] = b[k] as Sig[number];
          return (
            tag === tagB &&
            pts.length === ptsB.length &&
            pts.every(
              (p, j) =>
                Math.abs(p.x - (ptsB[j] as ScreenPoint).x) < 0.01 &&
                Math.abs(p.y - (ptsB[j] as ScreenPoint).y) < 0.01,
            )
          );
        });
      const sig: ReadonlyArray<readonly [string, Sig]> = [
        ["zielflagge", signature("rz")],
        ["stecker", signature("as")],
        ["spurwechsel", signature("swg")],
        ["engstelle", signature("en")],
      ];
      expect(same(signature("swk"), signature("swg")), "beide Spurwechsel gleich").toBe(true);
      for (const [i, [kindA, a]] of sig.entries()) {
        // mehr als nur die Plakette
        expect(a.length, kindA).toBeGreaterThan(1);
        for (const [kindB, b] of sig.slice(i + 1)) {
          expect(same(a, b), `${kindA} und ${kindB} haben dieselbe Form`).toBe(false);
        }
      }
    }
  });

  test("[REQ-SYM-4] jedes Symbol trägt genau ein title mit dem vollen Namen, auch wenn der Schalter aus ist oder der Name nicht passt", async () => {
    for (const on of [true, false]) {
      for (const s of [0.15, 0.4, 1.14]) {
        const { flat } = await render(SYMBOL_SCENE, s, on);
        for (const [id, name] of Object.entries(FULL_NAMES)) {
          const root = symbolsById(flat, id)[0];
          expect(root, `${id} bei s=${s}, an=${on}`).toBeDefined();
          const titles = descendants(flat, root as Flat).filter((n) => n.tag === "title");
          expect({ id, s, on, titles: titles.map((t) => t.text) }).toEqual({
            id,
            s,
            on,
            titles: [name],
          });
        }
      }
    }
  });

  test("[REQ-SYM-5] Symbole im Code gezeichnet: kein image, kein foreignObject, keine externen Verweise, kein Netzaufruf beim Zeichnen", async () => {
    const saved = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (() => {
      fetches++;
      throw new Error("REQ-SYM-5: Netzaufruf beim Zeichnen");
    }) as typeof fetch;
    try {
      for (const on of [true, false]) {
        for (const s of [0.15, 1.14, 20]) {
          const { flat } = await render(SYMBOL_SCENE, s, on);
          expect(symbolRoots(flat).length).toBe(5);
          for (const n of flat) {
            expect(["image", "foreignObject", "foreignobject", "iframe", "img"]).not.toContain(
              n.tag,
            );
            for (const [k, v] of Object.entries(n.props)) {
              if (typeof v !== "string") continue;
              if (/^(href|xlink:href|xlinkHref|src)$/.test(k)) {
                expect(v.startsWith("#"), `${n.tag} ${k}=${v}`).toBe(true);
              }
              for (const m of v.matchAll(/url\(\s*['"]?([^'")]*)/g)) {
                expect((m[1] ?? "").startsWith("#"), `${n.tag} ${k}=${v}`).toBe(true);
              }
              expect(v, `${n.tag} ${k}`).not.toMatch(
                /^(https?:|data:|blob:)|\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i,
              );
            }
          }
        }
      }
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = saved;
    }
  });
});

describe("Nachtrag #1: Wireless-Anschluss im Plan", () => {
  test.skip("[REQ-SYM-1] [REQ-SYM-4] Wireless-Anschluss zeigt im SVG genau ein Symbol mit derselben Form wie der Stecker des Anschlussstücks und dem title „Wireless-Anschluss“", async () => {
    const elements: Elements = [
      { id: "as", part: "anschlussstueck" },
      { id: "w", part: "wireless-anschluss" },
      { id: "rz", part: "rundenzaehler" },
    ];
    for (const on of [true, false]) {
      for (const s of [0.4, 1.14, 20]) {
        const scene = await render(elements, s, on);
        expect(scene.shapes).toHaveLength(3);
        const roots = symbolsById(scene.flat, "w");
        expect({ on, s, count: roots.length }).toEqual({ on, s, count: 1 });
        const root = roots[0] as Flat;
        const titles = descendants(scene.flat, root).filter((n) => n.tag === "title");
        expect(titles.map((t) => t.text)).toEqual(["Wireless-Anschluss"]);
        /** Geometrie relativ zur Plakette, ohne Farben, Klassen und title. */
        const signature = (id: string): string => {
          const r = symbolsById(scene.flat, id)[0] as Flat;
          const plate = plateOf(scene.flat, r);
          return JSON.stringify(
            [r, ...descendants(scene.flat, r)]
              .filter((n) => n.tag !== "title")
              .map((n) => [
                n.tag,
                screenPoints(n).map((p) => [
                  Math.round((p.x - plate.minX) * 100) / 100,
                  Math.round((p.y - plate.minY) * 100) / 100,
                ]),
              ])
              .filter(([, pts]) => (pts as unknown[]).length > 0),
          );
        };
        expect(signature("w"), `Stecker bei s=${s}`).toBe(signature("as"));
        expect(signature("w"), `nicht die Zielflagge bei s=${s}`).not.toBe(signature("rz"));
      }
    }
  });
});
