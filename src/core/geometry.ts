/**
 * Exakte Lagearithmetik des Kerns (Spec M1, „Begriffe“; Constitution „Geometrie“).
 *
 * Interne Darstellung: Jede Pose der Spur ist die Startpose plus ein Versatz. Der Versatz wird in
 * Viertel-Millimetern als vier ganze Zahlen (bigint) geführt: x = (xa + xb·√2)/4 mm,
 * y = (ya + yb·√2)/4 mm. Jeder Teilschritt ist ein ganzzahliges Vielfaches von e(j)
 * (Komponenten 0, ±1, ±√2/2) mit ganzzahliger oder halbzahliger mm-Länge, bleibt also in diesem
 * Gitter. Kein Gleitkomma, keine Toleranz: Gleichheit ist Gleichheit der vier Zahlen und der
 * Richtung. Erst an der Schnittstelle wird die Startpose (beliebige Brüche) addiert.
 */
import type { Coord, Dir, Pose, Rational } from "./types.js";

/** Versatz in Viertel-mm: [xa, xb, ya, yb] mit x = (xa + xb·√2)/4, y = (ya + yb·√2)/4. */
export type Vec4 = readonly [bigint, bigint, bigint, bigint];
/** Pose relativ zur Startpose. */
export type State = { readonly v: Vec4; readonly dir: Dir };

/** Richtung modulo 8 (auch für negative Stufen). */
export const toDir = (steps: number): Dir => (steps & 7) as Dir;

/** 2·cos(j·45°) als (a, b) mit Wert a + b·√2. */
const COS2: readonly [
  readonly [bigint, bigint],
  readonly [bigint, bigint],
  readonly [bigint, bigint],
  readonly [bigint, bigint],
  readonly [bigint, bigint],
  readonly [bigint, bigint],
  readonly [bigint, bigint],
  readonly [bigint, bigint],
] = [
  [2n, 0n],
  [0n, 1n],
  [0n, 0n],
  [0n, -1n],
  [-2n, 0n],
  [0n, -1n],
  [0n, 0n],
  [0n, 1n],
];

/**
 * Verschiebt um f·2·e(j) Viertel-mm, also um f/2 mm in Richtung j. Eine Strecke von L mm ist
 * f = 2L, eine von L/2 mm ist f = L.
 */
export const shift = (v: Vec4, f: bigint, j: number): Vec4 => {
  const [xa, xb] = COS2[toDir(j)];
  const [ya, yb] = COS2[toDir(j + 6)];
  return [v[0] + f * xa, v[1] + f * xb, v[2] + f * ya, v[3] + f * yb];
};

/** Schlüssel für den exakten Vergleich zweier Posen (Position und Richtung). */
export const key = (s: State): string => `${s.v[0]} ${s.v[1]} ${s.v[2]} ${s.v[3]} ${s.dir}`;

/** q + quarters/4 als Bruch. */
const plusQuarters = (q: Rational, quarters: bigint): Rational => ({
  num: q.num * 4n + quarters * q.den,
  den: q.den * 4n,
});

const plus = (c: Coord, a: bigint, b: bigint): Coord => ({
  a: plusQuarters(c.a, a),
  b: plusQuarters(c.b, b),
});

/** Absolute Pose: Startposition plus Versatz, Richtung schon absolut. */
export const toPose = (start: Pose, s: State): Pose => ({
  x: plus(start.x, s.v[0], s.v[1]),
  y: plus(start.y, s.v[2], s.v[3]),
  dir: s.dir,
});

/** −quarters/4 als Bruch (für den Versatz Ende → Start). */
export const negQuarters = (quarters: bigint): Rational => ({ num: -quarters, den: 4n });
