/**
 * Spec M1 (.specify/specs/m1-rechenkern/spec.md): Rechenkern, Abnahmetests REQ-CORE-* und REQ-ARCH-2.
 *
 * Öffentliche API, an die sich die Implementierung hält (von spec-to-tests gewählt, wo die Spec die
 * Signatur offen lässt; Begründung je Punkt):
 *
 * - Exportiert aus `src/core/index.ts`:
 *     trace(catalog, elements, start): TraceResult
 *     closure(catalog, elements, start): ClosureResult
 *     consumption(catalog, elements): ConsumptionResult
 *   Der Katalog ist Argument (reine Funktion ohne versteckte Abhängigkeit; die Tests übergeben den
 *   Katalog aus `src/catalog`). `elements` ist die Elementliste eines Layouts (das Feld `elements`
 *   des Schema-Layouts); die Schema-Version interessiert den Kern nicht. Die Startpose ist Argument
 *   (Spec: „Die Startpose gehört nicht zum Layout“).
 * - Zahl a + b·√2: { a: Rational, b: Rational }, Rational = { num: bigint, den: bigint }.
 *   bigint, weil die Spec ganzzahligen Zähler/Nenner und große Verschiebungen ohne
 *   Genauigkeitsverlust fordert (REQ-CORE-8, REQ-ARCH-2). Die Tests normalisieren die gelieferten
 *   Brüche selbst (Nenner ≠ 0, Vorzeichen, ggT) und vergleichen dann exakt; eine bestimmte
 *   Normalform wird also nicht verlangt, wohl aber bigint für Zähler und Nenner.
 * - Pose: { x, y, dir }, dir ∈ {0..7} (Stufen zu 45°, 0 = +x, 2 = +y, links = gegen den
 *   Uhrzeigersinn).
 * - Layout-Element: Teil-Element { id, part, turn? } mit turn ∈ "links" | "rechts", oder Querung
 *   { id, crosses } (crosses = Element-ID der Kreuzung). Unterschieden wird strukturell (Feld
 *   `crosses` vorhanden), passend zum Schema („Querung: Verweis, sonst nichts“).
 * - Katalog-IDs (stabil, aus der Tabelle „Katalog M1“): gerade-342, gerade-171, gerade-114,
 *   kurve-1-90, kurve-1-45, kurve-2-45, kurve-3-45, spurwechselkurve, spurwechsel-gerade, engstelle,
 *   kreuzung, anschlussstueck, rundenzaehler, wireless-anschluss, steilkurve-1-45, looping-teil,
 *   steilkehre-teil, looping, steilkehre.
 * - TraceResult: { ok: true, steps, end } | { ok: false, errors }. steps[i] = { pose } ist die
 *   Ausgangspose nach Element i; nur bei einer Kreuzung (Teil-Element) zusätzlich
 *   crossPorts = { left, right } (die Queranschlüsse aus REQ-CORE-23). end = Pose nach dem letzten
 *   Element, beim leeren Layout die Startpose. Bei Fehlern gibt es kein Teilergebnis.
 * - Index = Stelle in der Folge, 0-basiert (Tabelle „Acht“ Nr. n ↔ index n − 1).
 * - Fehlerarten (kind), alle als Rückgabewert, nie geworfen:
 *     unbekanntesTeil { index, partId }            REQ-CORE-16
 *     nichtPlatzierbar { index, partId }           REQ-CORE-17
 *     richtungFehlt { index, partId }              REQ-CORE-18 (Kurve ohne turn)
 *     richtungUeberzaehlig { index, partId }       REQ-CORE-18 (Nicht-Kurve mit turn)
 *     ungueltigerVerweis { index, id, ref }        REQ-CORE-25
 *     bereitsGequert { index, id, ref }            REQ-CORE-26
 *     ankunftNichtAmQueranschluss { index, id, ref, arrival }  REQ-CORE-27
 *     doppelteElementId { id, indices }            REQ-CORE-29 (indices aufsteigend)
 *   „Richtung fehlt“ und „Richtung überzählig“ sind nach REQ-CORE-18 zwei getrennte Arten.
 *   Ein Element mit einem dieser Fehler (außer dem Ankunftsfehler selbst) ist „fehlerhaft“
 *   (REQ-CORE-28); bei doppelter ID alle Elemente mit dieser ID. Ab dem ersten fehlerhaften
 *   Element wird keine Ankunft mehr beurteilt; eine zweite Querung derselben Kreuzung meldet nur
 *   bereitsGequert (REQ-CORE-26).
 *   Die Reihenfolge der Fehler in der Liste ist frei; die Tests sortieren.
 * - ClosureResult: { ok: true, closure } | { ok: false, errors } (errors wie bei trace).
 *   closure: { status: "leer" }
 *          | { status: "geschlossen", offset: { dx, dy } (beide 0), angleSteps: 0 }
 *          | { status: "offen", offset: { dx, dy }, angleSteps }
 *   offset = Start − Ende (Versatz vom Ende zum Start), angleSteps = Winkel Start − Ende in
 *   45°-Stufen, Bereich −3 … 4 (entspricht (−180°, 180°]).
 * - ConsumptionResult: { ok: true, counts } | { ok: false, errors: unbekanntesTeil[] }.
 *   counts: Record<Katalog-ID, Anzahl> mit genau den Einträgen, deren Anzahl ≥ 1 ist (keine Nullen,
 *   keine Baugruppen-Schlüssel).
 * - Platzierbar heißt: Geometrie gerade, kurve oder kreuzung (kein eigenes Feld im Katalog).
 *
 * Der Kern-Import ist ein Namensraum-Import mit Typ-Zusicherung (CoreApi), weil `src/core/index.ts`
 * heute nur ein Platzhalter ist. So typchecken die Tests jetzt schon; die Implementierung muss die
 * drei Funktionen mit genau dieser Wirkung aus `src/core/index.ts` exportieren.
 *
 * Die Geometrie-Orakel unten (refTrace, Drehung, Spiegelung) rechnen unabhängig vom Katalog aus den
 * Zahlen der Spec, damit eine Verfälschung im Katalog nicht Orakel und Prüfling gleich verschiebt.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import * as catalogModule from "../catalog/index.js";
import * as coreModule from "./index.js";

// ---------------------------------------------------------------------------------------------
// Vertragstypen (aus der Spec)
// ---------------------------------------------------------------------------------------------

type Rational = { readonly num: bigint; readonly den: bigint };
type Coord = { readonly a: Rational; readonly b: Rational };
type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Pose = { readonly x: Coord; readonly y: Coord; readonly dir: Dir };
type Turn = "links" | "rechts";
type PartElement = { readonly id: string; readonly part: string; readonly turn?: Turn };
type CrossingElement = { readonly id: string; readonly crosses: string };
type LayoutElement = PartElement | CrossingElement;

type Certainty = "hoch" | "mittel" | "niedrig";
type Geometry =
  | { readonly kind: "gerade"; readonly length: number }
  | { readonly kind: "kurve"; readonly radius: number; readonly angle: 45 | 90 }
  | { readonly kind: "kreuzung"; readonly length: number; readonly crossLength: number }
  | { readonly kind: "masseFehlen" }
  | {
      readonly kind: "baugruppe";
      readonly parts: ReadonlyArray<{ readonly part: string; readonly count: number }>;
    };
type CatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly articleNumbers: ReadonlyArray<string> | "keineEigene";
  readonly source: string;
  readonly certainty: Certainty;
  readonly geometry: Geometry;
};

type CrossPorts = { readonly left: Pose; readonly right: Pose };
type Step = { readonly pose: Pose; readonly crossPorts?: CrossPorts };

type TraceError =
  | { readonly kind: "unbekanntesTeil"; readonly index: number; readonly partId: string }
  | { readonly kind: "nichtPlatzierbar"; readonly index: number; readonly partId: string }
  | { readonly kind: "richtungFehlt"; readonly index: number; readonly partId: string }
  | { readonly kind: "richtungUeberzaehlig"; readonly index: number; readonly partId: string }
  | {
      readonly kind: "ungueltigerVerweis";
      readonly index: number;
      readonly id: string;
      readonly ref: string;
    }
  | {
      readonly kind: "bereitsGequert";
      readonly index: number;
      readonly id: string;
      readonly ref: string;
    }
  | {
      readonly kind: "ankunftNichtAmQueranschluss";
      readonly index: number;
      readonly id: string;
      readonly ref: string;
      readonly arrival: Pose;
    }
  | {
      readonly kind: "doppelteElementId";
      readonly id: string;
      readonly indices: ReadonlyArray<number>;
    };

type TraceResult =
  | { readonly ok: true; readonly steps: ReadonlyArray<Step>; readonly end: Pose }
  | { readonly ok: false; readonly errors: ReadonlyArray<TraceError> };

type Offset = { readonly dx: Coord; readonly dy: Coord };
type Closure =
  | { readonly status: "leer" }
  | { readonly status: "geschlossen"; readonly offset: Offset; readonly angleSteps: number }
  | { readonly status: "offen"; readonly offset: Offset; readonly angleSteps: number };
type ClosureResult =
  | { readonly ok: true; readonly closure: Closure }
  | { readonly ok: false; readonly errors: ReadonlyArray<TraceError> };

type ConsumptionError = {
  readonly kind: "unbekanntesTeil";
  readonly index: number;
  readonly partId: string;
};
type ConsumptionResult =
  | { readonly ok: true; readonly counts: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly errors: ReadonlyArray<ConsumptionError> };

interface CoreApi {
  trace(
    catalog: ReadonlyArray<CatalogEntry>,
    elements: ReadonlyArray<LayoutElement>,
    start: Pose,
  ): TraceResult;
  closure(
    catalog: ReadonlyArray<CatalogEntry>,
    elements: ReadonlyArray<LayoutElement>,
    start: Pose,
  ): ClosureResult;
  consumption(
    catalog: ReadonlyArray<CatalogEntry>,
    elements: ReadonlyArray<LayoutElement>,
  ): ConsumptionResult;
}

const core = coreModule as unknown as CoreApi;
const catalogApi = catalogModule as unknown as { readonly CATALOG: ReadonlyArray<CatalogEntry> };
const cat = (): ReadonlyArray<CatalogEntry> => catalogApi.CATALOG;

// ---------------------------------------------------------------------------------------------
// Exakte Arithmetik im Test (Orakel): Q(√2) mit bigint-Brüchen
// ---------------------------------------------------------------------------------------------

const abs = (v: bigint): bigint => (v < 0n ? -v : v);
const gcd = (p: bigint, q: bigint): bigint => {
  let x = abs(p);
  let y = abs(q);
  while (y !== 0n) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
};

/** Normalisiert einen Bruch; wirft, wenn der Kern keine bigint-Brüche liefert. */
const normQ = (q: Rational): Rational => {
  if (typeof q.num !== "bigint" || typeof q.den !== "bigint") {
    throw new Error(`Bruch nicht aus bigint: ${String(q.num)}/${String(q.den)}`);
  }
  if (q.den === 0n) throw new Error("Nenner 0");
  const sign = q.den < 0n ? -1n : 1n;
  const num = q.num * sign;
  const den = q.den * sign;
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
};
const Q = (num: bigint, den = 1n): Rational => normQ({ num, den });
const qAdd = (p: Rational, q: Rational): Rational =>
  Q(p.num * q.den + q.num * p.den, p.den * q.den);
