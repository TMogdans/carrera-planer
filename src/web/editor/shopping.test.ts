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
 *
 * REQ-EINK-3 in der Fassung der Spec gerade-100 (.specify/specs/gerade-100/spec.md): im dritten
 * Fall (weder Artikelnummer noch Prägung) folgen nach den Baugruppen-Einträgen Hinweise
 * „enthalten in <Name der Vorlage>, Art.-Nr. <articleNumber>“ für jede Set-Vorlage, die das Teil
 * enthält, in Vorlagenreihenfolge. Gewählte Schnittstelle (von spec-to-tests, die Spec sagt nur
 * „aus src/catalog, für Tests austauschbar wie der Katalog“):
 *   shoppingList(catalog, inventory, elements, templates = SET_TEMPLATES)
 * Ein optionales viertes Argument, Vorgabe sind die Vorlagen aus `src/catalog`. So bleibt der
 * Aufruf der Oberfläche (`src/web/ui/app.tsx`, drei Argumente) gültig und zeigt die Hinweise, und
 * der Vertragstyp in `src/web/test-support/bestand-fixtures.ts` (geschützt) bleibt unverändert;
 * die Tests rufen das vierte Argument über `listWith` auf. Tests mit M3a-Erwartungen an
 * Hinweise übergeben ausdrücklich eine leere Vorlagenliste.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { closure, consumption } from "../../core/index.js";
import {
  anyInventoryArb,
  type CatalogEntryWithPraegung,
  catalogElementsArb,
  countIn,
  type Inventory,
  type InventoryApi,
  ignoredOnlyArb,
  loadInventory,
  MACH8,
  plus,
  productTemplates,
  type SearchTerm,
  type SetTemplate,
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
  ORIGIN,
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

/** shoppingList mit ausdrücklicher Vorlagenliste (viertes Argument, REQ-EINK-3 gerade-100). */
type ShoppingListWithTemplates = (
  catalog: ReadonlyArray<CatalogEntry>,
  inventory: Inventory,
  elements: Elements,
  templates?: ReadonlyArray<SetTemplate>,
) => ShoppingList;
const listWith = (I: InventoryApi): ShoppingListWithTemplates =>
  I.shoppingList as unknown as ShoppingListWithTemplates;

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
      [one("looping-teil"), ["looping-teil"]],
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

  test("[REQ-EINK-3] Beispiele: Steilkehre, Anschlussstück, Gerade 342 mit leerem Bestand (unverändert durch gerade-100)", async () => {
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

    const looping = listWith(I)(CATALOG, {}, one("looping"), []);
    expect(counts(looping)).toEqual([{ partId: "looping-teil", needed: 8, have: 0, missing: 8 }]);
    // ohne Set-Vorlagen: nur der Baugruppen-Hinweis wie in M3a
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
    // ohne Set-Vorlagen (deren Hinweise prüfen die Tests zu gerade-100 unten)
    const list = listWith(I)(
      catalog,
      {},
      [
        { id: "a", part: "steilkehre" },
        { id: "b", part: "gerade-342" },
        { id: "c", part: "looping" },
      ],
      [],
    );
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
    // ohne Set-Vorlagen: nur die Baugruppen-Hinweise (Vorlagen-Hinweise siehe gerade-100 unten)
    const shop = listWith(I);
    const two = okList(shop(withNumbers(["20061613", "20061699"]), {}, one("looping"), []));
    expect(two.rows[0]?.searchTerms).toEqual([
      NO_NUMBER,
      hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613, 20061699"),
    ]);
    // Katalogreihenfolge, nicht sortiert
    const reversed = okList(shop(withNumbers(["20061699", "20061613"]), {}, one("looping"), []));
    expect(reversed.rows[0]?.searchTerms).toEqual([
      NO_NUMBER,
      hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061699, 20061613"),
    ]);
    const three = okList(
      shop(withNumbers(["20061613", "20061699", "20061600"]), {}, one("looping"), []),
    );
    expect(three.rows[0]?.searchTerms).toEqual([
      NO_NUMBER,
      hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613, 20061699, 20061600"),
    ]);
  });
});

