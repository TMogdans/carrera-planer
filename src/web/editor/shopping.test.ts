/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Einkaufsliste als reine Logik. Abnahmetests
 * REQ-EINK-1 bis REQ-EINK-5.
 *
 * Schnittstelle (Typen: src/web/test-support/bestand-fixtures.ts), Modul
 * `src/web/editor/inventory.ts`:
 *   shoppingList(catalog, inventory, elements) →
 *     { ok: true, rows: [{ partId, name, needed, have, missing, searchTerms }], total, text }
 *     | { ok: false, text: "Einkaufsliste nicht bestimmbar" }
 *     Ohne Zeilen ist text „alles vorhanden“.
 *   searchTerms: { kind: "artikelnummer", value, text: value }
 *              | { kind: "praegung", value, text: "Prägung <value>" } | { kind: "hinweis", text }
 *   shoppingShort(list) → „Bestand reicht“ | „fehlt 1 Teil“ | „fehlen n Teile“ (n ≥ 2)
 *                       | „Einkaufsliste nicht bestimmbar“
 * Orakel für den Verbrauch ist der Kern (`consumption`).
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { consumption } from "../../core/index.js";
import {
  anyInventoryArb,
  type CatalogEntryWithPraegung,
  catalogElementsArb,
  countIn,
  type Inventory,
  ignoredOnlyArb,
  loadInventory,
  MACH8,
  plus,
  type SearchTerm,
  type ShoppingList,
  type ShoppingRow,
  STOCKABLE_IDS,
  SUMME3,
} from "../test-support/bestand-fixtures.js";
import {
  ACHT,
  ACHT_G171,
  anyCommandArb,
  CATALOG,
  type CatalogEntry,
  elementsArb,
  type LayoutElement,
  loadEditor,
  loaded,
  OVAL,
  resolve,
  UNKNOWN_ID,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

const nameOf = (id: string): string => CATALOG.find((e) => e.id === id)?.name as string;
const art = (value: string): SearchTerm => ({ kind: "artikelnummer", value, text: value });
const praeg = (value: string): SearchTerm => ({
  kind: "praegung",
  value,
  text: `Prägung ${value}`,
});
const hint = (text: string): SearchTerm => ({ kind: "hinweis", text });
const NO_NUMBER = hint("keine Artikelnummer, keine Prägung bekannt");

const okList = (list: ShoppingList) => {
  expect(list.ok).toBe(true);
  if (!list.ok) throw new Error(list.text);
  return list;
};
const counts = (list: ShoppingList) =>
  okList(list).rows.map(({ partId, needed, have, missing }) => ({
    partId,
    needed,
    have,
    missing,
  }));

const curves = (n: number): Elements =>
  Array.from({ length: n }, (_, i) => ({ id: `k${i}`, part: "kurve-1-90", turn: "links" }));
const one = (part: string): Elements => [{ id: "x", part }];

describe("Einkaufsliste", () => {
  test("[REQ-EINK-1] Oval, leerer Bestand: Gerade 342 fehlt 2, Kurve 1/90° fehlt 4, zusammen 6 (Katalogreihenfolge)", async () => {
    const I = await loadInventory();
    const list = okList(I.shoppingList(CATALOG, {}, OVAL));
    expect(counts(list)).toEqual([
      { partId: "gerade-342", needed: 2, have: 0, missing: 2 },
      { partId: "kurve-1-90", needed: 4, have: 0, missing: 4 },
    ]);
    expect(list.total).toBe(6);
    for (const r of list.rows) expect(r.name).toBe(nameOf(r.partId));
  });

  test("[REQ-EINK-1] Acht, leerer Bestand: Gerade 114 1, Kurve 1/90° 6, Kreuzung 1, Anschlussstück 1, zusammen 9", async () => {
    const I = await loadInventory();
    const list = okList(I.shoppingList(CATALOG, {}, ACHT));
    expect(counts(list)).toEqual([
      { partId: "gerade-114", needed: 1, have: 0, missing: 1 },
      { partId: "kurve-1-90", needed: 6, have: 0, missing: 6 },
      { partId: "kreuzung", needed: 1, have: 0, missing: 1 },
      { partId: "anschlussstueck", needed: 1, have: 0, missing: 1 },
    ]);
    expect(list.total).toBe(9);
  });

  test("[REQ-EINK-1] Oval oder Acht mit Bestand Mach 8 → „alles vorhanden“; neun Kurven mit Summenbestand → benötigt 9, vorhanden 8, fehlt 1", async () => {
    const I = await loadInventory();
    for (const elements of [OVAL, ACHT, []]) {
      const list = okList(I.shoppingList(CATALOG, MACH8, elements));
      expect(list.rows).toEqual([]);
      expect(list.total).toBe(0);
      expect(list.text).toBe("alles vorhanden");
    }
    const nine = okList(I.shoppingList(CATALOG, SUMME3, curves(9)));
    expect(counts(nine)).toEqual([{ partId: "kurve-1-90", needed: 9, have: 8, missing: 1 }]);
    expect(nine.total).toBe(1);
    expect(nine.text).toBeUndefined();
  });

  test("[REQ-EINK-1] Baugruppen erscheinen nie als Zeile, nur ihre Bestandteile; teilweise gedeckt", async () => {
    const I = await loadInventory();
    const list = okList(
      I.shoppingList(CATALOG, { "kurve-1-90": 1, steilkehre: 3 }, [
        { id: "a", part: "steilkehre" },
        { id: "b", part: "looping" },
      ]),
    );
    expect(counts(list)).toEqual([
      { partId: "kurve-1-90", needed: 2, have: 1, missing: 1 },
      { partId: "looping-teil", needed: 8, have: 0, missing: 8 },
      { partId: "steilkehre-teil", needed: 4, have: 0, missing: 4 },
    ]);
    expect(list.total).toBe(13);
  });

  test("[REQ-EINK-2] Teil unbekannt → „Einkaufsliste nicht bestimmbar“, keine Zeilen", async () => {
    const I = await loadInventory();
    for (const elements of [[...OVAL, { id: "u", part: UNKNOWN_ID }], one(UNKNOWN_ID)]) {
      expect(I.shoppingList(CATALOG, MACH8, elements)).toEqual({
        ok: false,
        text: "Einkaufsliste nicht bestimmbar",
      });
    }
    // Katalog ohne Kurve 1/90°: das Oval enthält dann ein unbekanntes Teil
    expect(
      I.shoppingList(
        CATALOG.filter((e) => e.id !== "kurve-1-90"),
        {},
        OVAL,
      ).ok,
    ).toBe(false);
  });

  test("[REQ-EINK-2] Maße fehlen, offene Strecke, ungültiger Verweis, fehlende Richtung verhindern die Liste nicht", async () => {
    const I = await loadInventory();
    const cases: ReadonlyArray<readonly [Elements, ReadonlyArray<string>]> = [
      [one("steilkehre"), ["kurve-1-90", "steilkehre-teil"]],
      [one("wireless-anschluss"), ["wireless-anschluss"]],
      [one("gerade-342"), ["gerade-342"]],
      [[{ id: "q", crosses: "x" }, ...one("gerade-114")], ["gerade-114"]],
      [[{ id: "k", part: "kurve-1-90" }], ["kurve-1-90"]],
      [[{ id: "g", part: "gerade-342", turn: "links" }], ["gerade-342"]],
      [ACHT_G171, ["gerade-171", "kurve-1-90", "kreuzung", "anschlussstueck"]],
    ];
    for (const [elements, ids] of cases) {
      const list = okList(I.shoppingList(CATALOG, {}, elements));
      expect(list.rows.map((r) => r.partId)).toEqual(ids);
    }
  });
});

describe("Suchbegriffe", () => {
  const termsOf = (list: ShoppingList): Record<string, ReadonlyArray<SearchTerm>> =>
    Object.fromEntries(okList(list).rows.map((r: ShoppingRow) => [r.partId, r.searchTerms]));

  test("[REQ-EINK-3] Beispiele: Steilkehre, Looping, Anschlussstück, Gerade 342 mit leerem Bestand", async () => {
    const I = await loadInventory();
    const steilkehre = I.shoppingList(CATALOG, {}, one("steilkehre"));
    expect(counts(steilkehre)).toEqual([
      { partId: "kurve-1-90", needed: 2, have: 0, missing: 2 },
      { partId: "steilkehre-teil", needed: 4, have: 0, missing: 4 },
    ]);
    expect(termsOf(steilkehre)).toEqual({
      "kurve-1-90": [art("20061603")],
      "steilkehre-teil": [praeg("141903-1B")],
    });

    const looping = I.shoppingList(CATALOG, {}, one("looping"));
    expect(counts(looping)).toEqual([{ partId: "looping-teil", needed: 8, have: 0, missing: 8 }]);
    expect(termsOf(looping)).toEqual({
      "looping-teil": [NO_NUMBER, hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613")],
    });

    expect(termsOf(I.shoppingList(CATALOG, {}, one("anschlussstueck")))).toEqual({
      anschlussstueck: [art("20061530"), art("20061666")],
    });
    expect(termsOf(I.shoppingList(CATALOG, {}, one("gerade-342")))).toEqual({
      "gerade-342": [art("20061602"), praeg("142202-1")],
    });
  });

  test("[REQ-EINK-3] Wirkungsnachweis mit verändertem Katalog: Suchbegriffe folgen Artikelnummern, Prägungen und Baugruppen", async () => {
    const I = await loadInventory();
    const P = (value: string) => ({ value, source: "Test", certainty: "niedrig" as const });
    // alle Prägungen des Produktkatalogs entfernen, dann gezielt setzen
    const bare = (e: CatalogEntry): CatalogEntryWithPraegung => {
      const { praegung: _drop, ...rest } = e as CatalogEntryWithPraegung;
      return rest;
    };
    const forged: ReadonlyArray<CatalogEntryWithPraegung> = [
      ...CATALOG.map(bare).map(
        (e): CatalogEntryWithPraegung =>
          e.id === "kurve-1-90" ? { ...e, praegung: [P("K90-A"), P("K90-B")] } : e,
      ),
      {
        id: "looping-xl",
        name: "Looping XL (Baugruppe)",
        articleNumbers: ["20069999"],
        source: "Test",
        certainty: "niedrig",
        geometry: {
          kind: "baugruppe",
          parts: [
            { part: "gerade-114", count: 1 },
            { part: "looping-teil", count: 2 },
          ],
        },
      },
      {
        id: "wireless-set",
        name: "Wireless-Set (Baugruppe)",
        articleNumbers: "keineEigene",
        source: "Test",
        certainty: "niedrig",
        geometry: { kind: "baugruppe", parts: [{ part: "looping-teil", count: 1 }] },
      },
    ];
    const catalog = forged as ReadonlyArray<CatalogEntry>;
    const list = I.shoppingList(catalog, {}, [
      { id: "a", part: "steilkehre" },
      { id: "b", part: "gerade-342" },
      { id: "c", part: "looping" },
    ]);
    expect(termsOf(list)).toEqual({
      "gerade-342": [art("20061602")],
      "kurve-1-90": [art("20061603"), praeg("K90-A"), praeg("K90-B")],
      // Steilkehre (Baugruppe) hat keine Artikelnummer: kein „enthalten in“
      "steilkehre-teil": [NO_NUMBER],
      "looping-teil": [
        NO_NUMBER,
        hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613"),
        hint("enthalten in Looping XL (Baugruppe), Art.-Nr. 20069999"),
      ],
    });
    // Teil ohne eigene Artikelnummer, aber mit Prägung: nur die Prägung
    const kWithPraegung = catalog.map(
      (e): CatalogEntryWithPraegung =>
        e.id === "steilkehre-teil" ? { ...e, praegung: [P("K-1"), P("K-2")] } : e,
    ) as ReadonlyArray<CatalogEntry>;
    expect(
      termsOf(I.shoppingList(kWithPraegung, {}, one("steilkehre")))["steilkehre-teil"],
    ).toEqual([praeg("K-1"), praeg("K-2")]);
  });
});

describe("Suchbegriffe: Baugruppe mit mehreren Artikelnummern", () => {
  test("[REQ-EINK-3] Baugruppe mit mehreren Artikelnummern: ein Eintrag, Nummern in Katalogreihenfolge, getrennt durch „, “", async () => {
    const I = await loadInventory();
    const withNumbers = (numbers: readonly [string, ...string[]]) =>
      CATALOG.map(
        (e): CatalogEntry => (e.id === "looping" ? { ...e, articleNumbers: numbers } : e),
      );
    const two = okList(I.shoppingList(withNumbers(["20061613", "20061699"]), {}, one("looping")));
    expect(two.rows[0]?.searchTerms).toEqual([
      NO_NUMBER,
      hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613, 20061699"),
    ]);
    // Katalogreihenfolge, nicht sortiert
    const reversed = okList(
      I.shoppingList(withNumbers(["20061699", "20061613"]), {}, one("looping")),
    );
    expect(reversed.rows[0]?.searchTerms).toEqual([
      NO_NUMBER,
      hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061699, 20061613"),
    ]);
    const three = okList(
      I.shoppingList(withNumbers(["20061613", "20061699", "20061600"]), {}, one("looping")),
    );
    expect(three.rows[0]?.searchTerms).toEqual([
      NO_NUMBER,
      hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613, 20061699, 20061600"),
    ]);
  });
});

describe("Einkaufsliste: Eigenschaften", () => {
  test("[REQ-EINK-4] Eigenschaft: fehlt = max(0, Verbrauch − Bestand); leer ⇔ nicht überzogen; Fehlmengen addiert → leer; nicht zählende Einträge ändern nichts", async () => {
    const I = await loadInventory();
    fc.assert(
      fc.property(catalogElementsArb, anyInventoryArb, ignoredOnlyArb, (elements, inv, extra) => {
        const c = consumption(CATALOG, elements);
        if (!c.ok) throw new Error("Testdaten-Fehler: Folge enthält unbekannte Teile");
        const list = okList(I.shoppingList(CATALOG, inv, elements));
        const used = (p: string) => c.counts[p] ?? 0;
        const stock = (p: string) => (STOCKABLE_IDS.includes(p) ? countIn(inv, p) : 0);
        const expected = STOCKABLE_IDS.filter((p) => used(p) - stock(p) >= 1).map((p) => ({
          partId: p,
          needed: used(p),
          have: stock(p),
          missing: used(p) - stock(p),
        }));
        expect(counts(list)).toEqual(expected);
        expect(list.total).toBe(expected.reduce((s, r) => s + r.missing, 0));
        const over = STOCKABLE_IDS.some((p) => used(p) > stock(p));
        expect(list.rows.length === 0).toBe(!over);
        expect(list.text).toBe(over ? undefined : "alles vorhanden");

        const topped = plus(inv, Object.fromEntries(list.rows.map((r) => [r.partId, r.missing])));
        expect(okList(I.shoppingList(CATALOG, topped, elements)).rows).toEqual([]);

        const stockOnly: Inventory = Object.fromEntries(
          Object.entries(inv).filter(([p]) => STOCKABLE_IDS.includes(p)),
        );
        expect(I.shoppingList(CATALOG, stockOnly, elements)).toEqual(list);
        expect(I.shoppingList(CATALOG, plus(stockOnly, extra), elements)).toEqual(list);
      }),
      { numRuns: 300 },
    );
  });

  test("[REQ-EINK-4] Eigenschaft: bestimmbar genau dann, wenn der Kern den Verbrauch bestimmt", async () => {
    const I = await loadInventory();
    fc.assert(
      fc.property(elementsArb, anyInventoryArb, (elements, inv) => {
        const list = I.shoppingList(CATALOG, inv, elements);
        expect(list.ok).toBe(consumption(CATALOG, elements).ok);
        if (!list.ok) expect(list.text).toBe("Einkaufsliste nicht bestimmbar");
      }),
    );
  });
});

describe("Kurzform und Modi", () => {
  test("[REQ-EINK-5] Kurzform: „Bestand reicht“ ohne Zeilen, sonst „fehlen n Teile“ mit der Summe der Fehlmengen", async () => {
    const I = await loadInventory();
    expect(I.shoppingShort(I.shoppingList(CATALOG, MACH8, OVAL))).toBe("Bestand reicht");
    expect(I.shoppingShort(I.shoppingList(CATALOG, {}, []))).toBe("Bestand reicht");
    expect(I.shoppingShort(I.shoppingList(CATALOG, MACH8, curves(9)))).toBe("fehlen 3 Teile");
    expect(I.shoppingShort(I.shoppingList(CATALOG, {}, OVAL))).toBe("fehlen 6 Teile");
    expect(I.shoppingShort(I.shoppingList(CATALOG, {}, ACHT))).toBe("fehlen 9 Teile");
  });

  test("[REQ-EINK-5] Kurzform in der Einzahl: Summe 1 → „fehlt 1 Teil“, Summe 2 → „fehlen 2 Teile“", async () => {
    const I = await loadInventory();
    // neun Kurven mit Summenbestand: fehlt 1 (Beispiel REQ-EINK-1)
    expect(I.shoppingShort(I.shoppingList(CATALOG, SUMME3, curves(9)))).toBe("fehlt 1 Teil");
    expect(I.shoppingShort(I.shoppingList(CATALOG, {}, one("engstelle")))).toBe("fehlt 1 Teil");
    // Baugruppe mit einem fehlenden Bestandteil: Steilkehre = 4 K + 2 Kurven, 3 K vorhanden
    expect(
      I.shoppingShort(
        I.shoppingList(CATALOG, { "kurve-1-90": 2, "steilkehre-teil": 3 }, one("steilkehre")),
      ),
    ).toBe("fehlt 1 Teil");
    expect(I.shoppingShort(I.shoppingList(CATALOG, SUMME3, curves(10)))).toBe("fehlen 2 Teile");
    expect(I.shoppingShort(I.shoppingList(CATALOG, {}, curves(2)))).toBe("fehlen 2 Teile");
    // zwei verschiedene Teile je 1: Summe zählt, nicht Zeilen
    expect(
      I.shoppingShort(
        I.shoppingList(CATALOG, {}, [
          { id: "a", part: "engstelle" },
          { id: "b", part: "gerade-114" },
        ]),
      ),
    ).toBe("fehlen 2 Teile");
  });

  test("[REQ-EINK-5] Eigenschaft: Kurzform wörtlich aus der Summe der Fehlmengen", async () => {
    const I = await loadInventory();
    fc.assert(
      fc.property(catalogElementsArb, anyInventoryArb, (elements, inv) => {
        const list = okList(I.shoppingList(CATALOG, inv, elements));
        const expected =
          list.total === 0
            ? "Bestand reicht"
            : list.total === 1
              ? "fehlt 1 Teil"
              : `fehlen ${list.total} Teile`;
        expect(I.shoppingShort(list)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  test("[REQ-EINK-5] Kurzform bei nicht bestimmbarem Verbrauch: „Einkaufsliste nicht bestimmbar“", async () => {
    const I = await loadInventory();
    for (const elements of [one(UNKNOWN_ID), [...OVAL, { id: "u", part: UNKNOWN_ID }]]) {
      for (const inv of [MACH8, {}] as Inventory[]) {
        const list = I.shoppingList(CATALOG, inv, elements);
        expect(I.shoppingShort(list)).toBe("Einkaufsliste nicht bestimmbar");
      }
    }
  });

  test("[REQ-EINK-5] im Modus „Bestand“ bleibt eine leere Einkaufsliste ohne Laden, Import und Bestandsänderung leer (Eigenschaft)", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    fc.assert(
      fc.property(
        fc.constantFrom<Inventory>(MACH8, SUMME3, {}, { "gerade-342": 2 }),
        fc.constantFrom<Elements>([], OVAL, ACHT),
        fc.array(
          anyCommandArb.filter((g) => g.type !== "load"),
          { maxLength: 30 },
        ),
        (inv, elements, gens) => {
          let s = loaded(E, elements);
          const startList = okList(I.shoppingList(CATALOG, inv, s.elements));
          fc.pre(startList.rows.length === 0);
          for (const g of gens) {
            s = I.applyInMode(CATALOG, inv, "bestand", s, resolve(s, g)).state;
            expect(okList(I.shoppingList(CATALOG, inv, s.elements)).rows).toEqual([]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
