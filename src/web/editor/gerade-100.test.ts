/**
 * Spec gerade-100 (.specify/specs/gerade-100/spec.md): Gerade 100 im Kern, in Leiste, Bestand und
 * Einkaufsliste. Abnahmetests REQ-G100-4 bis REQ-G100-8 und REQ-G100-10.
 *
 * Schnittstellen unverändert aus M1/M2/M3a (Typen: src/web/test-support/*.ts, geschützt): Kern
 * `closure`/`trace`, `statusOf`, `paletteEntries`, `apply`, `stockPalette`, `applyInMode`,
 * `addSet`, `shoppingList`, `createPlannerSession`. Die Packung 20061658 wird über ihre
 * Artikelnummer in `SET_TEMPLATES` gefunden (ID frei).
 *
 * Orakel: Erwartete Versätze stehen exakt (a + b·√2) in der Spec; die Eigenschaft zu REQ-G100-6
 * rechnet die Eingangsrichtung unabhängig vom Kern aus den Kurvenwinkeln.
 *
 * REQ-G100-8 (keine Datei unter src/core, src/schema, src/server und im geschützten Satz) ist eine
 * Eigenschaft des PR-Diffs; hier steht nur der Wirkungsteil: Die Testhilfen leiten ihre Teillisten
 * aus `CATALOG` ab und erfassen Gerade 100 ohne Änderung. REQ-G100-9 (Mutations-Ratchet) prüft der
 * CI-Job `mutation`, kein Vitest-Test.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { closure, trace } from "../../core/index.js";
import {
  type Inventory,
  loadInventory,
  loadPlannerSession,
  MACH8,
  normalized,
  plus,
  productTemplates,
  type SearchTerm,
  type SetTemplate,
  type ShoppingList,
  STOCKABLE_IDS,
} from "../test-support/bestand-fixtures.js";
import {
  ALL_PART_IDS,
  CATALOG,
  type Coord,
  fixedClock,
  isCurve,
  type LayoutElement,
  loadEditor,
  loadStatus,
  MemoryStorage,
  type Offset,
  ORIGIN,
  PLACEABLE_IDS,
  type Pose,
  type Rational,
  UNPLACEABLE_IDS,
  validElementsArb,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

// ---------------------------------------------------------------------------------------------
// Exakte Zahlen a + b·√2
// ---------------------------------------------------------------------------------------------

/** Exakter Bruch als [Zähler, Nenner] mit positivem Nenner, gekürzt. */
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const norm = (r: Rational): [bigint, bigint] => {
  if (r.den === 0n) throw new Error("Nenner 0");
  const s = r.den < 0n ? -1n : 1n;
  const g = gcd(r.num, r.den) || 1n;
  return [(s * r.num) / g, (s * r.den) / g];
};
/** Koordinate als Text „a + b·√2“ mit gekürzten Brüchen (für lesbare, exakte Vergleiche). */
const show = (c: Coord): string => {
  const f = (r: Rational) => {
    const [n, d] = norm(r);
    return d === 1n ? `${n}` : `${n}/${d}`;
  };
  return `${f(c.a)} + ${f(c.b)}·√2`;
};
const offsetText = (o: Offset) => ({ dx: show(o.dx), dy: show(o.dy) });
const sub = (x: Rational, y: Rational): Rational => ({
  num: x.num * y.den - y.num * x.den,
  den: x.den * y.den,
});
const diff = (x: Coord, y: Coord): Coord => ({ a: sub(x.a, y.a), b: sub(x.b, y.b) });

/** 14·e(k) als Versatzänderung (dx, dy), jeweils a + b·√2. */
const H = 7n; // 14·(√2/2) = 7·√2
const FOURTEEN_E: ReadonlyArray<readonly [string, string]> = [
  ["14 + 0·√2", "0 + 0·√2"],
  [`0 + ${H}·√2`, `0 + ${H}·√2`],
  ["0 + 0·√2", "14 + 0·√2"],
  [`0 + ${-H}·√2`, `0 + ${H}·√2`],
  ["-14 + 0·√2", "0 + 0·√2"],
  [`0 + ${-H}·√2`, `0 + ${-H}·√2`],
  ["0 + 0·√2", "-14 + 0·√2"],
  [`0 + ${H}·√2`, `0 + ${-H}·√2`],
];

