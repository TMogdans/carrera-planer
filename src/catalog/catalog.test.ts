/**
 * Spec M1 (.specify/specs/m1-rechenkern/spec.md): Teilekatalog, Abnahmetests REQ-CAT-*.
 * REQ-CAT-1 und REQ-CAT-5 in der Fassung der Spec gerade-100
 * (.specify/specs/gerade-100/spec.md, „Geänderte Kriterien“): zusätzlich `gerade-100`,
 * `gerade-114` ohne eigene Artikelnummer, 20 Einträge, 14 platzierbar; Geradenlängen auf dem
 * 57-mm-Raster mit genau einer benannten Ausnahme `gerade-100` (100 mm).
 * Nachtrag #1 (Messung 2026-11-28, Tabelle „Katalog M1“): `wireless-anschluss` ist Gerade 114,
 * `steilkurve-1-45` Kurve R 171, 45°, beide Sicherheit hoch und platzierbar; 16 platzierbar.
 *
 * Aufteilung bis zur Umsetzung: Tests mit der neuen Erwartung sind `.skip` (implement entfernt nur
 * das `.skip`); Tests, deren Erwartung vor und nach der Ergänzung gilt, laufen aktiv.
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
 * Tabelle „Katalog M1“ der Spec mit den Änderungen aus „Katalog- und Vorlagen-Änderungen“
 * (gerade-100): `gerade-100` neu direkt nach `gerade-114`, `gerade-114` ohne eigene
 * Artikelnummer (20061658 ist die Packung, keine Teilenummer). Art.-Nr. immer als volle
 * achtstellige Nummer des Einzelartikels (REQ-CAT-2), z. B. „20061602“; Wireless-Anschluss
 * 20061673 (Einzelartikel, nicht das Set). Reihenfolge = Katalogreihenfolge.
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
    articleNumbers: "keineEigene",
    geometry: { kind: "gerade", length: 114 },
    certainty: "hoch",
  },
  {
    id: "gerade-100",
    articleNumbers: "keineEigene",
    geometry: { kind: "gerade", length: 100 },
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
    geometry: { kind: "gerade", length: 114 },
    certainty: "hoch",
  },
  {
    id: "steilkurve-1-45",
    articleNumbers: ["20061612"],
    geometry: { kind: "kurve", radius: 171, angle: 45 },
    certainty: "hoch",
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
  "gerade-100",
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
  "wireless-anschluss",
  "steilkurve-1-45",
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

/** Einträge, die der Nachtrag #1 (Vermessung 2026-11-28) ändert. */
const CHANGED_BY_MEASUREMENT = new Set(["wireless-anschluss", "steilkurve-1-45"]);

/**
 * Prüfung aus REQ-CAT-5 (Fassung gerade-100). Liefert die gefundenen Probleme (leer = in Ordnung).
 * Die einzige Ausnahme vom Raster ist der Eintrag `gerade-100` mit genau 100 mm; eine zweite
 * Gerade abseits des Rasters (auch mit 100 mm unter anderer ID) ist ein Problem.
 */
const rasterProblems = (catalog: ReadonlyArray<CatalogEntry>): string[] => {
  const multipleOf57 = (v: number): boolean => Number.isInteger(v) && v > 0 && v % 57 === 0;
  const problems: string[] = [];
  for (const e of catalog.filter(isPlaceable)) {
    const g = e.geometry;
    if (g.kind === "gerade") {
      const exception = e.id === "gerade-100" && g.length === 100;
      if (!exception && !multipleOf57(g.length)) problems.push(`${e.id}: Länge ${g.length}`);
    } else if (g.kind === "kurve") {
      if (!multipleOf57(g.radius)) problems.push(`${e.id}: Radius ${g.radius}`);
      if (![45, 90].includes(g.angle)) problems.push(`${e.id}: Winkel ${g.angle}`);
    } else if (g.kind === "kreuzung") {
      // Halbe Längs- und Querweglänge liegen auf dem darstellbaren Raster (Vielfache von
      // 28,5 mm = 57/2) genau dann, wenn die ganzen Längen Vielfache von 57 sind.
      if (!multipleOf57(g.length)) problems.push(`${e.id}: Längsweg ${g.length}`);
      if (!multipleOf57(g.crossLength)) problems.push(`${e.id}: Querweg ${g.crossLength}`);
      if (g.crossLength > g.length) problems.push(`${e.id}: Querweg länger als Längsweg`);
    }
  }
  return problems;
};

