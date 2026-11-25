/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Wirkungsteil von REQ-SARCH-1 im
 * Datenvertrag. `LayoutSchema`, `InventorySchema`, `CatalogEntrySchema` und `SetTemplateSchema`
 * bleiben unverändert.
 *
 * Wirkungsnachweis statt Dateivergleich: Unten steht eine eingefrorene Abschrift der vier Schemas
 * auf dem Basisstand `9ffe100` (src/schema/schema.ts). Für Werte aus den Generatoren beider
 * Fassungen und für beliebige Werte (`anything`) müssen die aktuellen Schemas genau dieselben
 * Werte annehmen bzw. abweisen und angenommene Werte gleich kodieren. Ändert Teil A ein Schema
 * (neues Pflichtfeld, gelockerter Filter, Zusatzfelder erlaubt …), weicht das Verhalten ab.
 *
 * Der übrige Teil von REQ-SARCH-1 (keine Datei unter src/core, src/catalog, src/web geändert, alle
 * Tests von M1 bis plan-beschriftung-symbole unverändert grün, typecheck/lint/test grün) ist ein
 * Diff- bzw. CI-Nachweis: das CI-Tier aus dem tatsächlichen Diff und der vollständige Testlauf.
 */
import { Arbitrary, Either, FastCheck, Schema } from "effect";
import { identity } from "effect/Function";
import { describe, expect, test } from "vitest";
import * as schemaModule from "./index.js";

// ---------------------------------------------------------------------------------------------
// Eingefrorene Abschrift, Basisstand 9ffe100 (nicht anpassen; eine gewollte Schemaänderung ist
// eine Spec-Änderung und ändert dann diesen Test über spec-to-tests)
// ---------------------------------------------------------------------------------------------

const STRICT = { parseOptions: { onExcessProperty: "error" } } as const;
const Millimeters = Schema.Int.pipe(Schema.positive());
const ArticleNumber = Schema.String.pipe(Schema.pattern(/^[0-9]{8}$/));
const Certainty = Schema.Literal("hoch", "mittel", "niedrig");
const Geometry = Schema.Union(
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
const Praegung = Schema.Struct({
  value: Schema.NonEmptyTrimmedString.pipe(
    Schema.filter((v): boolean => !Schema.is(ArticleNumber)(v)),
  ),
  source: Schema.NonEmptyString,
  certainty: Certainty,
});
const Praegungen = Schema.NonEmptyArray(Praegung);
const FrozenCatalogEntry = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  articleNumbers: Schema.Union(Schema.NonEmptyArray(ArticleNumber), Schema.Literal("keineEigene")),
  source: Schema.NonEmptyString,
  certainty: Certainty,
  geometry: Geometry,
  praegung: Schema.optionalToOptional(Praegungen, Praegungen, {
    decode: identity,
    encode: identity,
  }),
}).annotations(STRICT);
const ElementId = Schema.NonEmptyString;
const PartElement = Schema.Struct({
  id: ElementId,
  part: Schema.String,
  turn: Schema.optional(Schema.Literal("links", "rechts")),
});
const CrossingElement = Schema.Struct({ id: ElementId, crosses: Schema.String });
const uniqueIds = (elements: ReadonlyArray<{ readonly id: string }>): boolean =>
  new Set(elements.map((element) => element.id)).size === elements.length;
const FrozenLayout = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  elements: Schema.Array(Schema.Union(PartElement, CrossingElement)).pipe(Schema.filter(uniqueIds)),
}).annotations(STRICT);
const FrozenInventory = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  counts: Schema.Record({ key: Schema.NonEmptyString, value: Schema.NonNegativeInt }),
}).annotations(STRICT);
const FrozenSetTemplate = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  articleNumber: ArticleNumber,
  source: Schema.NonEmptyString,
  certainty: Certainty,
  contents: Schema.NonEmptyArray(
    Schema.Struct({
      part: Schema.NonEmptyString,
      count: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
    }),
  ),
}).annotations(STRICT);

// ---------------------------------------------------------------------------------------------

type AnySchema = Schema.Schema<unknown, unknown>;
const current = schemaModule as unknown as Record<string, AnySchema | undefined>;

const PAIRS: ReadonlyArray<readonly [string, AnySchema]> = [
  ["LayoutSchema", FrozenLayout as unknown as AnySchema],
  ["InventorySchema", FrozenInventory as unknown as AnySchema],
  ["CatalogEntrySchema", FrozenCatalogEntry as unknown as AnySchema],
  ["SetTemplateSchema", FrozenSetTemplate as unknown as AnySchema],
];

/** Zusatzfeld an einem gültigen Wert: muss in beiden Fassungen gleich behandelt werden. */
const withExtra = (v: unknown): unknown =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? { ...v, zusatz: 1 } : v;

describe("Unveränderte Schemas", () => {
  test("[REQ-SARCH-1] LayoutSchema, InventorySchema, CatalogEntrySchema und SetTemplateSchema verhalten sich wie auf dem Basisstand (Annehmen, Abweisen, Kodieren)", () => {
    for (const [name, frozen] of PAIRS) {
      const now = current[name];
      expect(now, `${name} wird weiter exportiert`).toBeDefined();
      const schema = now as AnySchema;
      const values = FastCheck.oneof(
        Arbitrary.make(frozen),
        Arbitrary.make(schema),
        Arbitrary.make(frozen).map(withExtra),
        FastCheck.anything(),
      );
      FastCheck.assert(
        FastCheck.property(values, (input) => {
          const a = Schema.decodeUnknownEither(frozen)(input);
          const b = Schema.decodeUnknownEither(schema)(input);
          expect(Either.isRight(b), `${name}: ${JSON.stringify(input)}`).toBe(Either.isRight(a));
          if (Either.isRight(a) && Either.isRight(b)) {
            expect(Schema.encodeSync(schema)(b.right)).toEqual(Schema.encodeSync(frozen)(a.right));
          }
        }),
        { numRuns: 300 },
      );
    }
  });
});
