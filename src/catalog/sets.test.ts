/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Set-Vorlagen als Daten. Abnahmetests REQ-SET-2
 * und REQ-SET-3. REQ-SET-2 in der Fassung der Spec gerade-100 (.specify/specs/gerade-100/spec.md):
 * nach den vier Vorlagen aus M3a die Vorlage „Geraden 3 × 100 + 3 × 114“ (20061658), fünf
 * Vorlagen; die Summe Mach 8 + Ausbauset 1 + Ausbauset 3 bleibt 49 Teile.
 *
 * Aufteilung bis zur Umsetzung: Tests mit der neuen Erwartung sind `.skip` (implement entfernt nur
 * das `.skip`); Tests, deren Erwartung vor und nach der Ergänzung gilt, laufen aktiv.
 *
 * Öffentliche API (von spec-to-tests gewählt): `src/catalog/index.ts` exportiert zusätzlich
 *   SET_TEMPLATES: ReadonlyArray<SetTemplate>
 *   SetTemplate = { id, name, articleNumber, source, certainty, contents: [{ part, count }] }
 * Die Vorlagen-IDs sind frei wählbar, aber stabil; die Tests finden Vorlagen über die
 * Artikelnummer. Die Reihenfolge ist die der Tabelle „Set-Vorlagen M3a“.
 *
 * Die Prüfung aus REQ-SET-3 steht hier im Test (`templateProblems`); ihr Wirkungsnachweis mit
 * verändertem Katalog zeigt, dass sie nicht leer durchläuft.
 */
