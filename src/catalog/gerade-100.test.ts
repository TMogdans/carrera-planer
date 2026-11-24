/**
 * Spec gerade-100 (.specify/specs/gerade-100/spec.md): Gerade 100 im Katalog und die Packung
 * 20061658 als Set-Vorlage. Abnahmetests REQ-G100-1 bis REQ-G100-3 (Katalogdaten).
 *
 * Schnittstelle wie in catalog.test.ts und sets.test.ts: `src/catalog/index.ts` exportiert
 * `CATALOG` und `SET_TEMPLATES`; das Schema `CatalogEntrySchema` kommt aus `src/schema/index.ts`.
 * Die Vorlagen-ID der Packung ist frei (Spec: „z. B. geraden-100-114“); die Tests finden sie über
 * die Artikelnummer 20061658.
 *
 * Die Kernrechnung (REQ-G100-5/-6), Leiste, Bestand und Einkaufsliste (REQ-G100-4/-7/-10) prüft
 * src/web/editor/gerade-100.test.ts.
 */
import { Either, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "../schema/index.js";
import * as catalogModule from "./index.js";

type Certainty = "hoch" | "mittel" | "niedrig";
type CatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly articleNumbers: ReadonlyArray<string> | "keineEigene";
  readonly source: string;
  readonly certainty: Certainty;
  readonly geometry: { readonly kind: string };
  readonly praegung?: ReadonlyArray<unknown>;
};
type SetTemplate = {
  readonly id: string;
  readonly name: string;
  readonly articleNumber: string;
  readonly contents: ReadonlyArray<{ readonly part: string; readonly count: number }>;
};

const api = catalogModule as unknown as {
  readonly CATALOG: ReadonlyArray<CatalogEntry>;
  readonly SET_TEMPLATES: ReadonlyArray<SetTemplate>;
};
const schemaApi = schemaModule as unknown as {
  readonly CatalogEntrySchema: Schema.Schema<CatalogEntry, unknown>;
};
const cat = (): ReadonlyArray<CatalogEntry> => api.CATALOG;
const indexOf = (id: string): number => cat().findIndex((e) => e.id === id);
const byId = (id: string): CatalogEntry => {
  const e = cat().find((x) => x.id === id);
  if (e === undefined) throw new Error(`Katalogeintrag ${id} fehlt`);
  return e;
};
const numbersOf = (e: CatalogEntry): ReadonlyArray<string> =>
  e.articleNumbers === "keineEigene" ? [] : e.articleNumbers;

/**
 * Prüfung aus REQ-G100-3: Artikelnummern von Set-Vorlagen, die zugleich Artikelnummer eines
 * Katalogeintrags sind (leer = in Ordnung). Form „<Eintrag>: <Nummer>“.
 */
const packNumberClashes = (
  catalog: ReadonlyArray<CatalogEntry>,
  templates: ReadonlyArray<SetTemplate>,
): string[] => {
  const packs = new Set(templates.map((t) => t.articleNumber));
  return catalog.flatMap((e) =>
    numbersOf(e)
      .filter((n) => packs.has(n))
      .map((n) => `${e.id}: ${n}`),
  );
};

describe("Gerade 100 und Packung 20061658", () => {
  test("[REQ-G100-1] gerade-100: Name, keine eigene Nummer, Gerade 100 mm, Sicherheit hoch, Quelle, keine Prägung, direkt nach gerade-114, besteht das Schema", () => {
    const e = byId("gerade-100");
    expect({
      id: e.id,
      name: e.name,
      articleNumbers: e.articleNumbers,
      geometry: e.geometry,
      certainty: e.certainty,
    }).toEqual({
      id: "gerade-100",
      name: "Gerade 100",
      articleNumbers: "keineEigene",
      geometry: { kind: "gerade", length: 100 },
      certainty: "hoch",
    });
    expect(e.source.trim().length).toBeGreaterThan(0);
    expect(Object.hasOwn(e, "praegung")).toBe(false);
    // Katalogposition direkt nach gerade-114
    expect(indexOf("gerade-114")).toBeGreaterThanOrEqual(0);
    expect(indexOf("gerade-100")).toBe(indexOf("gerade-114") + 1);
    expect(cat().filter((x) => x.id === "gerade-100")).toHaveLength(1);
    const decoded = Schema.decodeUnknownEither(schemaApi.CatalogEntrySchema)(e);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) expect(decoded.right).toEqual(e);
  });

  test("[REQ-G100-2] gerade-114 ohne eigene Artikelnummer; Geometrie, Name, Sicherheit und Position bleiben; kein Eintrag führt 20061658", () => {
    const e = byId("gerade-114");
    expect({
      name: e.name,
      articleNumbers: e.articleNumbers,
      geometry: e.geometry,
      certainty: e.certainty,
    }).toEqual({
      name: "Gerade 114",
      articleNumbers: "keineEigene",
      geometry: { kind: "gerade", length: 114 },
      certainty: "hoch",
    });
    // Position wie bisher: dritter Eintrag, nach Gerade 342 und Gerade 171
    expect(
      cat()
        .slice(0, 3)
        .map((x) => x.id),
    ).toEqual(["gerade-342", "gerade-171", "gerade-114"]);
    expect(
      cat()
        .filter((x) => numbersOf(x).includes("20061658"))
        .map((x) => x.id),
    ).toEqual([]);
  });

  test("[REQ-G100-3] Packungsnummer ist keine Teilenummer: keine Vorlagen-Nummer als Katalognummer; Wirkungsnachweis mit gerade-114 = 20061658 und gerade-342 + 20062492", () => {
    const templates = api.SET_TEMPLATES;
    // die Prüfung ist nicht leer: die Packung 20061658 und Mach 8 sind Vorlagen
    expect(templates.map((t) => t.articleNumber)).toEqual(
      expect.arrayContaining(["20061658", "20062492"]),
    );
    expect(packNumberClashes(cat(), templates)).toEqual([]);

    const g114Back = cat().map(
      (e): CatalogEntry => (e.id === "gerade-114" ? { ...e, articleNumbers: ["20061658"] } : e),
    );
    expect(packNumberClashes(g114Back, templates)).toEqual(["gerade-114: 20061658"]);

    const g342Mach8 = cat().map(
      (e): CatalogEntry =>
        e.id === "gerade-342" ? { ...e, articleNumbers: [...numbersOf(e), "20062492"] } : e,
    );
    expect(packNumberClashes(g342Mach8, templates)).toEqual(["gerade-342: 20062492"]);

    // Gegenprobe: eine Nummer, die keine Vorlage trägt, ist kein Fund
    const other = cat().map(
      (e): CatalogEntry => (e.id === "gerade-114" ? { ...e, articleNumbers: ["20069997"] } : e),
    );
    expect(packNumberClashes(other, templates)).toEqual([]);
  });
});