const qNeg = (p: Rational): Rational => Q(-p.num, p.den);
const qHalf = (p: Rational): Rational => Q(p.num, p.den * 2n);

type Frac = number | readonly [number, number];
const frac = (f: Frac): Rational =>
  typeof f === "number" ? Q(BigInt(f)) : Q(BigInt(f[0]), BigInt(f[1]));
/** C(a, b) = a + b·√2 mm */
const C = (a: Frac, b: Frac = 0): Coord => ({ a: frac(a), b: frac(b) });
const ZERO: Coord = C(0);
const normC = (c: Coord): Coord => ({ a: normQ(c.a), b: normQ(c.b) });
const cAdd = (p: Coord, q: Coord): Coord => ({ a: qAdd(p.a, q.a), b: qAdd(p.b, q.b) });
const cNeg = (p: Coord): Coord => ({ a: qNeg(p.a), b: qNeg(p.b) });
const cSub = (p: Coord, q: Coord): Coord => cAdd(p, cNeg(q));
/** (a + b√2)·√2/2 = b + (a/2)·√2 */
const cHalfSqrt2 = (p: Coord): Coord => ({ a: p.b, b: qHalf(p.a) });

const mod8 = (k: number): Dir => (((k % 8) + 8) % 8) as Dir;
const P = (x: Coord | Frac, y: Coord | Frac, dir: number): Pose => ({
  x: typeof x === "object" && !Array.isArray(x) ? (x as Coord) : C(x as Frac),
  y: typeof y === "object" && !Array.isArray(y) ? (y as Coord) : C(y as Frac),
  dir: mod8(dir),
});

type Vec = { readonly x: Coord; readonly y: Coord };
const rot45 = (v: Vec): Vec => ({
  x: cHalfSqrt2(cSub(v.x, v.y)),
  y: cHalfSqrt2(cAdd(v.x, v.y)),
});
const rot = (v: Vec, steps: number): Vec => {
  let r = v;
  for (let i = 0; i < mod8(steps); i++) r = rot45(r);
  return r;
};
/** R·e(j): Vektor der Länge R in Richtung j */
const unit = (length: number, j: number): Vec => rot({ x: C(length), y: ZERO }, j);
const moveBy = (p: Pose, v: Vec, dir: number = p.dir): Pose => ({
  x: cAdd(p.x, v.x),
  y: cAdd(p.y, v.y),
  dir: mod8(dir),
});

const normPose = (p: Pose): Pose => ({ x: normC(p.x), y: normC(p.y), dir: p.dir });
const normStep = (s: Step): Step =>
  s.crossPorts === undefined
    ? { pose: normPose(s.pose) }
    : {
        pose: normPose(s.pose),
        crossPorts: { left: normPose(s.crossPorts.left), right: normPose(s.crossPorts.right) },
      };
const errKey = (e: TraceError): number => ("index" in e ? e.index : (e.indices[0] ?? -1));
const normErrors = (errors: ReadonlyArray<TraceError>): TraceError[] =>
  errors
    .map((e) =>
      e.kind === "ankunftNichtAmQueranschluss" ? { ...e, arrival: normPose(e.arrival) } : e,
    )
    .sort((p, q) => errKey(p) - errKey(q) || p.kind.localeCompare(q.kind));
const normTrace = (r: TraceResult): TraceResult =>
  r.ok
    ? { ok: true, steps: r.steps.map(normStep), end: normPose(r.end) }
    : { ok: false, errors: normErrors(r.errors) };
const normClosure = (r: ClosureResult): ClosureResult => {
  if (!r.ok) return { ok: false, errors: normErrors(r.errors) };
  const c = r.closure;
  if (c.status === "leer") return r;
  return {
    ok: true,
    closure: {
      status: c.status,
      offset: { dx: normC(c.offset.dx), dy: normC(c.offset.dy) },
      angleSteps: c.angleSteps,
    },
  };
};

const runTrace = (elements: ReadonlyArray<LayoutElement>, start: Pose): TraceResult =>
  normTrace(core.trace(cat(), elements, start));
const runClosure = (elements: ReadonlyArray<LayoutElement>, start: Pose): ClosureResult =>
  normClosure(core.closure(cat(), elements, start));

/** Erwartet ein gültiges Ergebnis und liefert es typisiert. */
const okTrace = (r: TraceResult): { steps: ReadonlyArray<Step>; end: Pose } => {
  if (!r.ok) throw new Error(`Verfolgung meldet Fehler: ${JSON.stringify(r.errors, bigintJson)}`);
  return r;
};
const bigintJson = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? `${v}n` : v);
const at = <T>(xs: ReadonlyArray<T>, i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`Index ${i} fehlt`);
  return v;
};

const ORIGIN: Pose = P(0, 0, 0);
const closedAt0 = (): ClosureResult => ({
  ok: true,
  closure: { status: "geschlossen", offset: { dx: ZERO, dy: ZERO }, angleSteps: 0 },
});
const open = (dx: Coord, dy: Coord, angleSteps: number): ClosureResult => ({
  ok: true,
  closure: { status: "offen", offset: { dx, dy }, angleSteps },
});

// ---------------------------------------------------------------------------------------------
// Unabhängiges Geometrie-Orakel aus der Spec (Mittellinie)
// ---------------------------------------------------------------------------------------------

type RefGeom =
  | { readonly kind: "gerade"; readonly length: number }
  | { readonly kind: "kurve"; readonly radius: number; readonly steps: number };
const REF_GEOMETRY: Readonly<Record<string, RefGeom>> = {
  "gerade-342": { kind: "gerade", length: 342 },
  "gerade-171": { kind: "gerade", length: 171 },
  "gerade-114": { kind: "gerade", length: 114 },
  "kurve-1-90": { kind: "kurve", radius: 171, steps: 2 },
  "kurve-1-45": { kind: "kurve", radius: 171, steps: 1 },
  "kurve-2-45": { kind: "kurve", radius: 285, steps: 1 },
  "kurve-3-45": { kind: "kurve", radius: 399, steps: 1 },
  spurwechselkurve: { kind: "kurve", radius: 171, steps: 2 },
  "spurwechsel-gerade": { kind: "gerade", length: 228 },
  engstelle: { kind: "gerade", length: 228 },
  kreuzung: { kind: "gerade", length: 342 },
  anschlussstueck: { kind: "gerade", length: 114 },
  rundenzaehler: { kind: "gerade", length: 114 },
};
const STRAIGHT_IDS = [
  "gerade-342",
  "gerade-171",
  "gerade-114",
  "spurwechsel-gerade",
  "engstelle",
  "anschlussstueck",
  "rundenzaehler",
  "kreuzung",
] as const;
const CURVE_IDS = [
  "kurve-1-90",
  "kurve-1-45",
  "kurve-2-45",
  "kurve-3-45",
  "spurwechselkurve",
] as const;
const NON_PLACEABLE_IDS = [
  "wireless-anschluss",
  "steilkurve-1-45",
  "looping-teil",
  "steilkehre-teil",
  "looping",
  "steilkehre",
] as const;

const refGeom = (part: string): RefGeom => {
  const g = REF_GEOMETRY[part];
  if (g === undefined) throw new Error(`keine Referenzgeometrie für ${part}`);
  return g;
};

/** Eine Kurve: Mittelpunkt R in Drehrichtung neben dem Eingang, Bogen um `steps` Stufen. */
const refStep = (p: Pose, el: PartElement): Pose => {
  const g = refGeom(el.part);
  if (g.kind === "gerade") return moveBy(p, unit(g.length, p.dir));
  const s = el.turn === "links" ? 1 : -1;
  const center = moveBy(p, unit(g.radius, p.dir + 2 * s));
  return moveBy(center, unit(g.radius, p.dir - 2 * s + s * g.steps), p.dir + s * g.steps);
};
const refPoses = (elements: ReadonlyArray<PartElement>, start: Pose): Pose[] => {
  const out: Pose[] = [];
  let p = start;
  for (const el of elements) {
    p = refStep(p, el);
    out.push(normPose(p));
  }
  return out;
};
/** Queranschlüsse nach „Begriffe“: links p+171e(k)+57e(k+2), Richtung k+6; rechts …e(k+6), k+2. */
const refCrossPorts = (p: Pose): CrossPorts => {
  const mid = moveBy(p, unit(171, p.dir));
  return {
    left: normPose(moveBy(mid, unit(57, p.dir + 2), p.dir + 6)),
    right: normPose(moveBy(mid, unit(57, p.dir + 6), p.dir + 2)),
  };
};

// Starre Bewegungen für REQ-CORE-8 und Spiegelung für REQ-CORE-9
const transformPose = (p: Pose, m: number, t: Vec): Pose => {
  const r = rot({ x: p.x, y: p.y }, m);
  return normPose({ x: cAdd(r.x, t.x), y: cAdd(r.y, t.y), dir: mod8(p.dir + m) });
};
const transformStep = (s: Step, m: number, t: Vec): Step =>
  s.crossPorts === undefined
    ? { pose: transformPose(s.pose, m, t) }
    : {
        pose: transformPose(s.pose, m, t),
        crossPorts: {
          left: transformPose(s.crossPorts.left, m, t),
          right: transformPose(s.crossPorts.right, m, t),
        },
      };
/** Spiegelung an der Geraden durch die Startposition in Startrichtung ks. */
const mirrorPose = (p: Pose, axis: Pose): Pose => {
  const qx = cSub(p.x, axis.x);
  const qy = cSub(p.y, axis.y);
  // Spiegelmatrix [[cos 2θ, sin 2θ], [sin 2θ, −cos 2θ]] mit 2θ = ks·90°: Einträge in {0, ±1}
  const variant = mod8(axis.dir) % 4;
  const [mx, my] =
    variant === 0
      ? [qx, cNeg(qy)]
      : variant === 1
        ? [qy, qx]
        : variant === 2
          ? [cNeg(qx), qy]
          : [cNeg(qy), cNeg(qx)];
  return normPose({ x: cAdd(axis.x, mx), y: cAdd(axis.y, my), dir: mod8(2 * axis.dir - p.dir) });
};
const mirrorStep = (s: Step, axis: Pose): Step =>
  s.crossPorts === undefined
    ? { pose: mirrorPose(s.pose, axis) }
    : {
        pose: mirrorPose(s.pose, axis),
        crossPorts: {
          left: mirrorPose(s.crossPorts.right, axis),
          right: mirrorPose(s.crossPorts.left, axis),
        },
      };

// ---------------------------------------------------------------------------------------------
// Layout-Bausteine und Generatoren
// ---------------------------------------------------------------------------------------------

const part = (id: string, partId: string, turn?: Turn): PartElement =>
  turn === undefined ? { id, part: partId } : { id, part: partId, turn };
