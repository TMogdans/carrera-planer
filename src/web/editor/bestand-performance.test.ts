/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Leistung im Bestandsmodus. Abnahmetest
 * REQ-BARCH-4 (Muster wie REQ-EDIT-20 in performance.test.ts).
 *
 * Ein Befehl im Modus „Bestand“ (Anhängen am Ende) samt Bestandsprüfung, Leisten-Einteilung mit
 * Rest und Einkaufsliste auf einer fehlerfreien Folge mit 1000 Elementen und einem Bestand, der
 * sie samt dem angehängten Teil deckt. Jeder der 20 Durchläufe wird einzeln gemessen, ohne
 * Aufwärmlauf; die Schwelle gilt für das Maximum. Ausgegeben werden Maximum und Median.
 *
 * Folge: 100 × die Acht aus der M1-Tabelle mit eigenen IDs (fehlerfrei, geschlossen).
 */
import { expect, test } from "vitest";
import { closure, consumption } from "../../core/index.js";
import { loadInventory, plus } from "../test-support/bestand-fixtures.js";
import {
  ACHT,
  CATALOG,
  type LayoutElement,
  loadEditor,
  loaded,
  ORIGIN,
} from "../test-support/editor-fixtures.js";

const RUNS = 20;
const LIMIT_MS = 250;

const thousand: ReadonlyArray<LayoutElement> = Array.from({ length: 100 }, (_, k) =>
  ACHT.map(
    (el): LayoutElement =>
      "crosses" in el
        ? { id: `a${k}-${el.id}`, crosses: `a${k}-${el.crosses}` }
        : { ...el, id: `a${k}-${el.id}` },
  ),
).flat();

test.skip("[REQ-BARCH-4] 1000 Elemente im Bestandsmodus: Anhängen samt Prüfung, Leiste und Einkaufsliste höchstens 250 ms im Maximum über 20 Durchläufe", async () => {
  const E = await loadEditor();
  const I = await loadInventory();
  expect(thousand).toHaveLength(1000);
  const ok = closure(CATALOG, thousand, ORIGIN);
  expect(ok.ok && ok.closure.status).toBe("geschlossen");
  const used = consumption(CATALOG, thousand);
  if (!used.ok) throw new Error("Testdaten-Fehler: Verbrauch nicht bestimmbar");
  const inventory = plus(used.counts, { "gerade-114": 1 });

  const base = loaded(E, thousand);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const t0 = performance.now();
    const r = I.applyInMode(CATALOG, inventory, "bestand", base, {
      type: "choosePart",
      partId: "gerade-114",
    });
    const palette = I.stockPalette(CATALOG, inventory, r.state.elements);
    const list = I.shoppingList(CATALOG, inventory, r.state.elements);
    const t1 = performance.now();
    times.push(t1 - t0);
    // Ergebnisse prüfen, damit die Arbeit wirklich stattfand
    expect(r.rejection).toBeUndefined();
    expect(r.state.elements).toHaveLength(1001);
    expect(palette.find((e) => e.partId === "gerade-114")).toMatchObject({
      stock: 101,
      rest: 0,
      locked: true,
    });
    expect(palette.find((e) => e.partId === "kurve-1-90")?.rest).toBe(0);
    expect(list.ok && list.rows).toEqual([]);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] as number;
  const median = ((sorted[RUNS / 2 - 1] as number) + (sorted[RUNS / 2] as number)) / 2;
  console.log(
    `[REQ-BARCH-4] ${RUNS} Durchläufe, 1000 Elemente: Maximum ${max.toFixed(1)} ms, Median ${median.toFixed(1)} ms`,
  );
  expect(times).toHaveLength(RUNS);
  expect(max).toBeLessThanOrEqual(LIMIT_MS);
});
