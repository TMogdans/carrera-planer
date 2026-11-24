/**
 * Datenvertrag M1 (Spec .specify/specs/m1-rechenkern/spec.md, REQ-SCHEMA-1 bis -5): Katalogeintrag
 * und Layout als Effect Schema (effect@3).
 *
 * Unbekannte Zusatzfelder macht das Schema selbst zum Fehler (parseOptions-Annotation
 * `onExcessProperty: "error"` an der Wurzel; sie gilt für alle verschachtelten Strukturen). So
 * scheitern alte oder fremde Daten laut, auch wenn der Aufrufer keine eigenen ParseOptions angibt.
 */
import { Schema } from "effect";
import { identity } from "effect/Function";

const STRICT = { parseOptions: { onExcessProperty: "error" } } as const;

/** Längen und Radien in mm: positive ganze Zahlen. */
const Millimeters = Schema.Int.pipe(Schema.positive());

/** Volle Art.-Nr. des Einzelartikels: genau 8 ASCII-Ziffern als Zeichenkette (REQ-CAT-2). */
const ArticleNumber = Schema.String.pipe(Schema.pattern(/^[0-9]{8}$/));

export const CertaintySchema = Schema.Literal("hoch", "mittel", "niedrig");

export const GeometrySchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("gerade"), length: Millimeters }),
  Schema.Struct({
    kind: Schema.Literal("kurve"),
    radius: Millimeters,
    angle: Schema.Literal(45, 90),
  }),
  Schema.Struct({
    kind: Schema.Literal("kreuzung"),
    length: Millimeters,
    crossLength: Millimeters,
  }),
  Schema.Struct({ kind: Schema.Literal("masseFehlen") }),
  Schema.Struct({
    kind: Schema.Literal("baugruppe"),
    parts: Schema.NonEmptyArray(
      Schema.Struct({
        part: Schema.NonEmptyString,
        count: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
      }),
    ),
  }),
);

/**
 * Prägung (Spec M3a, REQ-PRAEG-1): auf dem Teil eingeprägte Form- oder Teilenummer. Kein Leerraum
 * am Rand und nie eine Artikelnummer (genau 8 Ziffern): die beiden Nummernarten bleiben getrennt.
 */
export const PraegungSchema = Schema.Struct({
  value: Schema.NonEmptyTrimmedString.pipe(
    Schema.filter((v): boolean => !Schema.is(ArticleNumber)(v)),
  ),
  source: Schema.NonEmptyString,
  certainty: CertaintySchema,
});

/**
 * Prägungen als optionales Feld ohne `undefined` als Wert (ein Eintrag hat das Feld oder nicht).
 * Bewusst über `optionalToOptional` mit Identität statt `optionalWith(…, { exact: true })`: JSON
 * kennt kein `undefined`, die Option wäre an Daten nicht beobachtbar.
 */
const Praegungen = Schema.NonEmptyArray(PraegungSchema);

export const CatalogEntrySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  articleNumbers: Schema.Union(Schema.NonEmptyArray(ArticleNumber), Schema.Literal("keineEigene")),
  source: Schema.NonEmptyString,
  certainty: CertaintySchema,
  geometry: GeometrySchema,
  praegung: Schema.optionalToOptional(Praegungen, Praegungen, {
    decode: identity,
    encode: identity,
  }),
}).annotations(STRICT);

export type Certainty = typeof CertaintySchema.Type;
export type Praegung = typeof PraegungSchema.Type;
export type Geometry = typeof GeometrySchema.Type;
export type CatalogEntry = typeof CatalogEntrySchema.Type;

/** Element-ID: nicht leere Zeichenkette, im Layout eindeutig (REQ-SCHEMA-2, REQ-SCHEMA-5). */
const ElementId = Schema.NonEmptyString;

export const TurnSchema = Schema.Literal("links", "rechts");

/** Teil-Element: Teil-ID, bei Kurven Richtung. Ein Verweis (`crosses`) ist ein Zusatzfeld. */
export const PartElementSchema = Schema.Struct({
  id: ElementId,
  part: Schema.String,
  turn: Schema.optional(TurnSchema),
});

/** Querung: Verweis auf die Element-ID einer früheren Kreuzung, sonst nichts. */
export const CrossingElementSchema = Schema.Struct({
  id: ElementId,
  crosses: Schema.String,
});

export const LayoutElementSchema = Schema.Union(PartElementSchema, CrossingElementSchema);

const uniqueIds = (elements: ReadonlyArray<{ readonly id: string }>): boolean =>
  new Set(elements.map((element) => element.id)).size === elements.length;

export const LayoutSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  elements: Schema.Array(LayoutElementSchema).pipe(Schema.filter(uniqueIds)),
}).annotations(STRICT);

export type Turn = typeof TurnSchema.Type;
export type PartElement = typeof PartElementSchema.Type;
export type CrossingElement = typeof CrossingElementSchema.Type;
export type LayoutElement = typeof LayoutElementSchema.Type;
export type Layout = typeof LayoutSchema.Type;

/**
 * Bestand (Spec M3a, REQ-BEST-1): Teil-ID → Anzahl. Das Schema kennt den Katalog nicht; ob eine
 * Teil-ID bekannt und bestandsfähig ist, prüft die Logik (REQ-BEST-7).
 */
export const InventorySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  counts: Schema.Record({ key: Schema.NonEmptyString, value: Schema.NonNegativeInt }),
}).annotations(STRICT);

/** Set-Vorlage (Spec M3a, REQ-SET-1): Packung mit fester Teileliste. */
export const SetTemplateSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  articleNumber: ArticleNumber,
  source: Schema.NonEmptyString,
  certainty: CertaintySchema,
  contents: Schema.NonEmptyArray(
    Schema.Struct({
      part: Schema.NonEmptyString,
      count: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
    }),
  ),
}).annotations(STRICT);

export type Inventory = typeof InventorySchema.Type;
export type SetTemplate = typeof SetTemplateSchema.Type;
