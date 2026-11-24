/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Bestand als reine Logik. Abnahmetests
 * REQ-BEST-2 und REQ-BEST-7 (Logikteil), REQ-SET-4 (Logikteil), REQ-SET-5.
 *
 * Schnittstelle (Typen: src/web/test-support/bestand-fixtures.ts), Modul
 * `src/web/editor/inventory.ts`:
 *   isStockable(catalog, partId), setCount(catalog, inv, partId, input: string),
 *   increment/decrement(catalog, inv, partId) → { ok: true, inventory } | { ok: false, text }
 *   decrementAvailable(catalog, inv, partId), addSet(inv, template), ignoredPartIds(catalog, inv)
 * Bestand = Teil-ID → Anzahl; fehlend = 0. Alle Funktionen sind rein und verändern ihre
 * Argumente nicht. Speichern, Laden und Meldungen der Sitzung prüft planner-session.test.ts.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  ASSEMBLY_IDS,
  AUSBAU1,
  anyInventoryArb,
  countIn,
  type Inventory,
  type InventoryChange,
  loadInventory,
  MACH8,
  normalized,
  plus,
  type SetTemplate,
  STOCKABLE_IDS,
  SUMME3,
  stockInventoryArb,
  sumOf,
  T_AUSBAU1,
  T_AUSBAU3,
  T_MACH8,
  T_WIRELESS,
  TEMPLATES,
  templateArb,
} from "../test-support/bestand-fixtures.js";
import { CATALOG, type CatalogEntry, UNKNOWN_ID } from "../test-support/editor-fixtures.js";

/** Bestand nach einer Änderung; bei Abweisung der alte. */
const applied = (before: Inventory, change: InventoryChange): Inventory =>
  change.ok ? change.inventory : before;

const rejected = (change: InventoryChange): string => {
  expect(change.ok).toBe(false);
  return change.ok ? "" : change.text;
};

const frozen = (inv: Inventory): Inventory => Object.freeze({ ...inv });

describe("Bestandsfähig", () => {
  test.skip("[REQ-BEST-2] bestandsfähig sind alle Katalogeinträge außer Baugruppen, auch nicht platzierbare", async () => {
    const I = await loadInventory();
    const stockable = CATALOG.filter((e) => I.isStockable(CATALOG, e.id)).map((e) => e.id);
    expect(stockable).toEqual(
      CATALOG.filter((e) => !["looping", "steilkehre"].includes(e.id)).map((e) => e.id),
    );
    for (const id of ["steilkurve-1-45", "wireless-anschluss", "looping-teil", "steilkehre-teil"]) {
      expect({ id, stockable: I.isStockable(CATALOG, id) }).toEqual({ id, stockable: true });
    }
    expect(I.isStockable(CATALOG, UNKNOWN_ID)).toBe(false);
    expect(I.isStockable(CATALOG, "")).toBe(false);
  });

  test.skip("[REQ-BEST-2] Wirkungsnachweis: bestandsfähig folgt dem übergebenen Katalog", async () => {
    const I = await loadInventory();
    const changed: ReadonlyArray<CatalogEntry> = CATALOG.map(
      (e): CatalogEntry =>
        e.id === "wireless-anschluss"
          ? { ...e, geometry: { kind: "baugruppe", parts: [{ part: "gerade-114", count: 1 }] } }
          : e.id === "steilkehre"
            ? { ...e, geometry: { kind: "masseFehlen" } }
            : e,
    );
    expect(I.isStockable(changed, "wireless-anschluss")).toBe(false);
    expect(I.isStockable(changed, "steilkehre")).toBe(true);
    expect(
      I.isStockable(
        CATALOG.filter((e) => e.id !== "gerade-342"),
        "gerade-342",
      ),
    ).toBe(false);
    expect(I.setCount(changed, {}, "wireless-anschluss", "1").ok).toBe(false);
    expect(applied({}, I.setCount(changed, {}, "steilkehre", "1"))).toEqual({ steilkehre: 1 });
  });
});