const crossing = (id: string, ref: string): CrossingElement => ({ id, crosses: ref });
const isCrossing = (el: LayoutElement): el is CrossingElement => "crosses" in el;
const other = (t: Turn): Turn => (t === "links" ? "rechts" : "links");
const flipTurns = (els: ReadonlyArray<LayoutElement>): LayoutElement[] =>
  els.map((el) =>
    isCrossing(el) || el.turn === undefined ? el : part(el.id, el.part, other(el.turn)),
  );
/** Vergibt eindeutige IDs mit Präfix an eine Folge von Teilen (ohne Querungen). */
const ids = (prefix: string, parts: ReadonlyArray<Omit<PartElement, "id">>): PartElement[] =>
  parts.map((p, i) => part(`${prefix}${i}`, p.part, p.turn));
const repeat = (n: number, partId: string, turn?: Turn): Array<Omit<PartElement, "id">> =>
  Array.from({ length: n }, () => (turn === undefined ? { part: partId } : { part: partId, turn }));

/** Die Acht aus der Tabelle der Spec (Startpose (0, 0, 0)). */
const ACHT: ReadonlyArray<LayoutElement> = [
  part("e1", "kreuzung"),
  part("e2", "kurve-1-90", "rechts"),
  part("e3", "kurve-1-90", "rechts"),
  part("e4", "kurve-1-90", "rechts"),
  part("e5", "gerade-114"),
  crossing("e6", "e1"),
  part("e7", "anschlussstueck"),
  part("e8", "kurve-1-90", "links"),
  part("e9", "kurve-1-90", "links"),
  part("e10", "kurve-1-90", "links"),
];
const ACHT_POSES: ReadonlyArray<Pose> = [
  P(342, 0, 0),
  P(513, -171, 6),
  P(342, -342, 4),
  P(171, -171, 2),
  P(171, -57, 2),
  P(171, 57, 2),
  P(171, 171, 2),
  P(0, 342, 4),
  P(-171, 171, 6),
  P(0, 0, 0),
];
const ACHT_MIRRORED_POSES: ReadonlyArray<Pose> = [
  P(342, 0, 0),
  P(513, 171, 2),
  P(342, 342, 4),
  P(171, 171, 6),
  P(171, 57, 6),
  P(171, -57, 6),
  P(171, -171, 6),
  P(0, -342, 4),
  P(-171, -171, 2),
  P(0, 0, 0),
];
const replaceAt = (
  els: ReadonlyArray<LayoutElement>,
  index: number,
  ...replacement: LayoutElement[]
): LayoutElement[] => [...els.slice(0, index), ...replacement, ...els.slice(index + 1)];

const arbTurn: fc.Arbitrary<Turn> = fc.constantFrom<Turn>("links", "rechts");
const arbDir: fc.Arbitrary<Dir> = fc.constantFrom<Dir>(0, 1, 2, 3, 4, 5, 6, 7);
const arbPlaceable: fc.Arbitrary<Omit<PartElement, "id">> = fc.oneof(
  fc.constantFrom(...STRAIGHT_IDS).map((p) => ({ part: p })),
  fc.tuple(fc.constantFrom(...CURVE_IDS), arbTurn).map(([p, turn]) => ({ part: p, turn })),
);
const arbParts = (prefix: string, maxLength = 12): fc.Arbitrary<PartElement[]> =>
  fc.array(arbPlaceable, { maxLength }).map((ps) => ids(prefix, ps));
/** Koordinate auf dem darstellbaren Raster: a und b ganzzahlige Vielfache von 57/2. */
const arbRasterCoord = (bound: bigint): fc.Arbitrary<Coord> =>
  fc
    .tuple(fc.bigInt(-bound, bound), fc.bigInt(-bound, bound))
    .map(([ka, kb]) => ({ a: Q(ka * 57n, 2n), b: Q(kb * 57n, 2n) }));
const arbStart = (bound = 1_000_000n): fc.Arbitrary<Pose> =>
  fc.record({ x: arbRasterCoord(bound), y: arbRasterCoord(bound), dir: arbDir });
const arbVec = (bound: bigint): fc.Arbitrary<Vec> =>
  fc.record({ x: arbRasterCoord(bound), y: arbRasterCoord(bound) });

// ---------------------------------------------------------------------------------------------
// Kern: Lage berechnen
// ---------------------------------------------------------------------------------------------

