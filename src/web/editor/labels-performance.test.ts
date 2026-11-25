/**
 * Spec plan-beschriftung-symbole (.specify/specs/plan-beschriftung-symbole/spec.md): Leistung der
 * Beschriftung. Abnahmetest REQ-PARCH-3.
 *
 * Die Beschriftungen werden bei jedem Zoom- und Verschiebeschritt neu bestimmt; die
 * Zeichengeometrie (`drawing`) ändert sich dabei nicht und wird einmal vorab gerechnet. Gemessen
 * wird je Durchlauf die Bestimmung von Variante und Ort aller Elemente (`labelPlan`) für eine
 * Ansicht, 20 Durchläufe einzeln, ohne Aufwärmlauf, jeder mit anderem Maßstab (Zoomschritte). Die
 * Schwelle (16 ms, ein Bild bei 60 Hz) gilt für das **Maximum**; ausgegeben werden Maximum und
 * Median.
 *
 * Folge: 100 × die Acht (M1-Tabelle) mit eigenen IDs: fehlerfrei, 1000 Elemente, davon 100
 * Querungen (ohne Eintrag), 100 Kreuzungen und 100 Anschlussstücke (Symbolteil).
 *
 * Schnittstelle: labelPlan, siehe labels.test.ts.
 */
import { expect, test } from "vitest";
import { closure } from "../../core/index.js";
import {
  ACHT,
  CATALOG,
  type CatalogEntry,
  type ElementShape,
  type LayoutElement,
  loadDrawing,
  ORIGIN,
  type ScreenPoint,
} from "../test-support/editor-fixtures.js";

type Catalog = ReadonlyArray<CatalogEntry>;
type Elements = ReadonlyArray<LayoutElement>;
type LabelEntry = {
  readonly id: string;
  readonly variant: string;
  readonly text: string | undefined;
  readonly symbol: string | undefined;
  readonly at: ScreenPoint;
};
type LabelsApi = {
  labelPlan(
    catalog: Catalog,
    elements: Elements,
    shapes: ReadonlyArray<ElementShape>,
    scale: number,
    on: boolean,
  ): ReadonlyArray<LabelEntry>;
};

const LABELS_MODULE = "./labels.js";
const RUNS = 20;
const LIMIT_MS = 16;

const thousand: Elements = Array.from({ length: 100 }, (_, k) =>
  ACHT.map(
    (el): LayoutElement =>
      "crosses" in el
        ? { id: `a${k}-${el.id}`, crosses: `a${k}-${el.crosses}` }
        : { ...el, id: `a${k}-${el.id}` },
  ),
).flat();

test("[REQ-PARCH-3] 1000 Elemente: Variante und Ort aller Elemente höchstens 16 ms im Maximum über 20 Durchläufe", async () => {
  const api = (await import(/* @vite-ignore */ LABELS_MODULE)) as LabelsApi;
  const D = await loadDrawing();
  expect(thousand).toHaveLength(1000);
  const ok = closure(CATALOG, thousand, ORIGIN);
  expect(ok.ok && ok.closure.status).toBe("geschlossen");
  const shapes = D.drawing(CATALOG, thousand);
  expect(shapes).toHaveLength(1000);

  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const scale = 0.15 * 1.25 ** run; // 0,15 … ≈ 10,4
    const on = run % 2 === 0;
    const t0 = performance.now();
    const plan = api.labelPlan(CATALOG, thousand, shapes, scale, on);
    const t1 = performance.now();
    times.push(t1 - t0);
    // Ergebnis prüfen, damit die Arbeit wirklich stattfand
    expect(plan).toHaveLength(900);
    expect(plan.every((e) => Number.isFinite(e.at.x) && Number.isFinite(e.at.y))).toBe(true);
    expect(plan.filter((e) => e.symbol === "stecker")).toHaveLength(100);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] as number;
  const median = ((sorted[RUNS / 2 - 1] as number) + (sorted[RUNS / 2] as number)) / 2;
  console.log(
    `[REQ-PARCH-3] ${RUNS} Durchläufe, 1000 Elemente: Maximum ${max.toFixed(2)} ms, Median ${median.toFixed(2)} ms`,
  );
  expect(times).toHaveLength(RUNS);
  expect(max).toBeLessThanOrEqual(LIMIT_MS);
});
