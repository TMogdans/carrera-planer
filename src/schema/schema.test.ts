/**
 * Spec M1 (.specify/specs/m1-rechenkern/spec.md): Datenvertrag, Abnahmetests REQ-SCHEMA-*.
 *
 * Öffentliche API (von spec-to-tests gewählt, wo die Spec sie offen lässt):
 * - `src/schema/index.ts` exportiert zwei Effect-Schemas (effect@3):
 *     CatalogEntrySchema: Schema<CatalogEntry, …>
 *     LayoutSchema: Schema<Layout, …>
 * - CatalogEntry wie im Katalog-Test: { id, name, articleNumbers: string[] (nicht leer) |
 *   "keineEigene", source, certainty: "hoch"|"mittel"|"niedrig", geometry }. Jede Art.-Nr. ist
 *   eine Zeichenkette aus genau 8 ASCII-Ziffern (z. B. "20061602"). geometry ∈
 *   { kind: "gerade", length } | { kind: "kurve", radius, angle: 45|90 }
 *   | { kind: "kreuzung", length, crossLength } | { kind: "masseFehlen" }
 *   | { kind: "baugruppe", parts: [{ part, count }] }.
 * - Layout: { schemaVersion: 1, elements: Element[] }.
 *   Element: Teil-Element { id, part, turn? } (turn: "links" | "rechts") oder Querung
 *   { id, crosses }. Die Element-ID ist eine nicht leere Zeichenkette, im Layout eindeutig.
 *   Die Schema-Version ist das Literal 1.
 * - Abweisen beim Dekodieren mit den Standard-Optionen von Effect
 *   (Schema.decodeUnknownEither(schema)(input) ohne eigene ParseOptions): unbekannte Zusatzfelder
 *   müssen das Schema selbst zum Fehler machen (z. B. über die parseOptions-Annotation
 *   onExcessProperty: "error"), nicht der Aufrufer.
 * - Die Roundtrip-Eigenschaft nutzt Generatoren, die aus den Schemas abgeleitet sind
 *   (Arbitrary.make, Constitution: „Generatoren leiten sich aus dem Schema ab“).
 */