describe("Kern: Lage berechnen", () => {
  test("[REQ-CORE-1] liefert die Pose nach jedem Element und die Endpose exakt (Beispiel)", () => {
    const layout = [
      part("a", "gerade-342"),
      part("b", "kurve-1-90", "links"),
      part("c", "kurve-1-45", "rechts"),
    ];
    const r = okTrace(runTrace(layout, ORIGIN));
    expect(r.steps.map((s) => s.pose)).toEqual([
      P(342, 0, 0),
      P(513, 171, 2),
      P(C(684, [-171, 2]), C(171, [171, 2]), 1),
    ]);
    expect(r.end).toEqual(P(C(684, [-171, 2]), C(171, [171, 2]), 1));
    expect(r.steps.every((s) => s.crossPorts === undefined)).toBe(true);
  });

  test("[REQ-CORE-1] Spur stimmt für beliebige Layouts und Startposen mit dem Orakel überein", () => {
    fc.assert(
      fc.property(arbParts("p", 20), arbStart(), (layout, start) => {
        const r = okTrace(runTrace(layout, start));
        const expected = refPoses(layout, start);
        expect(r.steps.map((s) => s.pose)).toEqual(expected);
        expect(r.end).toEqual(
          expected.length === 0 ? normPose(start) : at(expected, -1 + expected.length),
        );
        layout.forEach((el, i) => {
          const s = at(r.steps, i);
          if (el.part === "kreuzung") {
            const entry = i === 0 ? start : at(expected, i - 1);
            expect(s.crossPorts).toEqual(refCrossPorts(entry));
          } else {
            expect(s.crossPorts).toBeUndefined();
          }
        });
      }),
    );
  });

  test("[REQ-CORE-1] Zähler und Nenner der gelieferten Koordinaten sind bigint", () => {
    const raw = core.trace(cat(), [part("a", "kurve-1-45", "links")], ORIGIN);
    if (!raw.ok) throw new Error("unerwarteter Fehler");
    const pose = at(raw.steps, 0).pose;
    for (const c of [pose.x, pose.y, raw.end.x, raw.end.y]) {
      for (const q of [c.a, c.b]) {
        expect(typeof q.num).toBe("bigint");
        expect(typeof q.den).toBe("bigint");
        expect(q.den).not.toBe(0n);
      }
    }
  });

  test("[REQ-CORE-2] Gerade 342 aus (0, 0, k = 1) endet bei (171·√2, 171·√2, k = 1)", () => {
    const r = okTrace(runTrace([part("a", "gerade-342")], P(0, 0, 1)));
    expect(r.end).toEqual(P(C(0, 171), C(0, 171), 1));
  });

  test("[REQ-CORE-2] jede Gerade verschiebt um ihre Länge in Fahrtrichtung, Richtung bleibt", () => {
    const lengths: Record<string, number> = {
      "gerade-342": 342,
      "gerade-171": 171,
      "gerade-114": 114,
      "spurwechsel-gerade": 228,
      engstelle: 228,
      anschlussstueck: 114,
      rundenzaehler: 114,
    };
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(lengths)), arbStart(), (partId, start) => {
        const r = okTrace(runTrace([part("a", partId)], start));
        const expected = normPose(moveBy(start, unit(lengths[partId] ?? Number.NaN, start.dir)));
        expect(r.end).toEqual(expected);
        expect(r.end.dir).toBe(start.dir);
      }),
    );
  });

  test("[REQ-CORE-3] Kurve 1/90° aus (0, 0, 0): links (171, 171, 2), rechts (171, −171, 6)", () => {
    expect(okTrace(runTrace([part("a", "kurve-1-90", "links")], ORIGIN)).end).toEqual(
      P(171, 171, 2),
    );
    expect(okTrace(runTrace([part("a", "kurve-1-90", "rechts")], ORIGIN)).end).toEqual(
      P(171, -171, 6),
    );
  });

  test("[REQ-CORE-4] Kurven 1/45°, 2/45°, 3/45° aus (0, 0, 0) mit R = 171, 285, 399", () => {
    for (const [partId, r] of [
      ["kurve-1-45", 171],
      ["kurve-2-45", 285],
      ["kurve-3-45", 399],
    ] as const) {
      expect(okTrace(runTrace([part("a", partId, "links")], ORIGIN)).end).toEqual(
        P(C(0, [r, 2]), C(r, [-r, 2]), 1),
      );
      expect(okTrace(runTrace([part("a", partId, "rechts")], ORIGIN)).end).toEqual(
        P(C(0, [r, 2]), C(-r, [r, 2]), 7),
      );
    }
  });

  test("[REQ-CORE-4] Kurve 1/45° links endet bei (171/2·√2, 171 − 171/2·√2, k = 1)", () => {
    const r = okTrace(runTrace([part("a", "kurve-1-45", "links")], ORIGIN));
    expect(r.end).toEqual({ x: C(0, [171, 2]), y: C(171, [-171, 2]), dir: 1 });
  });

  test("[REQ-CORE-5] zwei Kurven 1/90° gleicher Richtung: Halbkreis mit 342 mm Abstand", () => {
    const left = ids("a", repeat(2, "kurve-1-90", "links"));
    const right = ids("a", repeat(2, "kurve-1-90", "rechts"));
    expect(okTrace(runTrace(left, ORIGIN)).end).toEqual(P(0, 342, 4));
    expect(okTrace(runTrace(right, ORIGIN)).end).toEqual(P(0, -342, 4));
  });

  test("[REQ-CORE-6] zwei Kurven 1/45° gleicher Richtung enden wie eine Kurve 1/90°", () => {
    fc.assert(
      fc.property(arbStart(), arbTurn, (start, turn) => {
        const two = okTrace(runTrace(ids("a", repeat(2, "kurve-1-45", turn)), start));
        const one = okTrace(runTrace([part("a", "kurve-1-90", turn)], start));
        expect(two.end).toEqual(one.end);
      }),
    );
  });

  test("[REQ-CORE-7] Gerade 342 ersetzt durch 3 × 114 oder durch eine Kreuzung: Endpose gleich", () => {
    fc.assert(
      fc.property(arbParts("p"), arbParts("s"), arbStart(), (prefix, suffix, start) => {
        const base = [...prefix, part("x", "gerade-342"), ...suffix];
        const threeBy114 = [
          ...prefix,
          part("x1", "gerade-114"),
          part("x2", "anschlussstueck"),
          part("x3", "rundenzaehler"),
          ...suffix,
        ];
        const viaCrossing = [...prefix, part("x", "kreuzung"), ...suffix];
        const endBase = okTrace(runTrace(base, start)).end;
        expect(okTrace(runTrace(threeBy114, start)).end).toEqual(endBase);
        expect(okTrace(runTrace(viaCrossing, start)).end).toEqual(endBase);
      }),
    );
  });

  test("[REQ-CORE-8] verschobene und gedrehte Startpose verschiebt und dreht jede Pose der Spur", () => {
    fc.assert(
      fc.property(
        arbParts("p", 25),
        arbStart(),
        fc.integer({ min: 0, max: 7 }),
        arbVec(1_000_000n),
        (layout, start, m, t) => {
          const a = okTrace(runTrace(layout, start));
          const b = okTrace(runTrace(layout, transformPose(start, m, t)));
          expect(b.steps).toEqual(a.steps.map((s) => transformStep(s, m, t)));
          expect(b.end).toEqual(transformPose(a.end, m, t));
        },
      ),
    );
  });

  test("[REQ-CORE-8] [REQ-ARCH-2] Tausende Elemente und riesige Verschiebungen ohne Genauigkeitsverlust", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlaceable, { minLength: 3000, maxLength: 3000 }).map((ps) => ids("p", ps)),
        arbStart(10n ** 40n),
        fc.integer({ min: 0, max: 7 }),
        arbVec(10n ** 40n),
        (layout, start, m, t) => {
          const a = okTrace(runTrace(layout, start));
          const b = okTrace(runTrace(layout, transformPose(start, m, t)));
          expect(b.steps.length).toBe(3000);
          expect(b.steps).toEqual(a.steps.map((s) => transformStep(s, m, t)));
          expect(a.steps.map((s) => s.pose)).toEqual(refPoses(layout, start));
        },
      ),
      { numRuns: 3, endOnFailure: true },
    );
  });

  test("[REQ-CORE-8] mit Querung: Queranschlüsse wandern mit, die Querung bleibt gültig", () => {
    fc.assert(
      fc.property(
        arbParts("p"),
        fc.boolean(),
        arbParts("s"),
        arbStart(),
        fc.integer({ min: 0, max: 7 }),
        arbVec(1_000_000n),
        (prefix, mirrored, suffix, start, m, t) => {
          const layout = [...prefix, ...(mirrored ? flipTurns(ACHT) : ACHT), ...suffix];
          const a = okTrace(runTrace(layout, start));
          const b = okTrace(runTrace(layout, transformPose(start, m, t)));
          expect(b.steps).toEqual(a.steps.map((s) => transformStep(s, m, t)));
          expect(b.end).toEqual(transformPose(a.end, m, t));
        },
      ),
    );
  });

  test("[REQ-CORE-9] Kurvenrichtungen getauscht: Spur ist das Spiegelbild an der Startachse", () => {
    fc.assert(
      fc.property(arbParts("p", 25), arbStart(), (layout, start) => {
        const a = okTrace(runTrace(layout, start));
        const b = okTrace(runTrace(flipTurns(layout), start));
        expect(b.steps).toEqual(a.steps.map((s) => mirrorStep(s, start)));
        expect(b.end).toEqual(mirrorPose(a.end, start));
      }),
    );
  });

  test("[REQ-CORE-9] Spiegelung mit Querung: Ankunft links wird zu Ankunft rechts und umgekehrt", () => {
    fc.assert(
      fc.property(arbParts("p"), arbParts("s"), arbStart(), (prefix, suffix, start) => {
        const layout = [...prefix, ...ACHT, ...suffix];
        const a = okTrace(runTrace(layout, start));
        const b = okTrace(runTrace(flipTurns(layout), start));
        expect(b.steps).toEqual(a.steps.map((s) => mirrorStep(s, start)));
        // Ankunft vor der Querung (Nr. 5): im Original am rechten, gespiegelt am linken Anschluss
        const crossingStep = at(a.steps, prefix.length);
        const mirroredCrossingStep = at(b.steps, prefix.length);
        const arrival = at(a.steps, prefix.length + 4).pose;
        const mirroredArrival = at(b.steps, prefix.length + 4).pose;
        expect(arrival).toEqual(crossingStep.crossPorts?.right);
        expect(mirroredArrival).toEqual(mirroredCrossingStep.crossPorts?.left);
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Kern: Geschlossen und offen
// ---------------------------------------------------------------------------------------------

/** Mittellinie läuft auf (0, 0) zurück, aber mit Richtung 4 (per Suche gefunden, von Hand geprüft). */
const SAME_POSITION_OTHER_DIR: ReadonlyArray<LayoutElement> = [
  part("a", "gerade-342"),
  part("b", "kurve-1-90", "links"),
  part("c", "kurve-1-90", "links"),
  part("d", "kurve-1-90", "links"),
  part("e", "kurve-1-90", "rechts"),
];

/**
 * Oval mit Zickzack-Seite, das um 57·(3363 − 2378·√2) mm ≈ 0,0085 mm offen bleibt
 * (3363² − 2·2378² = 1). Seite A: Kurve 1/45° rechts, Diagonale D, 1/45° links, 1/45° links,
 * Diagonale D, 1/45° rechts mit D = 395 × 342 + 114 = 135204 mm; Vortrieb 2·171·√2 + D·√2 =
 * 135546·√2 mm. Seite B: 560 × 342 + 171 = 191691 mm geradeaus.
 */
const NEAR_MISS: ReadonlyArray<LayoutElement> = (() => {
  const diagonal = [...repeat(395, "gerade-342"), { part: "gerade-114" }];
  return ids("n", [
    ...repeat(2, "kurve-1-90", "links"),
    { part: "kurve-1-45", turn: "rechts" },
    ...diagonal,
    { part: "kurve-1-45", turn: "links" },
    { part: "kurve-1-45", turn: "links" },
    ...diagonal,
    { part: "kurve-1-45", turn: "rechts" },
    ...repeat(2, "kurve-1-90", "links"),
    ...repeat(560, "gerade-342"),
    { part: "gerade-171" },
  ]);
})();

type ClosedCase = { readonly name: string; readonly build: (turn: Turn) => LayoutElement[] };
const OVAL = (turn: Turn): LayoutElement[] =>
  ids("o", [
    { part: "kurve-1-90", turn },
    { part: "kurve-1-90", turn },
    { part: "gerade-342" },
    { part: "kurve-1-90", turn },
    { part: "kurve-1-90", turn },
    { part: "gerade-342" },
  ]);
const CLOSED_CASES: ReadonlyArray<ClosedCase> = [
  { name: "(a) 4 × Kurve 1/90°", build: (t) => ids("c", repeat(4, "kurve-1-90", t)) },
  { name: "(b) 8 × Kurve 1/45°", build: (t) => ids("c", repeat(8, "kurve-1-45", t)) },
  { name: "(c) Oval aus dem Bestand", build: OVAL },
  {
    name: "(d) Oval, Gerade 342 ersetzt durch Gerade 114, Anschlussstück, Rundenzähler",
    build: (t) =>
      replaceAt(
        OVAL(t),
        5,
        part("x1", "gerade-114"),
        part("x2", "anschlussstueck"),
        part("x3", "rundenzaehler"),
      ),
  },
  { name: "(e) 8 × Kurve 2/45°", build: (t) => ids("c", repeat(8, "kurve-2-45", t)) },
  { name: "(e) 8 × Kurve 3/45°", build: (t) => ids("c", repeat(8, "kurve-3-45", t)) },
];

describe("Kern: Geschlossen und offen", () => {
  test("[REQ-CORE-10] geschlossen genau bei exakt gleicher Endposition und Endrichtung", () => {
    expect(runClosure(ids("c", repeat(4, "kurve-1-90", "links")), ORIGIN)).toEqual(closedAt0());
    // ein Element mehr: nicht mehr exakt gleich
    expect(runClosure(ids("c", repeat(5, "kurve-1-90", "links")), ORIGIN).ok).toBe(true);
    expect(runClosure(ids("c", repeat(5, "kurve-1-90", "links")), ORIGIN)).not.toEqual(closedAt0());
  });

  test("[REQ-CORE-10] gleiche Position mit anderer Richtung ist offen", () => {
    expect(okTrace(runTrace(SAME_POSITION_OTHER_DIR, ORIGIN)).end).toEqual(P(0, 0, 4));
    expect(runClosure(SAME_POSITION_OTHER_DIR, ORIGIN)).toEqual(open(ZERO, ZERO, 4));
  });

  // Je Komponente der Pose (x = xa + xb·√2, y = ya + yb·√2, Richtung) ein reales Layout ab
  // (0, 0, 0), dessen Ende NUR in dieser Komponente von der Startpose abweicht. Ein Vergleich,
  // der eine Komponente auslässt, meldet dort fälschlich „geschlossen“.
  const ONE_COMPONENT_OPEN: ReadonlyArray<{
    readonly component: string;
    readonly layout: LayoutElement[];
    readonly end: Pose;
    readonly expected: ClosureResult;
  }> = [
    {
      component: "xa",
      layout: [part("a", "gerade-342")],
      end: P(342, 0, 0),
      expected: open(C(-342), ZERO, 0),
    },
    {
      component: "xb",
      layout: ids("x", [
        { part: "engstelle" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-2-45", turn: "links" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-2-45", turn: "links" },
        { part: "kurve-1-90", turn: "links" },
      ]),
      end: P(C(0, 114), 0, 0),
      expected: open(C(0, -114), ZERO, 0),
    },
    {
      component: "ya",
      layout: ids("y", [
        { part: "gerade-342" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-1-90", turn: "links" },
        { part: "gerade-342" },
        { part: "kurve-1-90", turn: "rechts" },
        { part: "kurve-1-90", turn: "rechts" },
      ]),
      end: P(0, 684, 0),
      expected: open(ZERO, C(-684), 0),
    },
    {
      component: "yb",
      layout: ids("y", [
        { part: "kurve-1-90", turn: "links" },
        { part: "engstelle" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-2-45", turn: "links" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-2-45", turn: "links" },
      ]),
      end: P(0, C(0, 114), 0),
      expected: open(ZERO, C(0, -114), 0),
    },
    {
      component: "Richtung",
      layout: [...SAME_POSITION_OTHER_DIR],
      end: P(0, 0, 4),
      expected: open(ZERO, ZERO, 4),
    },
  ];
  for (const c of ONE_COMPONENT_OPEN) {
    test(`[REQ-CORE-10] [REQ-CORE-11] Ende weicht nur in ${c.component} vom Start ab: offen`, () => {
      expect(okTrace(runTrace(c.layout, ORIGIN)).end).toEqual(c.end);
      expect(runClosure(c.layout, ORIGIN)).toEqual(c.expected);
    });
  }

  test("[REQ-CORE-10] [REQ-ARCH-2] Abweichung von 0,0085 mm ist offen, ohne Toleranz", () => {
    const end = okTrace(runTrace(NEAR_MISS, ORIGIN)).end;
    expect(end).toEqual(P(C(191691, -135546), 0, 0));
    expect(runClosure(NEAR_MISS, ORIGIN)).toEqual(open(C(-191691, 135546), ZERO, 0));
  });

  test("[REQ-CORE-10] geschlossen genau dann, wenn die Orakel-Endpose exakt die Startpose ist", () => {
    const arbLayout = fc.oneof(
      arbParts("p", 10),
      fc
        .tuple(fc.constantFrom(...CLOSED_CASES), arbTurn)
        .map(([c, t]) => c.build(t) as PartElement[]),
    );
    fc.assert(
      fc.property(arbLayout, arbStart(), (layout, start) => {
        fc.pre(layout.length > 0);
        const end = at(refPoses(layout, start), layout.length - 1);
        const s = normPose(start);
        const isClosed = JSON.stringify(end, bigintJson) === JSON.stringify(s, bigintJson);
        const r = runClosure(layout, start);
        if (!r.ok) throw new Error("unerwarteter Fehler");
        expect(r.closure.status).toBe(isClosed ? "geschlossen" : "offen");
      }),
    );
  });

  test("[REQ-CORE-11] offenes Layout: Versatz Ende → Start exakt und Winkel Start − Ende", () => {
    expect(runClosure([part("a", "gerade-342")], ORIGIN)).toEqual(open(C(-342), ZERO, 0));
    expect(runClosure([part("a", "kurve-1-90", "links")], ORIGIN)).toEqual(
      open(C(-171), C(-171), -2),
    );
    expect(runClosure([part("a", "kurve-1-90", "rechts")], ORIGIN)).toEqual(
      open(C(-171), C(171), 2),
    );
    expect(runClosure([part("a", "kurve-1-45", "links")], ORIGIN)).toEqual(
      open(C(0, [-171, 2]), C(-171, [171, 2]), -1),
    );
    // 180° liegt im Bereich (−180°, 180°] und wird als +4 gemeldet, links wie rechts
    expect(runClosure(ids("a", repeat(2, "kurve-1-90", "links")), ORIGIN)).toEqual(
      open(ZERO, C(-342), 4),
    );
    expect(runClosure(ids("a", repeat(2, "kurve-1-90", "rechts")), ORIGIN)).toEqual(
      open(ZERO, C(342), 4),
    );
    // drei Viertel links: Ende k = 6, Winkel 0 − 6 ≡ +2 (90°)
    expect(runClosure(ids("a", repeat(3, "kurve-1-90", "links")), ORIGIN)).toEqual(
      open(C(171), C(-171), 2),
    );
  });

  test("[REQ-CORE-11] Versatz und Winkel für beliebige Layouts und Startposen", () => {
    fc.assert(
      fc.property(arbParts("p", 15), arbStart(), (layout, start) => {
        fc.pre(layout.length > 0);
        const end = at(refPoses(layout, start), layout.length - 1);
        const dx = normC(cSub(start.x, end.x));
        const dy = normC(cSub(start.y, end.y));
        const d = mod8(start.dir - end.dir);
        const angle = d > 4 ? d - 8 : d;
        const r = runClosure(layout, start);
        if (!r.ok) throw new Error("unerwarteter Fehler");
        if (r.closure.status === "leer") throw new Error("nicht leer erwartet");
        expect(r.closure.offset).toEqual({ dx, dy });
        expect(r.closure.angleSteps).toBe(angle);
        expect(r.closure.angleSteps).toBeGreaterThan(-4);
        expect(r.closure.angleSteps).toBeLessThanOrEqual(4);
      }),
    );
  });

  test("[REQ-CORE-11] geschlossen: Versatz und Winkel sind null", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CLOSED_CASES), arbTurn, arbStart(), (c, turn, start) => {
        expect(runClosure(c.build(turn), start)).toEqual(closedAt0());
      }),
    );
  });

  test("[REQ-CORE-12] leeres Layout hat den Status leer", () => {
    fc.assert(
      fc.property(arbStart(), (start) => {
        expect(runClosure([], start)).toEqual({ ok: true, closure: { status: "leer" } });
      }),
    );
  });

  for (const c of CLOSED_CASES) {
    test(`[REQ-CORE-13] ${c.name} gleicher Richtung schließt aus beliebiger Startpose, links und rechts`, () => {
      fc.assert(
        fc.property(arbStart(), arbTurn, (start, turn) => {
          expect(runClosure(c.build(turn), start)).toEqual(closedAt0());
        }),
      );
    });
  }

  test("[REQ-CORE-14] ein eingefügtes Teil oder ein entferntes Element öffnet ein geschlossenes Layout", () => {
    const bases: ReadonlyArray<(t: Turn) => LayoutElement[]> = [
      ...CLOSED_CASES.map((c) => c.build),
      (t) => (t === "rechts" ? [...ACHT] : flipTurns(ACHT)),
    ];
    const arbChange = fc.oneof(
      fc.record({ insert: arbPlaceable, at: fc.nat() }),
      fc.record({ removeAt: fc.nat() }),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...bases),
        arbTurn,
        arbStart(),
        arbChange,
        (build, turn, start, change) => {
          const base = build(turn);
          expect(runClosure(base, start)).toEqual(closedAt0());
          const changed =
            "insert" in change
              ? (() => {
                  const i = change.at % (base.length + 1);
                  return [
                    ...base.slice(0, i),
                    part("neu", change.insert.part, change.insert.turn),
                    ...base.slice(i),
                  ];
                })()
              : (() => {
                  const i = change.removeAt % base.length;
                  return [...base.slice(0, i), ...base.slice(i + 1)];
                })();
          const r = runClosure(changed, start);
          if (base.some(isCrossing)) {
            const okOpen = r.ok && r.closure.status === "offen";
            const crossingError =
              !r.ok &&
              r.errors.every((e) =>
                ["ankunftNichtAmQueranschluss", "ungueltigerVerweis", "bereitsGequert"].includes(
                  e.kind,
                ),
              );
            expect(okOpen || crossingError).toBe(true);
          } else {
            expect(r.ok && r.closure.status).toBe("offen");
          }
        },
      ),
    );
  });

  test("[REQ-CORE-14] Einfügen vorn, mitten und hinten in das Oval öffnet es", () => {
    const oval = OVAL("links");
    for (const i of [0, 3, oval.length]) {
      const changed = [...oval.slice(0, i), part("neu", "gerade-114"), ...oval.slice(i)];
      const r = runClosure(changed, ORIGIN);
      expect(r.ok && r.closure.status).toBe("offen");
    }
  });

  test("[REQ-CORE-15] Gesamtdrehung kein Vielfaches von 360°: offen, Winkel ≠ 0", () => {
    const stepsOf = (el: PartElement): number => {
      const g = refGeom(el.part);
      return g.kind === "kurve" ? (el.turn === "links" ? g.steps : -g.steps) : 0;
    };
    fc.assert(
      fc.property(arbParts("p", 20), arbStart(), (layout, start) => {
        const total = layout.reduce((sum, el) => sum + stepsOf(el), 0);
        fc.pre(mod8(total) !== 0);
        const r = runClosure(layout, start);
        if (!r.ok || r.closure.status !== "offen") {
          throw new Error(`offen erwartet: ${JSON.stringify(r, bigintJson)}`);
        }
        expect(r.closure.angleSteps).not.toBe(0);
        expect(mod8(r.closure.angleSteps + total)).toBe(0);
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Kern: Fehler
// ---------------------------------------------------------------------------------------------

describe("Kern: Fehler", () => {
  test("[REQ-CORE-16] unbekannte Teil-ID: Fehler mit Index und Teil-ID, kein gültiges Teilergebnis", () => {
    const layout = [part("a", "gerade-342"), part("b", "gerade-100"), part("c", "gerade-171")];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "unbekanntesTeil", index: 1, partId: "gerade-100" }],
    });
    expect(runClosure(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "unbekanntesTeil", index: 1, partId: "gerade-100" }],
    });
  });

  test("[REQ-CORE-17] nicht platzierbare Einträge: Fehler nichtPlatzierbar mit Index und Teil-ID", () => {
    for (const partId of NON_PLACEABLE_IDS) {
      const layout = [part("a", "gerade-342"), part("b", partId)];
      expect(runTrace(layout, ORIGIN)).toEqual({
        ok: false,
        errors: [{ kind: "nichtPlatzierbar", index: 1, partId }],
      });
    }
  });

  test("[REQ-CORE-18] Kurve ohne Richtung und Nicht-Kurve mit Richtung: Fehler mit Index und Teil-ID", () => {
    expect(runTrace([part("a", "gerade-114"), part("b", "kurve-1-90")], ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "richtungFehlt", index: 1, partId: "kurve-1-90" }],
    });
    expect(runTrace([part("a", "gerade-114", "links")], ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "richtungUeberzaehlig", index: 0, partId: "gerade-114" }],
    });
    expect(runTrace([part("a", "kreuzung", "rechts")], ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "richtungUeberzaehlig", index: 0, partId: "kreuzung" }],
    });
    for (const partId of CURVE_IDS) {
      expect(runTrace([part("a", partId)], ORIGIN)).toEqual({
        ok: false,
        errors: [{ kind: "richtungFehlt", index: 0, partId }],
      });
    }
  });

  test("[REQ-CORE-19] Fehler sind Rückgabewerte und alle fehlerhaften Elemente werden gemeldet", () => {
    const layout = [
      part("a", "gerade-342"),
      part("b", "gibt-es-nicht"),
      part("c", "kurve-1-90"),
      part("d", "looping"),
      part("e", "gerade-171", "rechts"),
      part("f", "auch-nicht"),
    ];
    let result: TraceResult | undefined;
    expect(() => {
      result = core.trace(cat(), layout, ORIGIN);
    }).not.toThrow();
    expect(result === undefined ? undefined : normTrace(result)).toEqual({
      ok: false,
      errors: [
        { kind: "unbekanntesTeil", index: 1, partId: "gibt-es-nicht" },
        { kind: "richtungFehlt", index: 2, partId: "kurve-1-90" },
        { kind: "nichtPlatzierbar", index: 3, partId: "looping" },
        { kind: "richtungUeberzaehlig", index: 4, partId: "gerade-171" },
        { kind: "unbekanntesTeil", index: 5, partId: "auch-nicht" },
      ],
    });
    expect(() => core.closure(cat(), layout, ORIGIN)).not.toThrow();
    expect(() => core.consumption(cat(), layout)).not.toThrow();
  });

  test("[REQ-CORE-19] Querungsfehler werfen nicht und werden alle gemeldet", () => {
    const layout: LayoutElement[] = [
      crossing("q0", "nirgends"),
      part("k", "kreuzung"),
      crossing("q2", "k"),
      crossing("q3", "q3"),
      part("x", "gerade-100"),
    ];
    let result: TraceResult | undefined;
    expect(() => {
      result = core.trace(cat(), layout, ORIGIN);
    }).not.toThrow();
    const r = result === undefined ? undefined : normTrace(result);
    expect(r?.ok).toBe(false);
    const kinds = r !== undefined && !r.ok ? r.errors.map((e) => `${e.kind}@${errKey(e)}`) : [];
    expect(kinds).toEqual(
      expect.arrayContaining(["ungueltigerVerweis@0", "ungueltigerVerweis@3", "unbekanntesTeil@4"]),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Kern: Kreuzung und Querung
// ---------------------------------------------------------------------------------------------

describe("Kern: Kreuzung und Querung", () => {
  test("[REQ-CORE-23] Kreuzung aus (0, 0, 0): Ausgang (342, 0, 0), Queranschlüsse (171, ±57)", () => {
    const r = okTrace(runTrace([part("k", "kreuzung")], ORIGIN));
    expect(r.steps).toEqual([
      { pose: P(342, 0, 0), crossPorts: { left: P(171, 57, 6), right: P(171, -57, 2) } },
    ]);
  });

  test("[REQ-CORE-23] Kreuzung aus (0, 0, 1): Queranschlüsse (57√2, 114√2, 7) und (114√2, 57√2, 3)", () => {
    const r = okTrace(runTrace([part("k", "kreuzung")], P(0, 0, 1)));
    expect(r.steps).toEqual([
      {
        pose: P(C(0, 171), C(0, 171), 1),
        crossPorts: {
          left: P(C(0, 57), C(0, 114), 7),
          right: P(C(0, 114), C(0, 57), 3),
        },
      },
    ]);
  });

  test("[REQ-CORE-23] Kreuzung aus beliebiger Pose: Längsweg wie Gerade 342, Anschlüsse nach Definition", () => {
    fc.assert(
      fc.property(arbStart(), (start) => {
        const r = okTrace(runTrace([part("k", "kreuzung")], start));
        const straight = okTrace(runTrace([part("g", "gerade-342")], start));
        expect(at(r.steps, 0).pose).toEqual(straight.end);
        expect(at(r.steps, 0).crossPorts).toEqual(refCrossPorts(start));
      }),
    );
  });

  test("[REQ-CORE-24] Ankunft am rechten Anschluss (171, −57, 2) ergibt Ausgang (171, 57, 2)", () => {
    const r = okTrace(runTrace(ACHT.slice(0, 6), ORIGIN));
    expect(at(r.steps, 4).pose).toEqual(P(171, -57, 2));
    expect(at(r.steps, 5)).toEqual({ pose: P(171, 57, 2) });
  });

  test("[REQ-CORE-24] Ankunft am linken Anschluss (171, 57, 6) ergibt Ausgang (171, −57, 6)", () => {
    const r = okTrace(runTrace(flipTurns(ACHT).slice(0, 6), ORIGIN));
    expect(at(r.steps, 4).pose).toEqual(P(171, 57, 6));
    expect(at(r.steps, 5)).toEqual({ pose: P(171, -57, 6) });
  });

  test("[REQ-CORE-24] Querung führt 114 mm in Fahrtrichtung zum gegenüberliegenden Anschluss", () => {
    fc.assert(
      fc.property(arbParts("p"), fc.boolean(), arbStart(), (prefix, mirrored, start) => {
        const layout = [...prefix, ...(mirrored ? flipTurns(ACHT) : ACHT)];
        const r = okTrace(runTrace(layout, start));
        const ports = at(r.steps, prefix.length).crossPorts;
        if (ports === undefined) throw new Error("Kreuzung ohne Queranschlüsse");
        const arrival = at(r.steps, prefix.length + 4).pose;
        const exit = at(r.steps, prefix.length + 5).pose;
        const target = mirrored ? ports.right : ports.left;
        expect(arrival).toEqual(mirrored ? ports.left : ports.right);
        expect(exit).toEqual({ x: target.x, y: target.y, dir: arrival.dir });
        expect(exit).toEqual(normPose(moveBy(arrival, unit(114, arrival.dir))));
      }),
    );
  });

  test("[REQ-CORE-25] Verweis auf unbekannte ID, Nicht-Kreuzung, Querung oder spätere Position", () => {
    const cases: ReadonlyArray<{
      layout: LayoutElement[];
      index: number;
      id: string;
      ref: string;
    }> = [
      {
        layout: [part("k", "kreuzung"), crossing("q", "gibt-es-nicht")],
        index: 1,
        id: "q",
        ref: "gibt-es-nicht",
      },
      {
        layout: [part("k", "kreuzung"), part("g", "gerade-342"), crossing("q", "g")],
        index: 2,
        id: "q",
        ref: "g",
      },
      {
        layout: [part("k", "kreuzung"), crossing("q1", "nirgends"), crossing("q", "q1")],
        index: 2,
        id: "q",
        ref: "q1",
      },
      {
        layout: [part("k", "kreuzung"), crossing("q", "q")],
        index: 1,
        id: "q",
        ref: "q",
      },
      {
        layout: [crossing("q", "k"), part("k", "kreuzung")],
        index: 0,
        id: "q",
        ref: "k",
      },
    ];
    for (const c of cases) {
      const r = runTrace(c.layout, ORIGIN);
      if (r.ok) throw new Error("Fehler erwartet");
      expect(r.errors).toContainEqual({
        kind: "ungueltigerVerweis",
        index: c.index,
        id: c.id,
        ref: c.ref,
      });
    }
  });

  test("[REQ-CORE-26] mehrere Querungen derselben Kreuzung: erste gültig, jede weitere Fehler", () => {
    const layout = [...ACHT, crossing("q2", "e1"), part("g", "gerade-114"), crossing("q3", "e1")];
    // q2 kommt bei (0, 0, 0) an, q3 bei (114, 0, 0): beide nicht am Anschluss, aber nur
    // bereitsGequert, kein Ankunftsfehler
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        { kind: "bereitsGequert", index: 10, id: "q2", ref: "e1" },
        { kind: "bereitsGequert", index: 12, id: "q3", ref: "e1" },
      ],
    });
  });

  test("[REQ-CORE-26] zweite Querung mit Ankunft genau am Queranschluss: trotzdem nur bereits gequert", () => {
    // Nach der Acht steht die Bahn wieder am Eingang der Kreuzung e1. Derselbe Weg noch einmal
    // (Gerade 342 statt Kreuzung, 3 Kurven rechts, Gerade 114) kommt exakt am rechten
    // Queranschluss (171, −57, 2) an.
    const again: LayoutElement[] = [
      part("r1", "gerade-342"),
      part("r2", "kurve-1-90", "rechts"),
      part("r3", "kurve-1-90", "rechts"),
      part("r4", "kurve-1-90", "rechts"),
      part("r5", "gerade-114"),
    ];
    const prefix = okTrace(runTrace([...ACHT, ...again], ORIGIN));
    expect(at(prefix.steps, 14).pose).toEqual(P(171, -57, 2));
    const layout = [...ACHT, ...again, crossing("q2", "e1"), part("r7", "gerade-114")];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "bereitsGequert", index: 15, id: "q2", ref: "e1" }],
    });
  });

  test("[REQ-CORE-27] Ankunft an der Position des Anschlusses, aber aus der Kreuzung heraus", () => {
    // Kreuzung, drei Kurven links, 2 × 114: Ankunft (171, −57, 6) = rechte Position, Richtung k+6
    const layout = [
      part("k", "kreuzung"),
      ...ids("c", repeat(3, "kurve-1-90", "links")),
      part("g1", "gerade-114"),
      part("g2", "gerade-114"),
      crossing("q", "k"),
    ];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        {
          kind: "ankunftNichtAmQueranschluss",
          index: 6,
          id: "q",
          ref: "k",
          arrival: P(171, -57, 6),
        },
      ],
    });
  });

  test("[REQ-CORE-27] Ankunft an der linken Position mit Richtung 2 (aus der Kreuzung heraus)", () => {
    const layout = [...ACHT.slice(0, 4), part("g1", "gerade-114"), part("g2", "gerade-114")];
    const withCrossing = [...layout, crossing("q", "e1")];
    expect(runTrace(withCrossing, ORIGIN)).toEqual({
      ok: false,
      errors: [
        {
          kind: "ankunftNichtAmQueranschluss",
          index: 6,
          id: "q",
          ref: "e1",
          arrival: P(171, 57, 2),
        },
      ],
    });
  });

  // Je Komponente eine Ankunft, die NUR in dieser Komponente vom rechten Queranschluss
  // (171, −57, 2) der Acht-Kreuzung abweicht (Nr. 5 der Acht durch den Weg ersetzt). Für xb wird
  // derselbe Weg wie für yb aus der Startpose (0, 0, 2) verfolgt: um 90° gedreht wird aus der
  // Abweichung im √2-Anteil von y eine im √2-Anteil von x (Anschluss dann (57, 171, 4)).
  const YB_WAY: ReadonlyArray<PartElement> = ids("w", [
    { part: "gerade-114" },
    { part: "kurve-1-45", turn: "links" },
    { part: "kurve-1-90", turn: "rechts" },
    { part: "kurve-1-45", turn: "links" },
  ]);
  const ONE_COMPONENT_ARRIVAL: ReadonlyArray<{
    readonly component: string;
    readonly way: ReadonlyArray<PartElement>;
    readonly start: Pose;
    readonly arrival: Pose;
  }> = [
    {
      component: "xa",
      way: ids("w", [
        { part: "gerade-114" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-1-90", turn: "links" },
        { part: "kurve-1-90", turn: "rechts" },
        { part: "kurve-1-90", turn: "rechts" },
      ]),
      start: ORIGIN,
      arrival: P(-513, -57, 2),
    },
    { component: "xb", way: YB_WAY, start: P(0, 0, 2), arrival: P(C(57, -342), 171, 4) },
    { component: "ya", way: [part("w0", "gerade-342")], start: ORIGIN, arrival: P(171, 171, 2) },
    { component: "yb", way: YB_WAY, start: ORIGIN, arrival: P(171, C(-57, 342), 2) },
    {
      component: "Richtung",
      // erst an den Anschluss, dann die Schleife aus SAME_POSITION_OTHER_DIR: gleiche Position,
      // Richtung um 180° gedreht (aus der Kreuzung heraus)
      way: ids("w", [
        { part: "gerade-114" },
        { part: "gerade-342" },
        ...repeat(3, "kurve-1-90", "links"),
        { part: "kurve-1-90", turn: "rechts" },
      ]),
      start: ORIGIN,
      arrival: P(171, -57, 6),
    },
  ];
  for (const c of ONE_COMPONENT_ARRIVAL) {
    test(`[REQ-CORE-27] Ankunft weicht nur in ${c.component} vom Queranschluss ab: Fehler`, () => {
      const head = [...(ACHT.slice(0, 4) as PartElement[]), ...c.way];
      const ok = okTrace(runTrace(head, c.start));
      const ports = at(ok.steps, 0).crossPorts;
      expect(at(ok.steps, head.length - 1).pose).toEqual(c.arrival);
      expect(ports?.right).toEqual(c.start.dir === 2 ? P(57, 171, 4) : P(171, -57, 2));
      expect(runTrace([...head, crossing("q", "e1")], c.start)).toEqual({
        ok: false,
        errors: [
          {
            kind: "ankunftNichtAmQueranschluss",
            index: head.length,
            id: "q",
            ref: "e1",
            arrival: c.arrival,
          },
        ],
      });
    });
  }

  test("[REQ-CORE-27] jede andere Ankunft als ein Queranschluss ist ein Fehler, ohne Toleranz", () => {
    // Nr. 5 (Gerade 114) der Acht wird durch eine beliebige nicht leere Teilefolge ersetzt.
    fc.assert(
      fc.property(
        fc.array(arbPlaceable, { minLength: 1, maxLength: 6 }).map((ps) => ids("w", ps)),
        (way) => {
          const head = [...(ACHT.slice(0, 4) as PartElement[]), ...way];
          const arrival = at(refPoses(head, ORIGIN), head.length - 1);
          const key = (p: Pose): string => JSON.stringify(p, bigintJson);
          fc.pre(key(arrival) !== key(P(171, -57, 2)) && key(arrival) !== key(P(171, 57, 6)));
          const layout = [...head, crossing("q", "e1")];
          expect(runTrace(layout, ORIGIN)).toEqual({
            ok: false,
            errors: [
              {
                kind: "ankunftNichtAmQueranschluss",
                index: head.length,
                id: "q",
                ref: "e1",
                arrival,
              },
            ],
          });
        },
      ),
    );
  });
});

