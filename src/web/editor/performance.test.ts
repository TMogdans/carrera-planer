/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Editor-Logik — Leistung. Abnahmetest REQ-EDIT-20.
 *
 * Ein Befehl (Anhängen am Ende) samt Neuberechnung von Status, Fehlern, Verbrauch, Länge,
 * gezeichnetem Abschnitt und Querungs-Verfügbarkeit auf einer fehlerfreien Folge mit 1000
 * Elementen. Gemessen wird jeder der 20 Durchläufe einzeln, ohne Aufwärmlauf; die Schwelle gilt
 * für das **Maximum**, nicht den Mittelwert. Ausgegeben werden Maximum und Median.
 *
 * Folge: 100 × die Acht aus der M1-Tabelle mit eigenen IDs (jede Acht schließt auf der Startpose,
 * also fehlerfrei und mit 100 Kreuzungen und Querungen).
 *
 * Schnittstelle: editor.ts (apply, crossingTarget), status.ts (statusOf, errorEntries,
 * consumptionView, totalLength), drawing.ts (drawnSection); siehe
 * src/web/test-support/editor-fixtures.ts.
 */
import { expect, test } from "vitest";
import { closure } from "../../core/index.js";
import {
  ACHT,
  CATALOG,
  type LayoutElement,
  loadDrawing,
  loadEditor,
  loaded,
  loadStatus,
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

test.skip("[REQ-EDIT-20] 1000 Elemente: Anhängen samt Neuberechnung höchstens 250 ms im Maximum über 20 Durchläufe", async () => {
  const E = await loadEditor();
  const S = await loadStatus();
  const D = await loadDrawing();
  expect(thousand).toHaveLength(1000);
  const ok = closure(CATALOG, thousand, ORIGIN);
  expect(ok.ok && ok.closure.status).toBe("geschlossen");

  const base = loaded(E, thousand);
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const t0 = performance.now();
    const next = E.apply(CATALOG, base, { type: "choosePart", partId: "gerade-114" });
    const status = S.statusOf(CATALOG, next.elements);
    const errors = S.errorEntries(CATALOG, next.elements);
    const usage = S.consumptionView(CATALOG, next.elements);
    const length = S.totalLength(CATALOG, next.elements);
    const drawn = D.drawnSection(CATALOG, next.elements);
    const target = E.crossingTarget(CATALOG, next.elements);
    const t1 = performance.now();
    times.push(t1 - t0);
    // Ergebnisse prüfen, damit nichts wegoptimiert wird und die Arbeit wirklich stattfand
    expect(next.elements).toHaveLength(1001);
    expect(status).toEqual({ kind: "offen", gapText: "114 mm", angleDeg: 0 });
    expect(errors).toEqual([]);
    // Querungen verbrauchen nichts: 1000 − 100 Querungen + 1 angehängte Gerade
    expect(usage.ok && usage.total).toBe(901);
    expect(length).toBeGreaterThan(0);
    expect(drawn.drawnCount).toBe(1001);
    expect(target).toBeUndefined();
  }
  const sorted = [...times].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] as number;
  const median = ((sorted[RUNS / 2 - 1] as number) + (sorted[RUNS / 2] as number)) / 2;
  console.log(
    `[REQ-EDIT-20] ${RUNS} Durchläufe, 1000 Elemente: Maximum ${max.toFixed(1)} ms, Median ${median.toFixed(1)} ms`,
  );
  expect(times).toHaveLength(RUNS);
  expect(max).toBeLessThanOrEqual(LIMIT_MS);
});