import { Arbitrary, Either, FastCheck, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "./index.js";

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
type LayoutElement =
  | { readonly id: string; readonly part: string; readonly turn?: "links" | "rechts" }
  | { readonly id: string; readonly crosses: string };
type Layout = { readonly schemaVersion: 1; readonly elements: ReadonlyArray<LayoutElement> };

const schemas = schemaModule as unknown as {
  readonly CatalogEntrySchema: Schema.Schema<CatalogEntry, unknown>;
  readonly LayoutSchema: Schema.Schema<Layout, unknown>;
};

const decodeEntry = (input: unknown) =>
  Schema.decodeUnknownEither(schemas.CatalogEntrySchema)(input);
const decodeLayout = (input: unknown) => Schema.decodeUnknownEither(schemas.LayoutSchema)(input);
const accepted = (r: Either.Either<unknown, unknown>): boolean => Either.isRight(r);

const ENTRY: CatalogEntry = {
  id: "gerade-342",
  name: "Gerade 342",
  articleNumbers: ["20061602"],
  source: "CT",
  certainty: "hoch",
  geometry: { kind: "gerade", length: 342 },
};
const withoutKey = (o: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const LAYOUT: Layout = {
  schemaVersion: 1,
  elements: [
    { id: "e1", part: "kreuzung" },
    { id: "e2", part: "kurve-1-90", turn: "rechts" },
    { id: "e3", part: "gerade-114" },
    { id: "e4", crosses: "e1" },
    { id: "e5", part: "kurve-1-90", turn: "links" },
  ],
};

describe("Katalog-Schema", () => {
  test.skip("[REQ-SCHEMA-1] akzeptiert alle Geometriearten mit den Feldern aus REQ-CAT-2", () => {
    const geometries: ReadonlyArray<Geometry> = [
      { kind: "gerade", length: 342 },
      { kind: "kurve", radius: 171, angle: 90 },
      { kind: "kurve", radius: 285, angle: 45 },
      { kind: "kreuzung", length: 342, crossLength: 114 },
      { kind: "masseFehlen" },
      {
        kind: "baugruppe",
        parts: [
          { part: "steilkehre-teil", count: 4 },
          { part: "kurve-1-90", count: 2 },
        ],
      },
    ];
    for (const geometry of geometries) {
      const entry = { ...ENTRY, geometry };
      const r = decodeEntry(entry);
      expect(accepted(r)).toBe(true);
      if (Either.isRight(r)) expect(r.right).toEqual(entry);
    }
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: "keineEigene" }))).toBe(true);
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: ["20061530", "20061666"] }))).toBe(
      true,
    );
    for (const certainty of ["hoch", "mittel", "niedrig"]) {
      expect(accepted(decodeEntry({ ...ENTRY, certainty }))).toBe(true);
    }
  });

  test.skip("[REQ-SCHEMA-1] weist Einträge ohne Quelle, ohne Sicherheit oder ohne andere Pflichtfelder ab", () => {
    for (const key of ["id", "name", "articleNumbers", "source", "certainty", "geometry"]) {
      expect({ key, accepted: accepted(decodeEntry(withoutKey(ENTRY, key))) }).toEqual({
        key,
        accepted: false,
      });
    }
    expect(accepted(decodeEntry({ ...ENTRY, certainty: "sehr hoch" }))).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: "keine" }))).toBe(false);
  });

  test.skip("[REQ-SCHEMA-1] weist Art.-Nr. ab, die nicht aus genau 8 Ziffern bestehen", () => {
    const invalid: ReadonlyArray<unknown> = [
      ["61602"],
      ["2006160a"],
      ["200616020"],
      ["2006160"],
      [""],
      [" 20061602"],
      ["20061602 "],
      ["2006-1602"],
      ["２００６１６０２"],
      [20061602],
      ["20061530", "61666"],
      [],
      "20061602",
    ];
    for (const articleNumbers of invalid) {
      expect({
        articleNumbers,
        accepted: accepted(decodeEntry({ ...ENTRY, articleNumbers })),
      }).toEqual({ articleNumbers, accepted: false });
    }
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: ["00000000"] }))).toBe(true);
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: ["20088107"] }))).toBe(true);
  });

  test.skip("[REQ-SCHEMA-1] weist Kurven mit einem anderen Winkel als 45° oder 90° ab", () => {
    for (const angle of [0, 22.5, 30, 60, 135, 180, 360, -45, "45"]) {
      const entry = { ...ENTRY, geometry: { kind: "kurve", radius: 171, angle } };
      expect({ angle, accepted: accepted(decodeEntry(entry)) }).toEqual({ angle, accepted: false });
    }
  });

  test.skip("[REQ-SCHEMA-1] Bestandteile einer Baugruppe brauchen Teil-ID und Anzahl ≥ 1", () => {
    const assembly = (parts: unknown) => ({ ...ENTRY, geometry: { kind: "baugruppe", parts } });
    expect(accepted(decodeEntry(assembly([{ part: "kurve-1-90", count: 1 }])))).toBe(true);
    const invalid: ReadonlyArray<unknown> = [
      [{ part: "kurve-1-90" }],
      [{ part: "kurve-1-90", count: 0 }],
      [{ part: "kurve-1-90", count: -2 }],
      [{ part: "kurve-1-90", count: 1.5 }],
      [{ part: "kurve-1-90", count: "2" }],
      [{ count: 2 }],
      [{ part: "", count: 2 }],
      [{ part: 7, count: 2 }],
      [5],
      ["kurve-1-90"],
      [null],
      [{}],
      [{ part: "kurve-1-90", count: 2 }, { part: "steilkehre-teil" }],
      [],
    ];
    for (const parts of invalid) {
      expect({ parts, accepted: accepted(decodeEntry(assembly(parts))) }).toEqual({
        parts,
        accepted: false,
      });
    }
  });

  test.skip("[REQ-SCHEMA-3] Bestandteil einer Baugruppe mit unbekanntem Zusatzfeld wird abgewiesen", () => {
    const entry = {
      ...ENTRY,
      geometry: { kind: "baugruppe", parts: [{ part: "kurve-1-90", count: 2, hoehe: 1 }] },
    };
    expect(accepted(decodeEntry(entry))).toBe(false);
  });

  test.skip("[REQ-SCHEMA-1] Kreuzung braucht Längs- und Querweglänge, Baugruppe ihre Bestandteile", () => {
    expect(accepted(decodeEntry({ ...ENTRY, geometry: { kind: "kreuzung", length: 342 } }))).toBe(
      false,
    );
    expect(
      accepted(decodeEntry({ ...ENTRY, geometry: { kind: "kreuzung", crossLength: 114 } })),
    ).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, geometry: { kind: "baugruppe" } }))).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, geometry: { kind: "gerade" } }))).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, geometry: { kind: "kurve", angle: 90 } }))).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, geometry: { kind: "unbekannt" } }))).toBe(false);
  });
});