const offsetOf = (elements: Elements, start: Pose = ORIGIN) => {
  const r = closure(CATALOG, elements, start);
  if (!r.ok) throw new Error(`closure fehlerhaft: ${JSON.stringify(r.errors)}`);
  if (r.closure.status === "leer") throw new Error("leere Folge");
  return r.closure;
};

// ---------------------------------------------------------------------------------------------
// Testdaten aus der Spec
// ---------------------------------------------------------------------------------------------

const L = "links" as const;
const R = "rechts" as const;

/** Abschnitt „Hobby-Layout“ der Spec, Elemente e1 … e44. */
const HOBBY_PARTS: ReadonlyArray<readonly [string, ("links" | "rechts")?]> = [
  ["rundenzaehler"],
  ["gerade-114"],
  ["anschlussstueck"],
  ["gerade-114"],
  ["spurwechsel-gerade"],
  ["gerade-114"],
  ["gerade-114"],
  ["gerade-342"],
  ["kurve-2-45", L],
  ["kurve-1-90", L],
  ["kurve-2-45", L],
  ["kurve-3-45", L], // e12
  ["kurve-3-45", R],
  ["gerade-342"],
  ["kurve-2-45", R],
  ["gerade-342"],
  ["kurve-2-45", R],
  ["kurve-2-45", R],
  ["kurve-3-45", R],
  ["gerade-342"],
  ["gerade-171"],
  ["gerade-114"],
  ["gerade-114"], // e23
  ["gerade-342"],
  ["kurve-2-45", R],
  ["kurve-1-45", R],
  ["kurve-1-90", R],
  ["gerade-171"],
  ["spurwechsel-gerade"],
  ["gerade-114"],
  ["gerade-342"],
  ["kurve-3-45", L],
  ["gerade-342"],
  ["kurve-3-45", R], // e34
  ["kurve-1-45", R],
  ["kurve-2-45", R],
  ["kurve-3-45", R],
  ["kurve-1-90", L],
  ["kurve-1-90", L],
  ["kurve-2-45", L],
  ["gerade-342"],
  ["kurve-3-45", L],
  ["kurve-3-45", L],
  ["gerade-342"],
];
const HOBBY: Elements = HOBBY_PARTS.map(
  ([part, turn], i): LayoutElement =>
    turn === undefined ? { id: `e${i + 1}`, part } : { id: `e${i + 1}`, part, turn },
);
/** Hobby-Layout mit Gerade 100 an Element `e<n>`. */
const hobbyWith100At = (n: number): Elements =>
  HOBBY.map((el) => (el.id === `e${n}` ? { id: el.id, part: "gerade-100" } : el));

/** Oval aus REQ-G100-5: Gerade 100, 2 × Kurve 1/90° L, Gerade 100, 2 × Kurve 1/90° L. */
const OVAL_100: Elements = [
  { id: "o1", part: "gerade-100" },
  { id: "o2", part: "kurve-1-90", turn: L },
  { id: "o3", part: "kurve-1-90", turn: L },
  { id: "o4", part: "gerade-100" },
  { id: "o5", part: "kurve-1-90", turn: L },
  { id: "o6", part: "kurve-1-90", turn: L },
];

const pack = (): SetTemplate => {
  const t = productTemplates().find((x) => x.articleNumber === "20061658");
  if (t === undefined) throw new Error("Vorlage 20061658 fehlt in SET_TEMPLATES");
  return t;
};
const templateByNumber = (nr: string): SetTemplate => {
  const t = productTemplates().find((x) => x.articleNumber === nr);
  if (t === undefined) throw new Error(`Vorlage ${nr} fehlt`);
  return t;
};
const nameOf = (id: string): string => CATALOG.find((e) => e.id === id)?.name as string;

