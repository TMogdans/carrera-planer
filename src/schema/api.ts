/**
 * Datenvertrag der API (Spec M3b Teil A, REQ-API-1 bis -3): Layoutname, Stände, Anfragen und
 * Fehlerformen als Effect Schema (effect@3). Ohne `@effect/platform`: die `HttpApi`-Definition
 * liegt getrennt in `http-api.ts` (REQ-API-4, Entscheidung 7).
 *
 * Wie in M1/M3a macht jedes Schema Zusatzfelder selbst zum Fehler (parseOptions-Annotation an der
 * Wurzel), unabhängig von den Optionen des Aufrufers.
 */
import { Record, Schema } from "effect";
import { identity } from "effect/Function";
import { InventorySchema, LayoutSchema } from "./schema.js";

const STRICT = { parseOptions: { onExcessProperty: "error" } } as const;

/**
 * Layoutname („Begriffe“): nicht leer, kein Leerraum am Rand, höchstens 200 Zeichen (Länge der
 * JavaScript-Zeichenkette). Jedes andere Zeichen ist erlaubt; nichts wird getrimmt.
 */
export const LayoutNameSchema = Schema.Trimmed.pipe(Schema.minLength(1), Schema.maxLength(200));

/** Versionen: ganze Zahlen; ein Layout beginnt bei 1, der nie gespeicherte Bestand hat 0. */
const LayoutVersion = Schema.Int.pipe(Schema.greaterThanOrEqualTo(1));
const Version = Schema.NonNegativeInt;

/** Zeitpunkt genau in der Form von `Date.prototype.toISOString()` (UTC, Millisekunden, `Z`). */
const isIsoUtc = (value: string): boolean => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};
export const UpdatedAtSchema = Schema.String.pipe(
  Schema.filter(isIsoUtc, {
    arbitrary: () => (fc) => fc.nat().map((ms) => new Date(ms).toISOString()),
  }),
);

/** `defekt` ist ein Grund oder fehlt; JSON kennt kein `undefined` als Wert. */
const Defekt = Schema.optionalToOptional(Schema.String, Schema.String, {
  decode: identity,
  encode: identity,
});

export const LayoutSummarySchema = Schema.Struct({
  name: LayoutNameSchema,
  version: LayoutVersion,
  updatedAt: UpdatedAtSchema,
  defekt: Defekt,
}).annotations(STRICT);

export const LayoutStateSchema = Schema.Struct({
  name: LayoutNameSchema,
  version: LayoutVersion,
  updatedAt: UpdatedAtSchema,
  layout: LayoutSchema,
}).annotations(STRICT);

export const InventoryStateSchema = Schema.Struct({
  version: Version,
  updatedAt: Schema.NullOr(UpdatedAtSchema),
  inventory: InventorySchema,
}).annotations(STRICT);

export const PutLayoutRequestSchema = Schema.Struct({
  expectedVersion: Version,
  layout: LayoutSchema,
}).annotations(STRICT);

export const PutInventoryRequestSchema = Schema.Struct({
  expectedVersion: Version,
  inventory: InventorySchema,
}).annotations(STRICT);

/**
 * Antwort auf ein gelungenes `PUT /api/bestand`: `version` (ab 1) und `updatedAt`, dieselben
 * Felder wie in der Layout-Übersicht.
 */
export const InventoryWrittenSchema = LayoutSummarySchema.pipe(
  Schema.pick("version", "updatedAt"),
).annotations(STRICT);

/**
 * Pfadparameter von `/api/layouts/{name}`: kodiert ist der Name prozentkodiert
 * (`encodeURIComponent`), dekodiert ein Layoutname nach REQ-API-1. So setzt ein Client aus
 * `CarreraApi` auch „Acht / groß“ oder „100%“ richtig in den Pfad.
 */
export const LayoutPathSchema = Schema.Struct({
  name: Schema.compose(Schema.StringFromUriComponent, LayoutNameSchema),
}).annotations(STRICT);

/** Abfrage von `DELETE /api/layouts/{name}?version=n`: genau `version`, ganzzahlig ab 1. */
export const DeleteQuerySchema = Schema.Struct({
  version: Schema.compose(Schema.NumberFromString, LayoutVersion),
}).annotations(STRICT);

/** Antwort von `GET /api/status` (REQ-SRV-3); der Server sendet genau diesen Wert. */
export const STATUS_OK = { status: "ok" } as const;
/** Schema genau dieses Werts: jedes Feld als Literal. */
export const StatusSchema = Schema.Struct(
  Record.map(STATUS_OK, (value) => Schema.Literal(value)),
).annotations(STRICT);

/** Fehlerformen (REQ-API-3): jede mit `_tag`, Zusatzfelder werden abgewiesen. */
export const UngueltigeAnfrage = Schema.TaggedStruct("UngueltigeAnfrage", {
  reason: Schema.String,
}).annotations(STRICT);

/** `name`: der dekodierte Layoutname bzw. bei unbekannten API-Pfaden der Pfad. */
export const NichtGefunden = Schema.TaggedStruct("NichtGefunden", {
  name: Schema.String,
}).annotations(STRICT);

export const VersionKonflikt = Schema.TaggedStruct("VersionKonflikt", {
  expectedVersion: Version,
  aktuell: Schema.NullOr(Schema.Union(LayoutStateSchema, InventoryStateSchema)),
}).annotations(STRICT);

/** `ziel`: der Layoutname oder `"bestand"`. */
export const GespeichertUngueltig = Schema.TaggedStruct("GespeichertUngueltig", {
  ziel: Schema.String,
  version: Version,
  reason: Schema.String,
}).annotations(STRICT);

export const ZuGross = Schema.TaggedStruct("ZuGross", {}).annotations(STRICT);

export const FremderHost = Schema.TaggedStruct("FremderHost", {
  host: Schema.NullOr(Schema.String),
}).annotations(STRICT);

export const ServerFehler = Schema.TaggedStruct("ServerFehler", {
  text: Schema.String,
}).annotations(STRICT);

export type LayoutSummary = typeof LayoutSummarySchema.Type;
export type LayoutState = typeof LayoutStateSchema.Type;
export type InventoryState = typeof InventoryStateSchema.Type;
export type PutLayoutRequest = typeof PutLayoutRequestSchema.Type;
export type PutInventoryRequest = typeof PutInventoryRequestSchema.Type;
