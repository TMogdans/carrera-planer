/**
 * Spec M1 (.specify/specs/m1-rechenkern/spec.md): Teilekatalog, Abnahmetests REQ-CAT-*.
 *
 * Öffentliche API (von spec-to-tests gewählt, wo die Spec sie offen lässt):
 * - `src/catalog/index.ts` exportiert `CATALOG: ReadonlyArray<CatalogEntry>`.
 * - CatalogEntry = { id, name, articleNumbers, source, certainty, geometry }
 *     articleNumbers: nicht leere Liste achtstelliger Ziffernfolgen als String (z. B. "20061602")
 *       oder "keineEigene" (Spec: „eine oder mehrere,
 *       oder ausdrücklich ‚keine eigene‘“)
 *     certainty: "hoch" | "mittel" | "niedrig"
 *     geometry: { kind: "gerade", length } | { kind: "kurve", radius, angle: 45 | 90 }
 *             | { kind: "kreuzung", length, crossLength } | { kind: "masseFehlen" }
 *             | { kind: "baugruppe", parts: [{ part, count }] }   (Baugruppe = Maße fehlen)
 *   Längen und Radien in mm als ganze Zahlen (number). Platzierbar heißt: geometry.kind ist
 *   gerade, kurve oder kreuzung; ein eigenes Feld dafür gibt es nicht (es könnte der Geometrie
 *   widersprechen).
 * - IDs (stabil): siehe Tabelle EXPECTED unten; sie sind Teil des Vertrags mit Kern und Layouts.
 * - Das Katalog-Schema kommt aus `src/schema/index.ts` als `CatalogEntrySchema` (Effect Schema).
 */