// ---------------------------------------------------------------------------------------------
// REQ-G100-5 / -6: Kern
// ---------------------------------------------------------------------------------------------

describe("Gerade 100 im Kern", () => {
  test.skip("[REQ-G100-5] Gerade 100 allein → Versatz −100; Gerade 100 + Gerade 114 → −214; Oval aus Geraden 100 geschlossen", async () => {
    const one = offsetOf([{ id: "a", part: "gerade-100" }]);
    expect({ status: one.status, angle: one.angleSteps, ...offsetText(one.offset) }).toEqual({
      status: "offen",
      angle: 0,
      dx: "-100 + 0·√2",
      dy: "0 + 0·√2",
    });
    const two = offsetOf([
      { id: "a", part: "gerade-100" },
      { id: "b", part: "gerade-114" },
    ]);
    expect({ status: two.status, angle: two.angleSteps, ...offsetText(two.offset) }).toEqual({
      status: "offen",
      angle: 0,
      dx: "-214 + 0·√2",
      dy: "0 + 0·√2",
    });
    const oval = closure(CATALOG, OVAL_100, ORIGIN);
    expect(oval.ok && oval.closure.status).toBe("geschlossen");
    if (oval.ok && oval.closure.status === "geschlossen") {
      expect(offsetText(oval.closure.offset)).toEqual({ dx: "0 + 0·√2", dy: "0 + 0·√2" });
      expect(oval.closure.angleSteps).toBe(0);
    }
    const S = await loadStatus();
    expect(S.statusOf(CATALOG, OVAL_100)).toEqual({ kind: "geschlossen" });
  });

  test.skip("[REQ-G100-5] aus (0, 0, k) verschiebt Gerade 100 um exakt 100 mm in Richtung k, für alle k", () => {
    const h = 50n; // 100·(√2/2) = 50·√2
    const expected: ReadonlyArray<readonly [string, string]> = [
      ["100 + 0·√2", "0 + 0·√2"],
      [`0 + ${h}·√2`, `0 + ${h}·√2`],
      ["0 + 0·√2", "100 + 0·√2"],
      [`0 + ${-h}·√2`, `0 + ${h}·√2`],
      ["-100 + 0·√2", "0 + 0·√2"],
      [`0 + ${-h}·√2`, `0 + ${-h}·√2`],
      ["0 + 0·√2", "-100 + 0·√2"],
      [`0 + ${h}·√2`, `0 + ${-h}·√2`],
    ];
    for (let k = 0; k < 8; k++) {
      const start: Pose = { ...ORIGIN, dir: k as Pose["dir"] };
      const r = trace(CATALOG, [{ id: "a", part: "gerade-100" }], start);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect({ k, x: show(r.end.x), y: show(r.end.y), dir: r.end.dir }).toEqual({
        k,
        x: expected[k]?.[0],
        y: expected[k]?.[1],
        dir: k,
      });
    }
  });

  test.skip("[REQ-G100-6] Hobby-Layout: 17 mm mit Gerade 114, 4 mm mit Gerade 100 an e2, 31 mm an e30 (exakt, offen, Winkel 0)", async () => {
    const S = await loadStatus();
    expect(HOBBY).toHaveLength(44);
    expect(HOBBY.filter((e) => "part" in e && e.part === "gerade-114")).toHaveLength(7);
    const cases: ReadonlyArray<readonly [Elements, string, string, string]> = [
      [HOBBY, "-1710 + 1197·√2", "1368 + -969·√2", "17 mm"],
      [hobbyWith100At(2), "-1696 + 1197·√2", "1368 + -969·√2", "4 mm"],
      [hobbyWith100At(30), "-1724 + 1197·√2", "1368 + -969·√2", "31 mm"],
    ];
    for (const [elements, dx, dy, gap] of cases) {
      const c = offsetOf(elements);
      expect({ status: c.status, angle: c.angleSteps, ...offsetText(c.offset) }).toEqual({
        status: "offen",
        angle: 0,
        dx,
        dy,
      });
      expect(S.statusOf(CATALOG, elements)).toEqual({ kind: "offen", gapText: gap, angleDeg: 0 });
    }
    // Tausch an e4, e6, e7, e22 oder e23 (alle in Richtung k = 0) wirkt wie an e2
    for (const n of [4, 6, 7, 22, 23]) {
      expect({ n, ...offsetText(offsetOf(hobbyWith100At(n)).offset) }).toEqual({
        n,
        dx: "-1696 + 1197·√2",
        dy: "1368 + -969·√2",
      });
      expect(S.statusOf(CATALOG, hobbyWith100At(n))).toEqual({
        kind: "offen",
        gapText: "4 mm",
        angleDeg: 0,
      });
    }
  });

  test.skip("[REQ-G100-6] Eigenschaft: Gerade 114 → Gerade 100 ändert den Versatz genau um 14·e(k); √2-Anteil bleibt bei geradem k", () => {
    /** Eingangsrichtung von Element i, unabhängig vom Kern aus den Kurvenwinkeln. */
    const entryDir = (elements: Elements, i: number): number => {
      let k = 0;
      for (const el of elements.slice(0, i)) {
        if (!("part" in el)) continue;
        const g = CATALOG.find((e) => e.id === el.part)?.geometry;
        if (g?.kind === "kurve") k += (el.turn === "links" ? 1 : -1) * (g.angle / 45);
      }
      return ((k % 8) + 8) % 8;
    };
    fc.assert(
      fc.property(validElementsArb, fc.nat(), (base, at) => {
        const pos = at % (base.length + 1);
        const with114: Elements = [
          ...base.slice(0, pos),
          { id: "g", part: "gerade-114" },
          ...base.slice(pos),
        ];
        const with100 = with114.map((el) => (el.id === "g" ? { id: "g", part: "gerade-100" } : el));
        const before = offsetOf(with114);
        const after = offsetOf(with100);
        const k = entryDir(with114, pos);
        const d = {
          dx: diff(after.offset.dx, before.offset.dx),
          dy: diff(after.offset.dy, before.offset.dy),
        };
        const [ex, ey] = FOURTEEN_E[k] as readonly [string, string];
        expect({ k, dx: show(d.dx), dy: show(d.dy) }).toEqual({ k, dx: ex, dy: ey });
        expect(after.angleSteps).toBe(before.angleSteps);
        if (k % 2 === 0) {
          expect(show({ a: { num: 0n, den: 1n }, b: d.dx.b })).toBe("0 + 0·√2");
          expect(show({ a: { num: 0n, den: 1n }, b: d.dy.b })).toBe("0 + 0·√2");
        }
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-G100-4 / -7 / -8: Vorlage, Leiste, Bestandsmodus, Testhilfen
// ---------------------------------------------------------------------------------------------

describe("Gerade 100 in Bestand und Leiste", () => {
  test.skip("[REQ-G100-4] Vorlage „Geraden 3 × 100 + 3 × 114“ bestätigt: je +3 für Gerade 100 und 114; leer + Mach 8 + Vorlage → 114: 4, 100: 3, 342: 4", async () => {
    const api = await loadPlannerSession();
    const s = api.createPlannerSession({
      catalog: CATALOG,
      templates: productTemplates(),
      storage: new MemoryStorage(),
      clock: fixedClock("2026-11-24T07:15:00.000Z"),
    });
    expect(normalized(s.inventory)).toEqual({});
    s.addSet(pack().id, false);
    expect(normalized(s.inventory)).toEqual({});
    s.addSet(templateByNumber("20062492").id, true);
    s.addSet(pack().id, true);
    expect(normalized(s.inventory)).toEqual(
      normalized(plus(MACH8, { "gerade-100": 3, "gerade-114": 3 })),
    );
    expect(s.inventory["gerade-114"]).toBe(4);
    expect(s.inventory["gerade-100"]).toBe(3);
    expect(s.inventory["gerade-342"]).toBe(4);

    // reine Logik: nur die beiden Geraden steigen, je um 3
    const I = await loadInventory();
    const start: Inventory = { "gerade-342": 2, "gerade-100": 1, "gibt-es-nicht": 5 };
    expect(I.addSet(start, pack())).toEqual({
      "gerade-342": 2,
      "gerade-100": 4,
      "gerade-114": 3,
      "gibt-es-nicht": 5,
    });
  });

  test.skip("[REQ-G100-4] Inhalt für die Rückfrage: Gerade 100 × 3, Gerade 114 × 3, zusammen 6 Teile, Art.-Nr. 20061658, Sicherheit hoch (kein „Inhalt ungeprüft“)", () => {
    const t = pack();
    expect(t.name).toBe("Geraden 3 × 100 + 3 × 114");
    expect(t.certainty).toBe("hoch");
    expect(t.contents.map((c) => `${nameOf(c.part)} × ${c.count}`)).toEqual([
      "Gerade 100 × 3",
      "Gerade 114 × 3",
    ]);
    expect(`zusammen ${t.contents.reduce((n, c) => n + c.count, 0)} Teile`).toBe(
      "zusammen 6 Teile",
    );
  });

  test.skip("[REQ-G100-7] Sandbox: Gerade 100 platzierbar, in der Leiste direkt nach Gerade 114, anhängbar", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const entries = E.paletteEntries(CATALOG);
    const at = entries.findIndex((e) => e.partId === "gerade-114");
    expect(entries[at + 1]).toEqual({
      partId: "gerade-100",
      name: "Gerade 100",
      kind: "platzierbar",
    });
    const s = E.apply(CATALOG, E.initialState(), { type: "choosePart", partId: "gerade-100" });
    expect(s.elements.map((e) => ("part" in e ? e.part : undefined))).toEqual(["gerade-100"]);
    expect(s.elements[0]).not.toHaveProperty("turn");
    const m = I.applyInMode(CATALOG, {}, "sandbox", E.initialState(), {
      type: "choosePart",
      partId: "gerade-100",
    });
    expect(m.rejection).toBeUndefined();
    expect(m.state.elements).toEqual(s.elements);
  });

  test.skip("[REQ-G100-7] Bestandsmodus: ohne die Packung keine Gerade 100; mit Packung Bestand 3 direkt nach Gerade 114; vierte Gerade 100 abgewiesen", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const add = (inv: Inventory, nr: string) => I.addSet(inv, templateByNumber(nr));
    const mach8 = add({}, "20062492");
    const ausbau1 = add({}, "20061600");
    const ausbau3 = add({}, "20061614");
    const summe = add(add(mach8, "20061600"), "20061614");
    for (const inv of [mach8, ausbau1, ausbau3, summe]) {
      expect(I.stockPalette(CATALOG, inv, []).map((e) => e.partId)).not.toContain("gerade-100");
    }
    const withPack = I.addSet(mach8, pack());
    const palette = I.stockPalette(CATALOG, withPack, []);
    const at = palette.findIndex((e) => e.partId === "gerade-114");
    expect(palette[at + 1]).toEqual({
      partId: "gerade-100",
      name: "Gerade 100",
      kind: "platzierbar",
      stock: 3,
      rest: 3,
      locked: false,
    });

    let s = E.initialState();
    const choose = { type: "choosePart", partId: "gerade-100" } as const;
    for (let i = 0; i < 3; i++) {
      const r = I.applyInMode(CATALOG, withPack, "bestand", s, choose);
      expect(r.rejection).toBeUndefined();
      s = r.state;
    }
    expect(s.elements).toHaveLength(3);
    expect(
      I.stockPalette(CATALOG, withPack, s.elements).find((e) => e.partId === "gerade-100"),
    ).toMatchObject({
      stock: 3,
      rest: 0,
      locked: true,
    });
    const fourth = I.applyInMode(CATALOG, withPack, "bestand", s, choose);
    expect(fourth.rejection?.partId).toBe("gerade-100");
    expect(fourth.rejection?.name).toBe("Gerade 100");
    expect(fourth.state).toBe(s);
  });

  test.skip("[REQ-G100-8] Testhilfen erfassen Gerade 100 ohne Änderung: Teillisten und Erzeuger aus CATALOG", () => {
    expect(PLACEABLE_IDS.indexOf("gerade-100")).toBe(PLACEABLE_IDS.indexOf("gerade-114") + 1);
    expect(PLACEABLE_IDS.indexOf("gerade-114")).toBeGreaterThanOrEqual(0);
    expect(UNPLACEABLE_IDS).not.toContain("gerade-100");
    expect(STOCKABLE_IDS).toContain("gerade-100");
    expect(ALL_PART_IDS).toContain("gerade-100");
    expect(isCurve(CATALOG, "gerade-100")).toBe(false);
    const samples = fc.sample(validElementsArb, { numRuns: 300, seed: 100 });
    expect(samples.some((els) => els.some((e) => "part" in e && e.part === "gerade-100"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-G100-10: Einkaufsliste mit Einzelteilen
// ---------------------------------------------------------------------------------------------

describe("Gerade 100 in der Einkaufsliste", () => {
  const hint = (text: string): SearchTerm => ({ kind: "hinweis", text });
  const NO_NUMBER = hint("keine Artikelnummer, keine Prägung bekannt");
  const PACK = hint("enthalten in Geraden 3 × 100 + 3 × 114, Art.-Nr. 20061658");
  const okList = (list: ShoppingList) => {
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

  test.skip("[REQ-G100-10] Oval mit Geraden 100, leerer Bestand: Gerade 100 fehlt 2, Kurve 1/90° fehlt 4, zusammen 6, Katalogreihenfolge", async () => {
    const I = await loadInventory();
    const list = okList(I.shoppingList(CATALOG, {}, OVAL_100));
    expect(counts(list)).toEqual([
      { partId: "gerade-100", needed: 2, have: 0, missing: 2 },
      { partId: "kurve-1-90", needed: 4, have: 0, missing: 4 },
    ]);
    expect(list.total).toBe(6);
    expect(list.rows[0]?.name).toBe("Gerade 100");
    expect(list.rows[0]?.searchTerms).toEqual([NO_NUMBER, PACK]);
  });

  test.skip("[REQ-G100-10] Hobby-Layout mit Gerade 100 an e2, Bestand Mach 8: getrennte Zeilen ohne Packungsrundung, beide mit Hinweis auf 20061658", async () => {
    const I = await loadInventory();
    const mach8 = I.addSet({}, templateByNumber("20062492"));
    const list = okList(I.shoppingList(CATALOG, mach8, hobbyWith100At(2)));
    const rows = list.rows.filter((r) => r.partId === "gerade-100" || r.partId === "gerade-114");
    expect(
      rows.map(({ partId, needed, have, missing }) => ({ partId, needed, have, missing })),
    ).toEqual([
      { partId: "gerade-114", needed: 6, have: 1, missing: 5 },
      { partId: "gerade-100", needed: 1, have: 0, missing: 1 },
    ]);
    for (const r of rows) expect(r.searchTerms).toContainEqual(PACK);
    // nur Katalogteile als Zeilen, keine Packungszeile, keine Packungsnummer als Artikelnummer
    const ids = new Set(CATALOG.map((e) => e.id));
    for (const r of list.rows) {
      expect(ids.has(r.partId)).toBe(true);
      expect(r.searchTerms).not.toContainEqual({
        kind: "artikelnummer",
        value: "20061658",
        text: "20061658",
      });
    }
    expect(list.total).toBe(list.rows.reduce((n, r) => n + r.missing, 0));

    // Bestand Mach 8 + zweimal die Packung: keine der beiden Geraden fehlt mehr
    const topped = I.addSet(I.addSet(mach8, pack()), pack());
    const after = okList(I.shoppingList(CATALOG, topped, hobbyWith100At(2)));
    expect(after.rows.map((r) => r.partId)).not.toContain("gerade-100");
    expect(after.rows.map((r) => r.partId)).not.toContain("gerade-114");
    // die übrigen Zeilen bleiben, die Summe sinkt genau um 5 + 1
    expect(after.total).toBe(list.total - 6);
  });
});