describe("Kern: Fehler an Querungen und Unabhängigkeit", () => {
  test("[REQ-CORE-28] Fehler vor der Querung: Ankunft unbestimmt, kein Ankunftsfehler", () => {
    const layout = replaceAt(
      replaceAt(ACHT, 4, part("e5", "gerade-171")),
      2,
      part("e3", "gibt-es-nicht", "rechts"),
    );
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "unbekanntesTeil", index: 2, partId: "gibt-es-nicht" }],
    });
  });

  // Fehlerhaftes Element jeder Fehlerart vor einer Querung mit falscher Ankunft (Nr. 5 =
  // Gerade 171). Das fehlerhafte Element wird zusätzlich eingefügt (hinter Nr. 2), damit eine
  // Implementierung, die es nur überspringt und weiterrechnet, an der Querung (dann index 6) einen
  // Ankunftsfehler meldet und rot wird.
  const wrongArrivalAcht = (): LayoutElement[] => replaceAt(ACHT, 4, part("e5", "gerade-171"));
  const withFaultyAt2 = (faulty: LayoutElement): LayoutElement[] => {
    const base = wrongArrivalAcht();
    return [...base.slice(0, 2), faulty, ...base.slice(2)];
  };

  test("[REQ-CORE-28] nicht platzierbares Teil vor der Querung: kein Ankunftsfehler", () => {
    expect(runTrace(withFaultyAt2(part("f", "looping")), ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "nichtPlatzierbar", index: 2, partId: "looping" }],
    });
  });

  test("[REQ-CORE-28] Kurve ohne Richtung vor der Querung: kein Ankunftsfehler", () => {
    expect(runTrace(withFaultyAt2(part("f", "kurve-1-45")), ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "richtungFehlt", index: 2, partId: "kurve-1-45" }],
    });
  });

  test("[REQ-CORE-28] Nicht-Kurve mit Richtung vor der Querung: kein Ankunftsfehler", () => {
    expect(runTrace(withFaultyAt2(part("f", "gerade-114", "links")), ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "richtungUeberzaehlig", index: 2, partId: "gerade-114" }],
    });
  });

  test("[REQ-CORE-28] Querung mit ungültigem Verweis vor der Querung: kein Ankunftsfehler", () => {
    expect(runTrace(withFaultyAt2(crossing("f", "nirgends")), ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "ungueltigerVerweis", index: 2, id: "f", ref: "nirgends" }],
    });
  });

  test("[REQ-CORE-28] bereits gequerte Kreuzung vor einer weiteren Querung: kein Ankunftsfehler", () => {
    // Gültige Acht, danach eine zweite Querung von e1 (fehlerhaft), danach eine zweite Acht mit
    // eigener Kreuzung b1 und falscher Ankunft (Gerade 171): nur bereitsGequert.
    const second = wrongArrivalAcht().map((el) =>
      isCrossing(el)
        ? crossing(`b${el.id}`, `b${el.crosses}`)
        : part(`b${el.id}`, el.part, el.turn),
    );
    const layout = [...ACHT, crossing("q2", "e1"), ...second];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "bereitsGequert", index: 10, id: "q2", ref: "e1" }],
    });
  });

  test("[REQ-CORE-28] Fehler hinter der Querung werden zusätzlich zum Ankunftsfehler gemeldet", () => {
    const layout = replaceAt(
      replaceAt(ACHT, 4, part("e5", "gerade-171")),
      7,
      part("e8", "gibt-es-nicht", "links"),
    );
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        {
          kind: "ankunftNichtAmQueranschluss",
          index: 5,
          id: "e6",
          ref: "e1",
          arrival: P(171, 0, 2),
        },
        { kind: "unbekanntesTeil", index: 7, partId: "gibt-es-nicht" },
      ],
    });
  });

  test("[REQ-CORE-28] höchstens ein Ankunftsfehler je Verfolgung", () => {
    const wrongAcht = (prefix: string): LayoutElement[] =>
      replaceAt(ACHT, 4, part("e5", "gerade-171")).map((el) =>
        isCrossing(el)
          ? crossing(`${prefix}${el.id}`, `${prefix}${el.crosses}`)
          : part(`${prefix}${el.id}`, el.part, el.turn),
      );
    const layout = [...wrongAcht("a"), ...wrongAcht("b")];
    const r = runTrace(layout, ORIGIN);
    if (r.ok) throw new Error("Fehler erwartet");
    expect(r.errors).toEqual([
      {
        kind: "ankunftNichtAmQueranschluss",
        index: 5,
        id: "ae6",
        ref: "ae1",
        arrival: P(171, 0, 2),
      },
    ]);
  });

  test("[REQ-CORE-28] Fehler nach 16, 17, 18, 25, 26 und 29 werden unabhängig voneinander gemeldet", () => {
    const layout: LayoutElement[] = [
      part("k", "kreuzung"),
      crossing("q1", "nirgends"),
      part("a", "gerade-114"),
      part("a", "gerade-114"),
      part("x", "gibt-es-nicht"),
      part("y", "steilkehre"),
      part("z", "kurve-1-45"),
      crossing("q2", "k"),
      crossing("q3", "k"),
    ];
    // q2 (index 7) hat einen gültigen Verweis, aber vor ihr liegen fehlerhafte Elemente: ihre
    // Ankunft wird nicht beurteilt. Genau diese sechs Fehler, kein Ankunftsfehler.
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        { kind: "ungueltigerVerweis", index: 1, id: "q1", ref: "nirgends" },
        { kind: "doppelteElementId", id: "a", indices: [2, 3] },
        { kind: "unbekanntesTeil", index: 4, partId: "gibt-es-nicht" },
        { kind: "nichtPlatzierbar", index: 5, partId: "steilkehre" },
        { kind: "richtungFehlt", index: 6, partId: "kurve-1-45" },
        { kind: "bereitsGequert", index: 8, id: "q3", ref: "k" },
      ],
    });
  });

  test("[REQ-CORE-28] fehlerhafte Querung meldet nie zusätzlich einen Ankunftsfehler", () => {
    // Querung mit ungültigem Verweis an einer Stelle, an der eine Ankunft falsch wäre
    const layout = [
      ...replaceAt(ACHT, 4, part("e5", "gerade-171")).slice(0, 5),
      crossing("e6", "e2"),
      ...ACHT.slice(6),
    ];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "ungueltigerVerweis", index: 5, id: "e6", ref: "e2" }],
    });
  });

  test("[REQ-CORE-29] doppelte Element-ID: Fehler mit der ID und allen Positionen", () => {
    const layout = [
      part("a", "gerade-114"),
      part("b", "gerade-114"),
      part("a", "gerade-114"),
      part("c", "gerade-114"),
      part("a", "gerade-114"),
      part("c", "gerade-114"),
    ];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        { kind: "doppelteElementId", id: "a", indices: [0, 2, 4] },
        { kind: "doppelteElementId", id: "c", indices: [3, 5] },
      ],
    });
    expect(runClosure(layout, ORIGIN).ok).toBe(false);
  });

  test("[REQ-CORE-29] doppelte Element-ID zwischen Teil-Element und Querung", () => {
    const layout: LayoutElement[] = [...ACHT.slice(0, 5), crossing("e2", "e1")];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "doppelteElementId", id: "e2", indices: [1, 5] }],
    });
  });

  test("[REQ-CORE-29] [REQ-CORE-28] doppelte ID vor der Querung: Ankunft wird nicht mehr beurteilt", () => {
    // e3 trägt die ID von e2; Nr. 5 ist Gerade 171, die Ankunft wäre also falsch
    const layout = replaceAt(
      replaceAt(ACHT, 4, part("e5", "gerade-171")),
      2,
      part("e2", "kurve-1-90", "rechts"),
    );
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "doppelteElementId", id: "e2", indices: [1, 2] }],
    });
  });

  test("[REQ-CORE-29] [REQ-CORE-28] doppelte ID erst hinter der Querung: Ankunft wird beurteilt", () => {
    // e8 trägt die ID von e7 (beide hinter der Querung); Nr. 5 ist Gerade 171
    const layout = replaceAt(
      replaceAt(ACHT, 4, part("e5", "gerade-171")),
      7,
      part("e7", "kurve-1-90", "links"),
    );
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        {
          kind: "ankunftNichtAmQueranschluss",
          index: 5,
          id: "e6",
          ref: "e1",
          arrival: P(171, 0, 2),
        },
        { kind: "doppelteElementId", id: "e7", indices: [6, 7] },
      ],
    });
  });

  test("[REQ-CORE-29] [REQ-CORE-28] Querung trägt eine doppelte ID: kein Ankunftsfehler", () => {
    // Die Querung selbst teilt ihre ID mit einem Element hinter ihr; vor ihr ist alles fehlerfrei,
    // ihre Ankunft (Gerade 171) wäre falsch. Sie ist fehlerhaft und wird nicht beurteilt.
    const layout = replaceAt(
      replaceAt(ACHT, 4, part("e5", "gerade-171")),
      6,
      part("e6", "anschlussstueck"),
    );
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "doppelteElementId", id: "e6", indices: [5, 6] }],
    });
  });
});