describe("Bestand ändern", () => {
  test.skip("[REQ-BEST-2] Beispiel: leerer Bestand, Kurve 1/90° auf 8, dann −1 → 7; Steilkehre auf 1 → abgewiesen", async () => {
    const I = await loadInventory();
    const a = I.setCount(CATALOG, frozen({}), "kurve-1-90", "8");
    expect(a).toEqual({ ok: true, inventory: expect.anything() });
    const eight = applied({}, a);
    expect(normalized(eight)).toEqual({ "kurve-1-90": 8 });
    const seven = applied(eight, I.decrement(CATALOG, frozen(eight), "kurve-1-90"));
    expect(normalized(seven)).toEqual({ "kurve-1-90": 7 });
    const text = rejected(I.setCount(CATALOG, frozen(seven), "steilkehre", "1"));
    expect(text.length).toBeGreaterThan(0);
  });

  test.skip("[REQ-BEST-2] Setzen ergibt genau den Wert, für jedes bestandsfähige Teil; andere Anzahlen bleiben", async () => {
    const I = await loadInventory();
    const base: Inventory = { ...MACH8, "gibt-es-nicht": 3 };
    for (const id of STOCKABLE_IDS) {
      for (const [input, value] of [
        ["0", 0],
        ["1", 1],
        ["8", 8],
        ["17", 17],
        ["250", 250],
      ] as const) {
        const next = applied(base, I.setCount(CATALOG, frozen(base), id, input));
        expect({ id, input, count: countIn(next, id) }).toEqual({ id, input, count: value });
        expect(normalized({ ...next, [id]: 0 })).toEqual(normalized({ ...base, [id]: 0 }));
      }
    }
  });

  test.skip("[REQ-BEST-2] +1 erhöht um eins, −1 senkt um eins, von jeder Anzahl aus", async () => {
    const I = await loadInventory();
    fc.assert(
      fc.property(stockInventoryArb, fc.constantFrom(...STOCKABLE_IDS), (inv, id) => {
        const up = I.increment(CATALOG, frozen(inv), id);
        expect(up.ok).toBe(true);
        expect(countIn(applied(inv, up), id)).toBe(countIn(inv, id) + 1);
        expect(normalized({ ...applied(inv, up), [id]: 0 })).toEqual(
          normalized({ ...inv, [id]: 0 }),
        );
        if (countIn(inv, id) >= 1) {
          const down = I.decrement(CATALOG, frozen(inv), id);
          expect(down.ok).toBe(true);
          expect(countIn(applied(inv, down), id)).toBe(countIn(inv, id) - 1);
          expect(normalized({ ...applied(inv, down), [id]: 0 })).toEqual(
            normalized({ ...inv, [id]: 0 }),
          );
        }
      }),
    );
  });

  test.skip("[REQ-BEST-2] −1 bei Anzahl 0 ist nicht verfügbar, ändert nichts und liefert keine Meldung", async () => {
    const I = await loadInventory();
    const cases: Inventory[] = [
      {},
      { "kurve-1-90": 0 },
      { "gerade-342": 3 },
      { "gerade-342": 3, [UNKNOWN_ID]: 2, steilkehre: 1 },
    ];
    for (const inv of cases) {
      expect(I.decrementAvailable(CATALOG, inv, "kurve-1-90")).toBe(false);
      const change = I.decrement(CATALOG, frozen(inv), "kurve-1-90");
      // keine Meldung: keine Abweisung (eine Abweisung trägt den Meldungstext)
      expect(change.ok).toBe(true);
      const next = applied(inv, change);
      expect(countIn(next, "kurve-1-90")).toBe(0);
      expect(normalized(next)).toEqual(normalized(inv));
    }
    // für jedes bestandsfähige Teil, auch nicht platzierbare
    for (const id of STOCKABLE_IDS.filter((p) => p !== "gerade-342")) {
      const change = I.decrement(CATALOG, frozen({ "gerade-342": 2 }), id);
      expect({ id, ok: change.ok }).toEqual({ id, ok: true });
      expect(normalized(applied({ "gerade-342": 2 }, change))).toEqual({ "gerade-342": 2 });
    }
    expect(I.decrementAvailable(CATALOG, { "kurve-1-90": 1 }, "kurve-1-90")).toBe(true);
    expect(I.decrementAvailable(CATALOG, { "kurve-1-90": 7 }, "kurve-1-90")).toBe(true);
    // nicht bestandsfähige IDs: nie verfügbar, auch mit Anzahl im Bestand (REQ-BEST-7)
    expect(I.decrementAvailable(CATALOG, { steilkehre: 2 }, "steilkehre")).toBe(false);
    expect(I.decrementAvailable(CATALOG, { [UNKNOWN_ID]: 2 }, UNKNOWN_ID)).toBe(false);
  });

  test.skip("[REQ-BEST-2] Eingaben, die keine ganze Zahl ≥ 0 sind, werden mit Meldung abgewiesen; der Bestand bleibt", async () => {
    const I = await loadInventory();
    const base: Inventory = { "kurve-1-90": 8, "gerade-342": 4 };
    const invalid = [
      "-3",
      "-1",
      "-0,5",
      "2,5",
      "2.5",
      "0.1",
      "",
      "abc",
      "3abc",
      "7 Kurven",
      "NaN",
      "Infinity",
      "+",
      "-",
    ];
    for (const input of invalid) {
      const change = I.setCount(CATALOG, frozen(base), "kurve-1-90", input);
      expect({ input, ok: change.ok }).toEqual({ input, ok: false });
      expect(rejected(change).length, input).toBeGreaterThan(0);
    }
  });

  test.skip("[REQ-BEST-2] unbekannte Teil-ID und Baugruppen werden bei Setzen, +1 und −1 abgewiesen", async () => {
    const I = await loadInventory();
    const base: Inventory = { "kurve-1-90": 8, steilkehre: 2, [UNKNOWN_ID]: 3 };
    for (const id of [UNKNOWN_ID, "", ...ASSEMBLY_IDS]) {
      for (const change of [
        I.setCount(CATALOG, frozen(base), id, "1"),
        I.increment(CATALOG, frozen(base), id),
        I.decrement(CATALOG, frozen(base), id),
      ]) {
        expect({ id, ok: change.ok }).toEqual({ id, ok: false });
        expect(rejected(change).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("Nicht zählende Einträge", () => {
  test.skip("[REQ-BEST-7] unbekannte und Baugruppen-IDs werden erkannt und bei Änderungen unverändert mitgeführt", async () => {
    const I = await loadInventory();
    const base: Inventory = { "kurve-1-90": 8, [UNKNOWN_ID]: 3, steilkehre: 1, looping: 2 };
    expect(I.ignoredPartIds(CATALOG, base)).toEqual([UNKNOWN_ID, "looping", "steilkehre"]);
    expect(I.ignoredPartIds(CATALOG, MACH8)).toEqual([]);
    expect(I.ignoredPartIds(CATALOG, {})).toEqual([]);
    const plusOne = applied(base, I.increment(CATALOG, frozen(base), "gerade-342"));
    expect(plusOne).toEqual({ ...base, "gerade-342": 1 });
    const set = applied(base, I.setCount(CATALOG, frozen(base), "kurve-1-90", "2"));
    expect(set).toEqual({ ...base, "kurve-1-90": 2 });
    expect(I.addSet(frozen(base), T_AUSBAU1)).toEqual(plus(base, AUSBAU1));
  });

  test.skip("[REQ-BEST-7] nicht zählende Einträge mit Anzahl 0 werden nicht gemeldet", async () => {
    const I = await loadInventory();
    const zeros: Inventory = { "kurve-1-90": 8, [UNKNOWN_ID]: 0, looping: 0 };
    expect(I.ignoredPartIds(CATALOG, zeros)).toEqual([]);
    expect(I.ignoredPartIds(CATALOG, { ...zeros, steilkehre: 2, "kurve-9-90": 0 })).toEqual([
      "steilkehre",
    ]);
  });
});

describe("Set-Vorlagen addieren", () => {
  test.skip("[REQ-SET-4] leerer Bestand + Mach 8 + Ausbauset 1 + Ausbauset 3 = Summenzeile; noch einmal Mach 8 → 18 / 16", async () => {
    const I = await loadInventory();
    let inv: Inventory = frozen({});
    for (const t of [T_MACH8, T_AUSBAU1, T_AUSBAU3]) inv = frozen(I.addSet(inv, t));
    expect(normalized(inv)).toEqual(normalized(SUMME3));
    expect(sumOf(inv)).toBe(49);
    inv = I.addSet(inv, T_MACH8);
    expect(countIn(inv, "gerade-342")).toBe(18);
    expect(countIn(inv, "looping-teil")).toBe(16);
    expect(countIn(inv, "kurve-1-45")).toBe(4);
    expect(normalized(I.addSet({}, T_WIRELESS))).toEqual({ "wireless-anschluss": 1 });
  });

  test.skip("[REQ-SET-4] andere Anzahlen und nicht zählende Einträge bleiben unverändert", async () => {
    const I = await loadInventory();
    const base: Inventory = { "kurve-1-90": 3, "gerade-171": 5, [UNKNOWN_ID]: 3, looping: 1 };
    expect(I.addSet(frozen(base), T_AUSBAU3)).toEqual({
      ...base,
      "gerade-342": 8,
      "kurve-1-45": 4,
      "steilkurve-1-45": 4,
    });
  });

  test.skip("[REQ-SET-5] Eigenschaft: Reihenfolge egal, Summe steigt genau um die Summe der Inhalte", async () => {
    const I = await loadInventory();
    const templatesArb = fc.array(fc.oneof(fc.constantFrom(...TEMPLATES), templateArb), {
      maxLength: 6,
    });
    fc.assert(
      fc.property(
        anyInventoryArb,
        templatesArb.chain((ts) =>
          fc.tuple(fc.constant(ts), fc.shuffledSubarray(ts, { minLength: ts.length })),
        ),
        (start, [ts, shuffled]) => {
          const addAll = (list: ReadonlyArray<SetTemplate>): Inventory =>
            list.reduce((inv, t) => I.addSet(frozen(inv), t), start);
          const a = addAll(ts);
          const b = addAll(shuffled);
          expect(normalized(a)).toEqual(normalized(b));
          const added = ts.reduce((s, t) => s + t.contents.reduce((x, c) => x + c.count, 0), 0);
          expect(sumOf(a)).toBe(sumOf(start) + added);
          // je Teil: Start + Inhalte
          let expected = start;
          for (const t of ts) {
            expected = plus(expected, Object.fromEntries(t.contents.map((c) => [c.part, c.count])));
          }
          expect(normalized(a)).toEqual(normalized(expected));
        },
      ),
    );
  });
});