describe("Layout-Schema", () => {
  test.skip("[REQ-SCHEMA-2] Layout mit Schema-Version und Teil-Elementen und Querungen", () => {
    const r = decodeLayout(LAYOUT);
    expect(accepted(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right).toEqual(LAYOUT);
    expect(accepted(decodeLayout({ schemaVersion: 1, elements: [] }))).toBe(true);
  });

  test.skip("[REQ-SCHEMA-2] Element-ID ist eine nicht leere Zeichenkette, Richtung nur links/rechts", () => {
    const one = (el: unknown) => ({ schemaVersion: 1, elements: [el] });
    expect(accepted(decodeLayout(one({ id: "a", part: "gerade-342" })))).toBe(true);
    expect(accepted(decodeLayout(one({ id: "a", part: "kurve-1-90", turn: "links" })))).toBe(true);
    expect(accepted(decodeLayout(one({ id: "a", crosses: "b" })))).toBe(true);
    expect(accepted(decodeLayout(one({ part: "gerade-342" })))).toBe(false);
    expect(accepted(decodeLayout(one({ id: "a" })))).toBe(false);
    expect(accepted(decodeLayout(one({ id: "a", part: "kurve-1-90", turn: "geradeaus" })))).toBe(
      false,
    );
  });

  test.skip("[REQ-SCHEMA-3] fehlende oder fremde Schema-Version wird abgewiesen", () => {
    expect(accepted(decodeLayout({ elements: [] }))).toBe(false);
    for (const schemaVersion of [0, 2, "1", null, 1.5]) {
      expect({
        schemaVersion,
        accepted: accepted(decodeLayout({ schemaVersion, elements: [] })),
      }).toEqual({ schemaVersion, accepted: false });
    }
  });

  test.skip("[REQ-SCHEMA-3] unbekannte Zusatzfelder werden abgewiesen, nicht still entfernt", () => {
    expect(accepted(decodeLayout({ ...LAYOUT, name: "Acht" }))).toBe(false);
    expect(
      accepted(
        decodeLayout({ schemaVersion: 1, elements: [{ id: "a", part: "gerade-342", hoehe: 1 }] }),
      ),
    ).toBe(false);
    expect(
      accepted(decodeLayout({ schemaVersion: 1, elements: [{ id: "a", crosses: "b", x: 0 }] })),
    ).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, gewicht: 12 }))).toBe(false);
    expect(
      accepted(decodeEntry({ ...ENTRY, geometry: { kind: "gerade", length: 342, breite: 114 } })),
    ).toBe(false);
  });

  test.skip("[REQ-SCHEMA-3] falsch getypte Felder werden abgewiesen", () => {
    const cases: ReadonlyArray<unknown> = [
      { schemaVersion: 1, elements: {} },
      { schemaVersion: 1, elements: "e1" },
      { schemaVersion: 1, elements: [{ id: 1, part: "gerade-342" }] },
      { schemaVersion: 1, elements: [{ id: "a", part: 342 }] },
      { schemaVersion: 1, elements: [{ id: "a", crosses: 1 }] },
      { schemaVersion: 1, elements: [{ id: "a", part: "kurve-1-90", turn: true }] },
      { schemaVersion: 1, elements: [null] },
      null,
      [],
    ];
    for (const input of cases) {
      expect({ input, accepted: accepted(decodeLayout(input)) }).toEqual({
        input,
        accepted: false,
      });
    }
    expect(accepted(decodeEntry({ ...ENTRY, geometry: { kind: "gerade", length: "342" } }))).toBe(
      false,
    );
    expect(accepted(decodeEntry({ ...ENTRY, source: 42 }))).toBe(false);
  });

  test.skip("[REQ-SCHEMA-4] Kodieren und Dekodieren eines gültigen Layouts ergibt denselben Wert", () => {
    const roundtrip = (v: Layout): Layout =>
      Schema.decodeUnknownSync(schemas.LayoutSchema)(Schema.encodeSync(schemas.LayoutSchema)(v));
    expect(roundtrip(LAYOUT)).toEqual(LAYOUT);
    FastCheck.assert(
      FastCheck.property(Arbitrary.make(schemas.LayoutSchema), (layout) => {
        expect(roundtrip(layout)).toEqual(layout);
      }),
    );
  });

  test.skip("[REQ-SCHEMA-4] Kodieren und Dekodieren eines gültigen Katalogeintrags ergibt denselben Wert", () => {
    const roundtrip = (v: CatalogEntry): CatalogEntry =>
      Schema.decodeUnknownSync(schemas.CatalogEntrySchema)(
        Schema.encodeSync(schemas.CatalogEntrySchema)(v),
      );
    expect(roundtrip(ENTRY)).toEqual(ENTRY);
    FastCheck.assert(
      FastCheck.property(Arbitrary.make(schemas.CatalogEntrySchema), (entry) => {
        expect(roundtrip(entry)).toEqual(entry);
      }),
    );
  });

  test.skip("[REQ-SCHEMA-5] doppelte oder leere Element-ID wird abgewiesen", () => {
    expect(
      accepted(
        decodeLayout({
          schemaVersion: 1,
          elements: [
            { id: "a", part: "gerade-342" },
            { id: "b", part: "gerade-342" },
            { id: "a", part: "gerade-171" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      accepted(
        decodeLayout({
          schemaVersion: 1,
          elements: [
            { id: "k", part: "kreuzung" },
            { id: "k", crosses: "k" },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      accepted(decodeLayout({ schemaVersion: 1, elements: [{ id: "", part: "gerade-342" }] })),
    ).toBe(false);
    expect(accepted(decodeLayout({ schemaVersion: 1, elements: [{ id: "", crosses: "k" }] }))).toBe(
      false,
    );
  });

  test.skip("[REQ-SCHEMA-5] Querung mit Teil-ID oder Richtung, Teil-Element mit Verweis werden abgewiesen", () => {
    const one = (el: unknown) => ({
      schemaVersion: 1,
      elements: [{ id: "k", part: "kreuzung" }, el],
    });
    expect(accepted(decodeLayout(one({ id: "q", crosses: "k", part: "kreuzung" })))).toBe(false);
    expect(accepted(decodeLayout(one({ id: "q", crosses: "k", turn: "links" })))).toBe(false);
    expect(accepted(decodeLayout(one({ id: "q", part: "gerade-114", crosses: "k" })))).toBe(false);
    expect(
      accepted(decodeLayout(one({ id: "q", part: "kurve-1-90", turn: "links", crosses: "k" }))),
    ).toBe(false);
  });

  test.skip("[REQ-SCHEMA-5] Ziel und Ankunft einer Querung prüft nicht das Schema, sondern der Kern", () => {
    const layouts: ReadonlyArray<Layout> = [
      { schemaVersion: 1, elements: [{ id: "q", crosses: "gibt-es-nicht" }] },
      {
        schemaVersion: 1,
        elements: [
          { id: "q", crosses: "k" },
          { id: "k", part: "kreuzung" },
        ],
      },
      {
        schemaVersion: 1,
        elements: [
          { id: "g", part: "gerade-342" },
          { id: "q", crosses: "g" },
        ],
      },
    ];
    for (const layout of layouts) {
      const r = decodeLayout(layout);
      expect(accepted(r)).toBe(true);
      if (Either.isRight(r)) expect(r.right).toEqual(layout);
    }
  });
});