import { Either, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "../schema/index.js";
import * as catalogModule from "./index.js";

type Certainty = "hoch" | "mittel" | "niedrig";
type SetTemplate = {
  readonly id: string;
  readonly name: string;
  readonly articleNumber: string;
  readonly source: string;
  readonly certainty: Certainty;
  readonly contents: ReadonlyArray<{ readonly part: string; readonly count: number }>;
};
type CatalogEntry = { readonly id: string; readonly geometry: { readonly kind: string } };

const catalogApi = catalogModule as unknown as {
  readonly CATALOG: ReadonlyArray<CatalogEntry>;
  readonly SET_TEMPLATES: ReadonlyArray<SetTemplate>;
};
const schemaApi = schemaModule as unknown as {
  readonly SetTemplateSchema: Schema.Schema<SetTemplate, unknown>;
};
const templates = (): ReadonlyArray<SetTemplate> => {
  const t = catalogApi.SET_TEMPLATES;
  if (t === undefined) throw new Error("src/catalog exportiert SET_TEMPLATES nicht");
  return t;
};

type Expected = {
  readonly name: string;
  readonly articleNumber: string;
  readonly certainty: Certainty;
  readonly contents: Readonly<Record<string, number>>;
  readonly sum: number;
};

/**
 * Tabelle „Set-Vorlagen M3a“ der Spec, in deren Reihenfolge, danach die neue Vorlage aus
 * „Katalog- und Vorlagen-Änderungen“ (gerade-100).
 */
const EXPECTED: ReadonlyArray<Expected> = [
  {
    name: "Mach 8",
    articleNumber: "20062492",
    certainty: "hoch",
    contents: {
      "gerade-342": 4,
      "gerade-114": 1,
      "kurve-1-90": 6,
      engstelle: 1,
      kreuzung: 1,
      anschlussstueck: 1,
      rundenzaehler: 1,
      "looping-teil": 8,
      "steilkehre-teil": 4,
    },
    sum: 27,
  },
  {
    name: "Ausbauset 1",
    articleNumber: "20061600",
    certainty: "niedrig",
    contents: { "kurve-1-90": 2, "spurwechsel-gerade": 2, "gerade-342": 2 },
    sum: 6,
  },
  {
    name: "Ausbauset 3",
    articleNumber: "20061614",
    certainty: "mittel",
    contents: { "gerade-342": 8, "kurve-1-45": 4, "steilkurve-1-45": 4 },
    sum: 16,
  },
  {
    name: "Wireless Upgrade Kit",
    articleNumber: "20061676",
    certainty: "hoch",
    contents: { "wireless-anschluss": 1 },
    sum: 1,
  },
  {
    name: "Geraden 3 × 100 + 3 × 114",
    articleNumber: "20061658",
    certainty: "hoch",
    contents: { "gerade-100": 3, "gerade-114": 3 },
    sum: 6,
  },
];
/** Die vier Vorlagen aus M3a (unverändert durch gerade-100). */
const EXPECTED_M3A = EXPECTED.slice(0, 4);

const asRecord = (t: SetTemplate): Record<string, number> =>
  Object.fromEntries(t.contents.map((c) => [c.part, c.count]));

/**
 * Prüfung aus REQ-SET-3: Schema, bestandsfähige Inhalte, Teil-ID höchstens einmal je Vorlage,
 * eindeutige IDs und Artikelnummern. Liefert die gefundenen Probleme (leer = in Ordnung).
 */
const templateProblems = (
  catalog: ReadonlyArray<CatalogEntry>,
  list: ReadonlyArray<SetTemplate>,
): string[] => {
  const problems: string[] = [];
  const byId = new Map(catalog.map((e) => [e.id, e]));
  for (const t of list) {
    if (Either.isLeft(Schema.decodeUnknownEither(schemaApi.SetTemplateSchema)(t))) {
      problems.push(`${t.id}: Schema`);
    }
    const seen = new Set<string>();
    for (const c of t.contents) {
      const entry = byId.get(c.part);
      if (entry === undefined) problems.push(`${t.id}: ${c.part} unbekannt`);
      else if (entry.geometry.kind === "baugruppe") problems.push(`${t.id}: ${c.part} Baugruppe`);
      if (seen.has(c.part)) problems.push(`${t.id}: ${c.part} doppelt`);
      seen.add(c.part);
    }
  }
  if (new Set(list.map((t) => t.id)).size !== list.length) problems.push("IDs doppelt");
  if (new Set(list.map((t) => t.articleNumber)).size !== list.length) {
    problems.push("Artikelnummern doppelt");
  }
  return problems;
};

describe("Set-Vorlagen", () => {
  test.skip("[REQ-SET-2] genau die fünf Vorlagen (M3a, dann Geraden 3 × 100 + 3 × 114), in Tabellenreihenfolge, mit Name, Art.-Nr., Sicherheit und Inhalt", () => {
    const list = templates();
    expect(list.map((t) => t.articleNumber)).toEqual(EXPECTED.map((e) => e.articleNumber));
    expect(list).toHaveLength(5);
    list.forEach((t, i) => {
      const exp = EXPECTED[i] as Expected;
      expect({ name: t.name, certainty: t.certainty }).toEqual({
        name: exp.name,
        certainty: exp.certainty,
      });
      expect(asRecord(t)).toEqual(exp.contents);
      expect(t.contents.reduce((s, c) => s + c.count, 0)).toBe(exp.sum);
      expect(t.source.trim().length, t.name).toBeGreaterThan(0);
      expect(t.id.length, t.name).toBeGreaterThan(0);
    });
  });

  test("[REQ-SET-2] die vier Vorlagen aus M3a stehen unverändert an Position 1 bis 4 (gilt vor und nach der Ergänzung)", () => {
    const list = templates().slice(0, 4);
    expect(list.map((t) => t.articleNumber)).toEqual(EXPECTED_M3A.map((e) => e.articleNumber));
    list.forEach((t, i) => {
      const exp = EXPECTED_M3A[i] as Expected;
      expect({ name: t.name, certainty: t.certainty, contents: asRecord(t) }).toEqual({
        name: exp.name,
        certainty: exp.certainty,
        contents: exp.contents,
      });
    });
  });

  test("[REQ-SET-2] Mach 8 + Ausbauset 1 + Ausbauset 3 ergeben die Summenzeile der Recherche (49 Teile, ohne Gerade 100)", () => {
    const sum: Record<string, number> = {};
    const three = ["20062492", "20061600", "20061614"];
    const chosen = templates().filter((x) => three.includes(x.articleNumber));
    expect(chosen.map((t) => t.articleNumber)).toEqual(three);
    for (const t of chosen) {
      for (const c of t.contents) sum[c.part] = (sum[c.part] ?? 0) + c.count;
    }
    expect(sum).toEqual({
      "gerade-342": 14,
      "gerade-114": 1,
      "kurve-1-90": 8,
      "kurve-1-45": 4,
      "steilkurve-1-45": 4,
      "spurwechsel-gerade": 2,
      engstelle: 1,
      kreuzung: 1,
      anschlussstueck: 1,
      rundenzaehler: 1,
      "looping-teil": 8,
      "steilkehre-teil": 4,
    });
    expect(Object.values(sum).reduce((s, n) => s + n, 0)).toBe(49);
  });

  test("[REQ-SET-3] jede Vorlage besteht SetTemplateSchema, verweist nur auf bestandsfähige Einträge, eindeutig", () => {
    expect(templateProblems(catalogApi.CATALOG, templates())).toEqual([]);
  });

  test("[REQ-SET-3] Wirkungsnachweis: ohne kurve-1-45 im Katalog oder mit looping als Inhalt schlägt die Prüfung fehl", () => {
    const withoutCurve = catalogApi.CATALOG.filter((e) => e.id !== "kurve-1-45");
    expect(templateProblems(withoutCurve, templates())).toContain(
      `${(templates()[2] as SetTemplate).id}: kurve-1-45 unbekannt`,
    );

    const mach8 = templates()[0] as SetTemplate;
    const withLooping: SetTemplate = {
      ...mach8,
      contents: [...mach8.contents, { part: "looping", count: 1 }],
    };
    expect(templateProblems(catalogApi.CATALOG, [withLooping, ...templates().slice(1)])).toContain(
      `${mach8.id}: looping Baugruppe`,
    );

    // doppelte Teil-ID, doppelte Vorlagen-ID und Artikelnummer, Schemaverletzung
    const doubled: SetTemplate = {
      ...mach8,
      contents: [...mach8.contents, { part: "gerade-342", count: 1 }],
    };
    expect(templateProblems(catalogApi.CATALOG, [doubled])).toContain(
      `${mach8.id}: gerade-342 doppelt`,
    );
    expect(templateProblems(catalogApi.CATALOG, [mach8, mach8])).toEqual(
      expect.arrayContaining(["IDs doppelt", "Artikelnummern doppelt"]),
    );
    expect(
      templateProblems(catalogApi.CATALOG, [{ ...mach8, articleNumber: "2006249" }]),
    ).toContain(`${mach8.id}: Schema`);
  });
});
