/**
 * Öffentliche Typen des Rechenkerns (Spec M1, API-Vertrag aus src/core/core.test.ts).
 * Nur Typen: der Kern lädt zur Laufzeit weder Effect noch das Schema (REQ-ARCH-1).
 */
export type { CatalogEntry, LayoutElement, Turn } from "../schema/schema.js";

/** Exakter Bruch mit ganzzahligem Zähler und Nenner (Nenner ≠ 0, nicht normalisiert). */
export type Rational = { readonly num: bigint; readonly den: bigint };
/** Koordinate a + b·√2 mm. */
export type Coord = { readonly a: Rational; readonly b: Rational };
/** Richtung in 45°-Stufen: 0 = +x, 2 = +y, links = gegen den Uhrzeigersinn. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Pose = { readonly x: Coord; readonly y: Coord; readonly dir: Dir };

export type CrossPorts = { readonly left: Pose; readonly right: Pose };
export type Step = { readonly pose: Pose; readonly crossPorts?: CrossPorts };

export type TraceError =
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

export type TraceResult =
  | { readonly ok: true; readonly steps: ReadonlyArray<Step>; readonly end: Pose }
  | { readonly ok: false; readonly errors: ReadonlyArray<TraceError> };

export type Offset = { readonly dx: Coord; readonly dy: Coord };
export type Closure =
  | { readonly status: "leer" }
  | { readonly status: "geschlossen"; readonly offset: Offset; readonly angleSteps: number }
  | { readonly status: "offen"; readonly offset: Offset; readonly angleSteps: number };
export type ClosureResult =
  | { readonly ok: true; readonly closure: Closure }
  | { readonly ok: false; readonly errors: ReadonlyArray<TraceError> };

export type UnknownPartError = {
  readonly kind: "unbekanntesTeil";
  readonly index: number;
  readonly partId: string;
};
export type ConsumptionResult =
  | { readonly ok: true; readonly counts: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly errors: ReadonlyArray<UnknownPartError> };