describe("Suchbegriffe: Hinweise aus Set-Vorlagen (gerade-100)", () => {
  const termsOf = (list: ShoppingList): Record<string, ReadonlyArray<SearchTerm>> =>
    Object.fromEntries(okList(list).rows.map((r: ShoppingRow) => [r.partId, r.searchTerms]));
  const PACK = hint("enthalten in Geraden 3 × 100 + 3 × 114, Art.-Nr. 20061658");
  const IN_MACH8 = hint("enthalten in Mach 8, Art.-Nr. 20062492");
  const LOOPING = hint("enthalten in Looping (Baugruppe), Art.-Nr. 20061613");

  test("[REQ-EINK-3] Beispiele mit leerem Bestand und den Vorlagen aus src/catalog: Gerade 100, Gerade 114, Looping-Teil", async () => {
    const I = await loadInventory();
    // drei Argumente wie in der Oberfläche: Vorgabe sind die Vorlagen aus src/catalog
    expect(termsOf(I.shoppingList(CATALOG, {}, one("gerade-100")))).toEqual({
      "gerade-100": [NO_NUMBER, PACK],
    });
    expect(termsOf(I.shoppingList(CATALOG, {}, one("gerade-114")))).toEqual({
      "gerade-114": [NO_NUMBER, IN_MACH8, PACK],
    });
    // Looping-Teil: erst die Baugruppe, dann die Vorlage (neu gegenüber M3a)
    expect(termsOf(I.shoppingList(CATALOG, {}, one("looping")))).toEqual({
      "looping-teil": [NO_NUMBER, LOOPING, IN_MACH8],
    });
    // dieselben Hinweise mit ausdrücklich übergebenen Produktvorlagen
    const shop = listWith(I);
    expect(termsOf(shop(CATALOG, {}, one("gerade-114"), productTemplates()))).toEqual({
      "gerade-114": [NO_NUMBER, IN_MACH8, PACK],
    });
  });

  test("[REQ-EINK-3] Teile mit Artikelnummer oder Prägung bekommen keine Vorlagen-Hinweise: Steilkehre-Teil, Kurve 1/90°, Anschlussstück, Gerade 342 wie in M3a", async () => {
    const I = await loadInventory();
    // alle vier stecken in Mach 8, keins bekommt „enthalten in Mach 8“
    const list = I.shoppingList(CATALOG, {}, [
      { id: "a", part: "steilkehre" },
      { id: "b", part: "anschlussstueck" },
      { id: "c", part: "gerade-342" },
    ]);
    expect(termsOf(list)).toEqual({
      "gerade-342": [art("20061602"), praeg("142202-1")],
      "kurve-1-90": [art("20061603")],
      anschlussstueck: [art("20061530"), art("20061666")],
      "steilkehre-teil": [praeg("141903-1B")],
    });
    const mach8 = productTemplates().find((t) => t.articleNumber === "20062492") as SetTemplate;
    for (const part of ["gerade-342", "kurve-1-90", "anschlussstueck", "steilkehre-teil"]) {
      expect(mach8.contents.map((c) => c.part)).toContain(part);
    }
  });

  test("[REQ-EINK-3] Wirkungsnachweis mit veränderter Vorlagenliste: ohne die neue Vorlage, Vorlage mit Gerade 342, Reihenfolge und Text aus der Vorlage", async () => {
    const I = await loadInventory();
    const shop = listWith(I);
    const product = productTemplates();
    const withoutPack = product.filter((t) => t.articleNumber !== "20061658");
    expect(withoutPack).toHaveLength(product.length - 1);
    const both: Elements = [
      { id: "a", part: "gerade-100" },
      { id: "b", part: "gerade-114" },
    ];
    // ohne die neue Vorlage: Gerade 114 nur Mach 8, Gerade 100 nur der Hinweis ohne Nummer
    expect(termsOf(shop(CATALOG, {}, both, withoutPack))).toEqual({
      "gerade-114": [NO_NUMBER, IN_MACH8],
      "gerade-100": [NO_NUMBER],
    });
    // leere Vorlagenliste: keine Vorlagen-Hinweise
    expect(termsOf(shop(CATALOG, {}, both, []))).toEqual({
      "gerade-114": [NO_NUMBER],
      "gerade-100": [NO_NUMBER],
    });

    // Vorlage mit Gerade 342 (hat eine Artikelnummer): kein Hinweis bei Gerade 342
    const extra: SetTemplate = {
      id: "test-paket",
      name: "Testpaket",
      articleNumber: "20069998",
      source: "Test",
      certainty: "niedrig",
      contents: [
        { part: "gerade-342", count: 2 },
        { part: "gerade-100", count: 1 },
        { part: "looping-teil", count: 1 },
      ],
    };
    const withExtra = [extra, ...product];
    expect(
      termsOf(
        shop(
          CATALOG,
          {},
          [...both, { id: "c", part: "gerade-342" }, { id: "d", part: "looping" }],
          withExtra,
        ),
      ),
    ).toEqual({
      "gerade-342": [art("20061602"), praeg("142202-1")],
      "gerade-114": [NO_NUMBER, IN_MACH8, PACK],
      // Vorlagenreihenfolge: das Testpaket steht vorn
      "gerade-100": [NO_NUMBER, hint("enthalten in Testpaket, Art.-Nr. 20069998"), PACK],
      // Baugruppen-Hinweis vor den Vorlagen-Hinweisen
      "looping-teil": [
        NO_NUMBER,
        LOOPING,
        hint("enthalten in Testpaket, Art.-Nr. 20069998"),
        IN_MACH8,
      ],
    });

    // umgekehrte Vorlagenreihenfolge kehrt die Hinweise um
    expect(termsOf(shop(CATALOG, {}, one("gerade-114"), [...product].reverse()))).toEqual({
      "gerade-114": [NO_NUMBER, PACK, IN_MACH8],
    });
    // Name und Nummer kommen aus der Vorlage, nicht aus festen Texten
    const renamed = product.map(
      (t): SetTemplate =>
        t.articleNumber === "20061658"
          ? { ...t, name: "Kurze Geraden", articleNumber: "20060001" }
          : t,
    );
    expect(termsOf(shop(CATALOG, {}, one("gerade-100"), renamed))).toEqual({
      "gerade-100": [NO_NUMBER, hint("enthalten in Kurze Geraden, Art.-Nr. 20060001")],
    });
    // Vorlagen-Hinweise ändern Zeilen und Mengen nicht
    expect(counts(shop(CATALOG, {}, both, withExtra))).toEqual(counts(shop(CATALOG, {}, both, [])));
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

describe("Nachtrag #1: Wireless-Anschluss und Steilkurve 1/45° in der Einkaufsliste", () => {
  test("[REQ-EINK-1] [REQ-EINK-3] geschlossener Kreis aus acht Steilkurven mit Wireless-Anschluss und Gerade 114, leerer Bestand: Steilkurve fehlt 8 „20061612“, Wireless-Anschluss 1 „20061673“, zusammen 10", async () => {
    const I = await loadInventory();
    const steile = (prefix: string): Elements =>
      Array.from({ length: 4 }, (_, i) => ({
        id: `${prefix}${i}`,
        part: "steilkurve-1-45",
        turn: "rechts" as const,
      }));
    const elements: Elements = [
      ...steile("s"),
      { id: "w", part: "wireless-anschluss" },
      ...steile("t"),
      { id: "g", part: "gerade-114" },
    ];
    // baubar: der Kern verfolgt die Strecke und sie schließt (Vermessung #1)
    const c = closure(CATALOG, elements, ORIGIN);
    expect(c.ok && c.closure.status).toBe("geschlossen");
    const list = listWith(I)(CATALOG, {}, elements, []);
    expect(counts(list)).toEqual([
      { partId: "gerade-114", needed: 1, have: 0, missing: 1 },
      { partId: "wireless-anschluss", needed: 1, have: 0, missing: 1 },
      { partId: "steilkurve-1-45", needed: 8, have: 0, missing: 8 },
    ]);
    expect(okList(list).total).toBe(10);
    const terms = Object.fromEntries(okList(list).rows.map((r) => [r.partId, r.searchTerms]));
    expect(terms["steilkurve-1-45"]).toEqual([art("20061612")]);
    expect(terms["wireless-anschluss"]).toEqual([art("20061673")]);
    // Bestand mit 4 Steilkurven, Wireless-Anschluss und Gerade 114: es fehlen nur noch 4 Steilkurven
    const half = listWith(I)(
      CATALOG,
      { "steilkurve-1-45": 4, "wireless-anschluss": 1, "gerade-114": 1 },
      elements,
      [],
    );
    expect(counts(half)).toEqual([{ partId: "steilkurve-1-45", needed: 8, have: 4, missing: 4 }]);
  });
});