import { Either, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "../schema/index.js";
import * as catalogModule from "./index.js";

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

const catalogApi = catalogModule as unknown as { readonly CATALOG: ReadonlyArray<CatalogEntry> };
const schemaApi = schemaModule as unknown as {
  readonly CatalogEntrySchema: Schema.Schema<CatalogEntry, unknown>;
};
const cat = (): ReadonlyArray<CatalogEntry> => catalogApi.CATALOG;

/**
 * Tabelle „Katalog M1“ der Spec. Art.-Nr. immer als volle achtstellige Nummer des Einzelartikels
 * (REQ-CAT-2), z. B. „20061602“; Wireless-Anschluss 20061673 (Einzelartikel, nicht das Set).
 */
type Expected = {
  readonly id: string;
  readonly articleNumbers: ReadonlyArray<string> | "keineEigene";
  readonly geometry: Geometry;
  readonly certainty: Certainty;
};
const EXPECTED: ReadonlyArray<Expected> = [
  {
    id: "gerade-342",
    articleNumbers: ["20061602"],
    geometry: { kind: "gerade", length: 342 },
    certainty: "hoch",
  },
  {
    id: "gerade-171",
    articleNumbers: ["20061656"],
    geometry: { kind: "gerade", length: 171 },
    certainty: "hoch",
  },
  {
    id: "gerade-114",
    articleNumbers: ["20061658"],
    geometry: { kind: "gerade", length: 114 },
    certainty: "hoch",
  },
  {
    id: "kurve-1-90",
    articleNumbers: ["20061603"],
    geometry: { kind: "kurve", radius: 171, angle: 90 },
    certainty: "hoch",
  },
  {
    id: "kurve-1-45",
    articleNumbers: ["20061611"],
    geometry: { kind: "kurve", radius: 171, angle: 45 },
    certainty: "hoch",
  },
  {
    id: "kurve-2-45",
    articleNumbers: ["20061617"],
    geometry: { kind: "kurve", radius: 285, angle: 45 },
    certainty: "mittel",
  },
  {
    id: "kurve-3-45",
    articleNumbers: ["20061645"],
    geometry: { kind: "kurve", radius: 399, angle: 45 },
    certainty: "mittel",
  },
  {
    id: "spurwechselkurve",
    articleNumbers: ["20061655"],
    geometry: { kind: "kurve", radius: 171, angle: 90 },
    certainty: "hoch",
  },
  {
    id: "spurwechsel-gerade",
    articleNumbers: ["20061609"],
    geometry: { kind: "gerade", length: 228 },
    certainty: "hoch",
  },
  {
    id: "engstelle",
    articleNumbers: ["20061610"],
    geometry: { kind: "gerade", length: 228 },
    certainty: "hoch",
  },
  {
    id: "kreuzung",
    articleNumbers: ["20061616"],
    geometry: { kind: "kreuzung", length: 342, crossLength: 114 },
    certainty: "hoch",
  },
  {
    id: "anschlussstueck",
    articleNumbers: ["20061530", "20061666"],
    geometry: { kind: "gerade", length: 114 },
    certainty: "hoch",
  },
  {
    id: "rundenzaehler",
    articleNumbers: ["20088107"],
    geometry: { kind: "gerade", length: 114 },
    certainty: "hoch",
  },
  {
    id: "wireless-anschluss",
    articleNumbers: ["20061673"],
    geometry: { kind: "masseFehlen" },
    certainty: "niedrig",
  },
  {
    id: "steilkurve-1-45",
    articleNumbers: ["20061612"],
    geometry: { kind: "masseFehlen" },
    certainty: "mittel",
  },
  {
    id: "looping-teil",
    articleNumbers: "keineEigene",
    geometry: { kind: "masseFehlen" },
    certainty: "niedrig",
  },
  {
    id: "steilkehre-teil",
    articleNumbers: "keineEigene",
    geometry: { kind: "masseFehlen" },
    certainty: "niedrig",
  },
  {
    id: "looping",
    articleNumbers: ["20061613"],
    geometry: { kind: "baugruppe", parts: [{ part: "looping-teil", count: 8 }] },
    certainty: "niedrig",
  },
  {
    id: "steilkehre",
    articleNumbers: "keineEigene",
    geometry: {
      kind: "baugruppe",
      parts: [
        { part: "kurve-1-90", count: 2 },
        { part: "steilkehre-teil", count: 4 },
      ],
    },
    certainty: "niedrig",
  },
];
const PLACEABLE = new Set([
  "gerade-342",
  "gerade-171",
  "gerade-114",
  "kurve-1-90",
  "kurve-1-45",
  "kurve-2-45",
  "kurve-3-45",
  "spurwechselkurve",
  "spurwechsel-gerade",
  "engstelle",
  "kreuzung",
  "anschlussstueck",
  "rundenzaehler",
]);

const sortedParts = (g: Geometry): Geometry =>
  g.kind === "baugruppe"
    ? { kind: "baugruppe", parts: [...g.parts].sort((p, q) => p.part.localeCompare(q.part)) }
    : g;
const byId = (id: string): CatalogEntry => {
  const e = cat().find((x) => x.id === id);
  if (e === undefined) throw new Error(`Katalogeintrag ${id} fehlt`);
  return e;
};
const isPlaceable = (e: CatalogEntry): boolean =>
  e.geometry.kind === "gerade" || e.geometry.kind === "kurve" || e.geometry.kind === "kreuzung";

describe("Katalog", () => {
  test.skip("[REQ-CAT-1] enthält genau die Einträge der Tabelle Katalog M1", () => {
    expect(
      cat()
        .map((e) => e.id)
        .sort(),
    ).toEqual(EXPECTED.map((e) => e.id).sort());
  });

  test.skip("[REQ-CAT-1] Geometrie, Art.-Nr. und Sicherheit je Eintrag wie in der Tabelle", () => {
    for (const exp of EXPECTED) {
      const e = byId(exp.id);
      expect({ id: e.id, geometry: sortedParts(e.geometry) }).toEqual({
        id: exp.id,
        geometry: sortedParts(exp.geometry),
      });
      expect({ id: e.id, certainty: e.certainty }).toEqual({
        id: exp.id,
        certainty: exp.certainty,
      });
      const actual =
        e.articleNumbers === "keineEigene" ? e.articleNumbers : [...e.articleNumbers].sort();
      const wanted =
        exp.articleNumbers === "keineEigene" ? exp.articleNumbers : [...exp.articleNumbers].sort();
      expect({ id: e.id, articleNumbers: actual }).toEqual({
        id: exp.id,
        articleNumbers: wanted,
      });
    }
  });

  test.skip("[REQ-CAT-1] Platzierbarkeit wie in der Tabelle: Looping, Steilkehre, Steilkurve, Wireless, K und L nicht", () => {
    for (const e of cat()) {
      expect({ id: e.id, placeable: isPlaceable(e) }).toEqual({
        id: e.id,
        placeable: PLACEABLE.has(e.id),
      });
    }
  });

  test.skip("[REQ-CAT-2] jeder Eintrag hat eindeutige ID, Namen, Art.-Nr., Quelle und Sicherheit", () => {
    const entries = cat();
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const e of entries) {
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(e.source.trim().length).toBeGreaterThan(0);
      expect(["hoch", "mittel", "niedrig"]).toContain(e.certainty);
      if (e.articleNumbers !== "keineEigene") {
        expect(e.articleNumbers.length).toBeGreaterThan(0);
        // volle Nummer des Einzelartikels: genau 8 Ziffern als Zeichenkette, nie Kurzform
        for (const nr of e.articleNumbers) {
          expect({ id: e.id, type: typeof nr }).toEqual({ id: e.id, type: "string" });
          expect(nr).toMatch(/^[0-9]{8}$/);
        }
      }
    }
    expect(new Set(entries.map((e) => e.name)).size).toBe(entries.length);
  });

  test.skip("[REQ-CAT-3] jeder Katalogeintrag besteht die Prüfung gegen das Katalog-Schema", () => {
    for (const e of cat()) {
      const decoded = Schema.decodeUnknownEither(schemaApi.CatalogEntrySchema)(e);
      expect({ id: e.id, valid: Either.isRight(decoded) }).toEqual({ id: e.id, valid: true });
      if (Either.isRight(decoded)) expect(decoded.right).toEqual(e);
    }
  });

  test.skip("[REQ-CAT-4] Bestandteile verweisen auf vorhandene Einträge, Anzahl ≥ 1, keine verschachtelte Baugruppe", () => {
    const ids = new Set(cat().map((e) => e.id));
    const assemblies = cat().filter((e) => e.geometry.kind === "baugruppe");
    expect(assemblies.map((e) => e.id).sort()).toEqual(["looping", "steilkehre"]);
    for (const a of assemblies) {
      if (a.geometry.kind !== "baugruppe") continue;
      expect(a.geometry.parts.length).toBeGreaterThan(0);
      for (const p of a.geometry.parts) {
        expect(ids.has(p.part)).toBe(true);
        expect(Number.isInteger(p.count)).toBe(true);
        expect(p.count).toBeGreaterThanOrEqual(1);
        expect(byId(p.part).geometry.kind).not.toBe("baugruppe");
      }
    }
  });

  test.skip("[REQ-CAT-5] Geometrien platzierbarer Einträge liegen auf dem 57-mm-Raster", () => {
    const multipleOf57 = (v: number): boolean => Number.isInteger(v) && v > 0 && v % 57 === 0;
    for (const e of cat().filter(isPlaceable)) {
      const g = e.geometry;
      if (g.kind === "gerade") {
        expect({ id: e.id, ok: multipleOf57(g.length) }).toEqual({ id: e.id, ok: true });
      } else if (g.kind === "kurve") {
        expect({ id: e.id, ok: multipleOf57(g.radius) }).toEqual({ id: e.id, ok: true });
        expect([45, 90]).toContain(g.angle);
      } else if (g.kind === "kreuzung") {
        expect(multipleOf57(g.length)).toBe(true);
        expect(multipleOf57(g.crossLength)).toBe(true);
        expect(g.crossLength).toBeLessThanOrEqual(g.length);
        // Halbe Längs- und Querweglänge liegen auf dem darstellbaren Raster (Vielfache von
        // 28,5 mm = 57/2) genau dann, wenn die ganzen Längen Vielfache von 57 sind (oben geprüft).
      }
    }
  });
});