describe("Kern: Abnahmefall Acht", () => {
  test("[REQ-CORE-30] Acht aus (0, 0, 0): jede Zwischenpose wie in der Tabelle, geschlossen", () => {
    const r = okTrace(runTrace(ACHT, ORIGIN));
    expect(r.steps).toEqual(
      ACHT_POSES.map((pose, i) =>
        i === 0 ? { pose, crossPorts: { left: P(171, 57, 6), right: P(171, -57, 2) } } : { pose },
      ),
    );
    expect(r.end).toEqual(P(0, 0, 0));
    expect(runClosure(ACHT, ORIGIN)).toEqual(closedAt0());
  });

  test("[REQ-CORE-30] Acht gespiegelt: Zwischenposen wie in der Tabelle, geschlossen", () => {
    const mirrored = flipTurns(ACHT);
    const r = okTrace(runTrace(mirrored, ORIGIN));
    expect(r.steps.map((s) => s.pose)).toEqual(ACHT_MIRRORED_POSES);
    expect(runClosure(mirrored, ORIGIN)).toEqual(closedAt0());
  });

  test("[REQ-CORE-30] Acht schließt aus beliebiger Startpose, auch gespiegelt", () => {
    fc.assert(
      fc.property(arbStart(), fc.boolean(), (start, mirrored) => {
        const layout = mirrored ? flipTurns(ACHT) : ACHT;
        expect(runClosure(layout, start)).toEqual(closedAt0());
      }),
    );
  });

  test("[REQ-CORE-30] Verbrauch der Acht: Kreuzung 1, Kurve 1/90° 6, Gerade 114 1, Anschlussstück 1", () => {
    expect(core.consumption(cat(), ACHT)).toEqual({
      ok: true,
      counts: { kreuzung: 1, "kurve-1-90": 6, "gerade-114": 1, anschlussstueck: 1 },
    });
  });

  test("[REQ-CORE-31] (a) Gerade 171 statt 114 vor der Querung: Ankunft nicht am Queranschluss", () => {
    const layout = replaceAt(ACHT, 4, part("e5", "gerade-171"));
    const expected = {
      ok: false,
      errors: [
        {
          kind: "ankunftNichtAmQueranschluss",
          index: 5,
          id: "e6",
          ref: "e1",
          arrival: P(171, 0, 2),
        },
      ],
    };
    expect(runTrace(layout, ORIGIN)).toEqual(expected);
    expect(runClosure(layout, ORIGIN)).toEqual(expected);
  });

  test("[REQ-CORE-31] (b) Querung entfernt: offen, Versatz (0, 114), Winkel 0", () => {
    const layout = [...ACHT.slice(0, 5), ...ACHT.slice(6)];
    expect(runClosure(layout, ORIGIN)).toEqual(open(ZERO, C(114), 0));
  });

  test("[REQ-CORE-31] (c) Querung verweist auf Nr. 2 (Kurve): ungültiger Verweis", () => {
    const layout = replaceAt(ACHT, 5, crossing("e6", "e2"));
    const expected = {
      ok: false,
      errors: [{ kind: "ungueltigerVerweis", index: 5, id: "e6", ref: "e2" }],
    };
    expect(runTrace(layout, ORIGIN)).toEqual(expected);
    expect(runClosure(layout, ORIGIN)).toEqual(expected);
  });

  test("[REQ-CORE-31] (d) zweite Querung derselben Kreuzung direkt hinter Nr. 6: bereits gequert", () => {
    const layout = [...ACHT.slice(0, 6), crossing("e6b", "e1"), ...ACHT.slice(6)];
    // Ankunft der zweiten Querung wäre (171, 57, 2): nicht am Anschluss, wird aber nicht geprüft
    const expected = {
      ok: false,
      errors: [{ kind: "bereitsGequert", index: 6, id: "e6b", ref: "e1" }],
    };
    expect(runTrace(layout, ORIGIN)).toEqual(expected);
    expect(runClosure(layout, ORIGIN)).toEqual(expected);
  });

  test("[REQ-CORE-31] (e) Querung an Position 1 vor der Kreuzung: ungültiger Verweis", () => {
    const layout = [crossing("e6", "e1"), ...ACHT.slice(0, 5), ...ACHT.slice(6)];
    const expected = {
      ok: false,
      errors: [{ kind: "ungueltigerVerweis", index: 0, id: "e6", ref: "e1" }],
    };
    expect(runTrace(layout, ORIGIN)).toEqual(expected);
    expect(runClosure(layout, ORIGIN)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// Teileverbrauch
// ---------------------------------------------------------------------------------------------

const KNOWN_IDS = [...STRAIGHT_IDS, ...CURVE_IDS, ...NON_PLACEABLE_IDS] as const;
const arbAnyElement = (prefix: string): fc.Arbitrary<LayoutElement[]> =>
  fc
    .array(
      fc.oneof(
        fc
          .tuple(fc.constantFrom(...KNOWN_IDS), fc.option(arbTurn, { nil: undefined }))
          .map(([p, turn]): Omit<PartElement, "id"> | { crosses: string } =>
            turn === undefined ? { part: p } : { part: p, turn },
          ),
        fc.string().map((ref) => ({ crosses: ref })),
      ),
      { maxLength: 15 },
    )
    .map((els) =>
      els.map((el, i) =>
        "crosses" in el
          ? crossing(`${prefix}${i}`, el.crosses)
          : part(`${prefix}${i}`, el.part, el.turn),
      ),
    );
const countsOf = (els: ReadonlyArray<LayoutElement>): Readonly<Record<string, number>> => {
  const r = core.consumption(cat(), els);
  if (!r.ok) throw new Error(`Verbrauch meldet Fehler: ${JSON.stringify(r.errors)}`);
  return r.counts;
};

describe("Teileverbrauch", () => {
  test("[REQ-CORE-20] Baugruppen werden aufgelöst: Steilkehre + Kurve 1/90° und Looping", () => {
    expect(
      core.consumption(cat(), [part("a", "steilkehre"), part("b", "kurve-1-90", "links")]),
    ).toEqual({ ok: true, counts: { "kurve-1-90": 3, "steilkehre-teil": 4 } });
    expect(core.consumption(cat(), [part("a", "looping")])).toEqual({
      ok: true,
      counts: { "looping-teil": 8 },
    });
  });

  test("[REQ-CORE-20] je Katalogeintrag die Anzahl, Querung verbraucht nichts, Kreuzung einmal", () => {
    const layout: LayoutElement[] = [
      part("a", "gerade-342"),
      part("b", "gerade-342"),
      part("k", "kreuzung"),
      crossing("q", "k"),
      part("c", "spurwechselkurve", "rechts"),
      part("d", "kurve-1-90", "links"),
      part("e", "rundenzaehler"),
    ];
    expect(core.consumption(cat(), layout)).toEqual({
      ok: true,
      counts: {
        "gerade-342": 2,
        kreuzung: 1,
        spurwechselkurve: 1,
        "kurve-1-90": 1,
        rundenzaehler: 1,
      },
    });
    expect(core.consumption(cat(), [])).toEqual({ ok: true, counts: {} });
  });

  test("[REQ-CORE-21] Verbrauch auch mit nicht platzierbaren Einträgen definiert", () => {
    expect(
      core.consumption(cat(), [
        part("a", "steilkurve-1-45"),
        part("b", "wireless-anschluss"),
        part("c", "looping-teil"),
        part("d", "steilkehre-teil"),
      ]),
    ).toEqual({
      ok: true,
      counts: {
        "steilkurve-1-45": 1,
        "wireless-anschluss": 1,
        "looping-teil": 1,
        "steilkehre-teil": 1,
      },
    });
  });

  test("[REQ-CORE-21] unbekannte Teil-IDs sind Fehler, alle gemeldet", () => {
    const r = core.consumption(cat(), [
      part("a", "gerade-342"),
      part("b", "gibt-es-nicht"),
      part("c", "kurve-1-90", "links"),
      part("d", "auch-nicht"),
    ]);
    if (r.ok) throw new Error("Fehler erwartet");
    expect([...r.errors].sort((p, q) => p.index - q.index)).toEqual([
      { kind: "unbekanntesTeil", index: 1, partId: "gibt-es-nicht" },
      { kind: "unbekanntesTeil", index: 3, partId: "auch-nicht" },
    ]);
  });

  test("[REQ-CORE-21] Richtungen werden für den Verbrauch nicht geprüft, fehlend oder überzählig", () => {
    expect(
      core.consumption(cat(), [
        part("a", "kurve-1-90"),
        part("b", "gerade-342", "links"),
        part("c", "kreuzung", "rechts"),
        part("d", "steilkehre", "links"),
        part("e", "kurve-2-45"),
      ]),
    ).toEqual({
      ok: true,
      counts: {
        "kurve-1-90": 3,
        "gerade-342": 1,
        kreuzung: 1,
        "steilkehre-teil": 4,
        "kurve-2-45": 1,
      },
    });
  });

  test("[REQ-CORE-21] Verweise und Element-IDs von Querungen werden für den Verbrauch nicht geprüft", () => {
    const layout: LayoutElement[] = [
      crossing("q", "nirgends"),
      part("a", "gerade-114"),
      part("a", "gerade-114"),
      crossing("q", "a"),
      crossing("r", "r"),
    ];
    expect(core.consumption(cat(), layout)).toEqual({ ok: true, counts: { "gerade-114": 2 } });
  });

  test("[REQ-CORE-22] unabhängig von Reihenfolge, Kurvenrichtung und Element-IDs", () => {
    fc.assert(
      fc.property(arbAnyElement("p"), fc.array(fc.nat()), (layout, keys) => {
        const base = countsOf(layout);
        const shuffled = layout
          .map((el, i) => ({ el, k: keys[i] ?? i }))
          .sort((p, q) => p.k - q.k)
          .map((x) => x.el);
        expect(countsOf(shuffled)).toEqual(base);
        expect(countsOf(flipTurns(layout))).toEqual(base);
        const renamed = layout.map((el) =>
          isCrossing(el)
            ? crossing(`x-${el.id}`, `y-${el.crosses}`)
            : part(`x-${el.id}`, el.part, el.turn),
        );
        expect(countsOf(renamed)).toEqual(base);
      }),
    );
  });

  test("[REQ-CORE-22] Verbrauch zweier hintereinandergehängter Layouts ist die Summe", () => {
    fc.assert(
      fc.property(arbAnyElement("a"), arbAnyElement("b"), (first, second) => {
        const sum: Record<string, number> = { ...countsOf(first) };
        for (const [k, v] of Object.entries(countsOf(second))) sum[k] = (sum[k] ?? 0) + v;
        expect(countsOf([...first, ...second])).toEqual(sum);
      }),
    );
  });
});

describe("Testnachtrag M1: Lücken aus #12 und #13", () => {
  test("[REQ-CORE-26] [REQ-CORE-28] zweite Querung nach gescheiterter erster: ankunftNichtAmQueranschluss und bereitsGequert", () => {
    // Kreuzung, drei Kurven rechts, Gerade 171: Ankunft (171, 0, 2), nicht an (171, ±57)
    const layout = [
      part("k", "kreuzung"),
      ...ids("c", repeat(3, "kurve-1-90", "rechts")),
      part("g", "gerade-171"),
      crossing("q1", "k"),
      crossing("q2", "k"),
    ];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [
        {
          kind: "ankunftNichtAmQueranschluss",
          index: 5,
          id: "q1",
          ref: "k",
          arrival: P(171, 0, 2),
        },
        { kind: "bereitsGequert", index: 6, id: "q2", ref: "k" },
      ],
    });
  });

  test("[REQ-CORE-25] Querung auf Kreuzung mit überzähliger Richtung: nur richtungUeberzaehlig, kein ungültiger Verweis", () => {
    const layout = [part("k", "kreuzung", "links"), crossing("q", "k")];
    expect(runTrace(layout, ORIGIN)).toEqual({
      ok: false,
      errors: [{ kind: "richtungUeberzaehlig", index: 0, partId: "kreuzung" }],
    });
  });
});