describe("Katalog", () => {
  test("[REQ-CAT-1] enthält genau die Einträge der Tabelle Katalog M1 mit gerade-100: 20 Einträge in Tabellenreihenfolge", () => {
    expect(
      cat()
        .map((e) => e.id)
        .sort(),
    ).toEqual(EXPECTED.map((e) => e.id).sort());
    expect(cat()).toHaveLength(20);
    // Reihenfolge der Tabelle: gerade-100 direkt nach gerade-114 (REQ-G100-1)
    expect(cat().map((e) => e.id)).toEqual(EXPECTED.map((e) => e.id));
  });

  test.skip("[REQ-CAT-1] Geometrie, Art.-Nr. und Sicherheit je Eintrag wie in der Tabelle, gerade-114 ohne eigene Nummer", () => {
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

  test.skip("[REQ-CAT-1] Platzierbarkeit wie in der Tabelle nach Vermessung #1: 16 platzierbar; Looping, Steilkehre, K und L nicht", () => {
    for (const e of cat()) {
      expect({ id: e.id, placeable: isPlaceable(e) }).toEqual({
        id: e.id,
        placeable: PLACEABLE.has(e.id),
      });
    }
    expect(cat().filter(isPlaceable)).toHaveLength(16);
    expect(PLACEABLE.size).toBe(16);
    expect(
      cat()
        .filter((e) => !isPlaceable(e))
        .map((e) => e.id),
    ).toEqual(["looping-teil", "steilkehre-teil", "looping", "steilkehre"]);
  });

  test.skip("[REQ-CAT-1] Vermessung #1: Wireless-Anschluss Gerade 114 wie das Anschlussstück, Steilkurve 1/45° Kurve R 171, 45° wie die Kurve 1/45°; Sicherheit hoch, Quelle nennt die Messung 2026-11-28", () => {
    const wireless = byId("wireless-anschluss");
    const steil = byId("steilkurve-1-45");
    expect({
      name: wireless.name,
      articleNumbers: wireless.articleNumbers,
      geometry: wireless.geometry,
      certainty: wireless.certainty,
    }).toEqual({
      name: "Wireless-Anschluss",
      articleNumbers: ["20061673"],
      geometry: { kind: "gerade", length: 114 },
      certainty: "hoch",
    });
    expect({
      name: steil.name,
      articleNumbers: steil.articleNumbers,
      geometry: steil.geometry,
      certainty: steil.certainty,
    }).toEqual({
      name: "Steilkurve 1/45°",
      articleNumbers: ["20061612"],
      geometry: { kind: "kurve", radius: 171, angle: 45 },
      certainty: "hoch",
    });
    // Geometrie gleich den Vorbildern (Orakel unabhängig vom Prüfling: die Zahlen oben)
    expect(wireless.geometry).toEqual(byId("anschlussstueck").geometry);
    expect(steil.geometry).toEqual(byId("kurve-1-45").geometry);
    for (const e of [wireless, steil]) {
      expect({ id: e.id, source: e.source }).toEqual({
        id: e.id,
        source: expect.stringContaining("Messung 2026-11-28"),
      });
      expect(e.source).toContain("#1");
    }
  });

  test("[REQ-CAT-1] Einträge, die die Vermessung #1 nicht ändert, wie in der Tabelle (gilt vor und nach der Vermessung)", () => {
    const unchanged = EXPECTED.filter((exp) => !CHANGED_BY_MEASUREMENT.has(exp.id));
    expect(unchanged).toHaveLength(18);
    const numbers = (n: ReadonlyArray<string> | "keineEigene") =>
      n === "keineEigene" ? n : [...n].sort();
    for (const exp of unchanged) {
      const e = byId(exp.id);
      expect({
        id: e.id,
        geometry: sortedParts(e.geometry),
        certainty: e.certainty,
        articleNumbers: numbers(e.articleNumbers),
        placeable: isPlaceable(e),
      }).toEqual({
        id: exp.id,
        geometry: sortedParts(exp.geometry),
        certainty: exp.certainty,
        articleNumbers: numbers(exp.articleNumbers),
        placeable: PLACEABLE.has(exp.id),
      });
    }
    // der Katalog kennt keine weiteren Einträge
    const known = new Set(EXPECTED.map((e) => e.id));
    expect(cat().filter((e) => !known.has(e.id))).toEqual([]);
  });

  test("[REQ-CAT-2] jeder Eintrag hat eindeutige ID, Namen, Art.-Nr., Quelle und Sicherheit", () => {
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

  test("[REQ-CAT-3] jeder Katalogeintrag besteht die Prüfung gegen das Katalog-Schema", () => {
    for (const e of cat()) {
      const decoded = Schema.decodeUnknownEither(schemaApi.CatalogEntrySchema)(e);
      expect({ id: e.id, valid: Either.isRight(decoded) }).toEqual({ id: e.id, valid: true });
      if (Either.isRight(decoded)) expect(decoded.right).toEqual(e);
    }
  });

  test("[REQ-CAT-4] Bestandteile verweisen auf vorhandene Einträge, Anzahl ≥ 1, keine verschachtelte Baugruppe", () => {
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

  test("[REQ-CAT-5] Geometrien platzierbarer Einträge liegen auf dem 57-mm-Raster, einzige Ausnahme gerade-100 (gilt vor und nach der Ergänzung)", () => {
    expect(cat().filter(isPlaceable).length).toBeGreaterThanOrEqual(13);
    expect(rasterProblems(cat())).toEqual([]);
  });

  test("[REQ-CAT-5] Ausnahme greift: gerade-100 (100 mm) ist platzierbar, liegt abseits des Rasters und besteht die Prüfung", () => {
    const g100 = byId("gerade-100");
    expect(g100.geometry).toEqual({ kind: "gerade", length: 100 });
    expect(isPlaceable(g100)).toBe(true);
    expect(rasterProblems(cat())).toEqual([]);
    // genau eine platzierbare Gerade abseits des Rasters
    const offRaster = cat()
      .filter(isPlaceable)
      .filter((e) => e.geometry.kind === "gerade" && e.geometry.length % 57 !== 0)
      .map((e) => e.id);
    expect(offRaster).toEqual(["gerade-100"]);
  });

  test("[REQ-CAT-5] Wirkungsnachweis mit verändertem Katalog: Gerade 171 mit 170 mm, Kurve mit Radius 170 oder zweite Gerade abseits des Rasters scheitern", () => {
    const g100: CatalogEntry = {
      id: "gerade-100",
      name: "Gerade 100",
      articleNumbers: "keineEigene",
      source: "Test",
      certainty: "hoch",
      geometry: { kind: "gerade", length: 100 },
    };
    // Grundlage: Katalog mit gerade-100 (unabhängig davon, ob der Produktkatalog sie schon hat)
    const base = [...cat().filter((e) => e.id !== "gerade-100"), g100];
    expect(rasterProblems(base)).toEqual([]);

    const g170 = base.map(
      (e): CatalogEntry =>
        e.id === "gerade-171" ? { ...e, geometry: { kind: "gerade", length: 170 } } : e,
    );
    expect(rasterProblems(g170)).toEqual(["gerade-171: Länge 170"]);

    const r170 = base.map(
      (e): CatalogEntry =>
        e.id === "kurve-2-45" ? { ...e, geometry: { kind: "kurve", radius: 170, angle: 45 } } : e,
    );
    expect(rasterProblems(r170)).toEqual(["kurve-2-45: Radius 170"]);

    // Kopie von gerade-100 unter anderer ID: die Ausnahme gilt nur für gerade-100
    const copy = [...base, { ...g100, id: "gerade-100-kopie", name: "Gerade 100 Kopie" }];
    expect(rasterProblems(copy)).toEqual(["gerade-100-kopie: Länge 100"]);

    // gerade-100 mit anderer Länge abseits des Rasters ist keine Ausnahme
    const g101 = base.map(
      (e): CatalogEntry =>
        e.id === "gerade-100" ? { ...e, geometry: { kind: "gerade", length: 101 } } : e,
    );
    expect(rasterProblems(g101)).toEqual(["gerade-100: Länge 101"]);

    // Winkel außer 45° und 90°
    const a30 = base.map(
      (e): CatalogEntry =>
        e.id === "kurve-1-45"
          ? { ...e, geometry: { kind: "kurve", radius: 171, angle: 30 as 45 } }
          : e,
    );
    expect(rasterProblems(a30)).toEqual(["kurve-1-45: Winkel 30"]);

    // Kreuzung: Querweg länger als Längsweg, Längs- oder Querweg abseits des Rasters
    const cross = (length: number, crossLength: number) =>
      base.map(
        (e): CatalogEntry =>
          e.id === "kreuzung" ? { ...e, geometry: { kind: "kreuzung", length, crossLength } } : e,
      );
    expect(rasterProblems(cross(114, 342))).toEqual(["kreuzung: Querweg länger als Längsweg"]);
    expect(rasterProblems(cross(340, 114))).toEqual(["kreuzung: Längsweg 340"]);
    expect(rasterProblems(cross(342, 113))).toEqual(["kreuzung: Querweg 113"]);
  });
});
