/**
 * Spec plan-beschriftung-symbole (.specify/specs/plan-beschriftung-symbole/spec.md): Architektur,
 * Abnahmetest REQ-PARCH-1 (Muster wie REQ-WARCH-1 in architecture.test.ts).
 *
 * `src/web/editor/labels.ts` (Text, Platzregel, Ort, Symbolzuordnung) und
 * `src/web/editor/planner-session.ts` (Schalterzustand) werden geladen, während `preact` samt
 * Unterpfaden durch werfende Stubs ersetzt ist und `window`, `document`, `localStorage` bei jedem
 * Zugriff werfen. Danach muss die Logik korrekt rechnen.
 *
 * Kanarienvogel: derselbe Test zeigt zuerst, dass Stubs und Getter wirken.
 *
 * Nicht hier: der Mutations-Ratchet ohne überlebenden Mutanten in src/web/editor (CI-Job
 * `mutation`) und „stryker.config.json unverändert“ (Eigenschaft des PR-Diffs, geschützter Satz).
 *
 * Schnittstelle: siehe labels.test.ts und labels-session.test.ts.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PlannerSessionApi } from "../test-support/bestand-fixtures.js";
import { TEMPLATES } from "../test-support/bestand-fixtures.js";
import {
  CATALOG,
  type CatalogEntry,
  type DrawingApi,
  type ElementShape,
  fixedClock,
  type LayoutElement,
  MemoryStorage,
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
  labelTexts(
    catalog: Catalog,
    partId: string,
  ): { readonly full: string; readonly short: string | undefined } | undefined;
  symbolOf(partId: string): string | undefined;
  labelPlan(
    catalog: Catalog,
    elements: Elements,
    shapes: ReadonlyArray<ElementShape>,
    scale: number,
    on: boolean,
  ): ReadonlyArray<LabelEntry>;
};
type LabelSession = { readonly labels: boolean; setLabels(on: boolean): void };

const preactPackage = JSON.parse(
  readFileSync(new URL("../../../node_modules/preact/package.json", import.meta.url), "utf8"),
) as { readonly exports: Record<string, unknown> };
const PREACT_MODULES = Object.keys(preactPackage.exports)
  .filter((k) => !k.endsWith("package.json"))
  .map((k) => (k === "." ? "preact" : `preact/${k.slice(2)}`));

const DOM_GLOBALS = ["window", "document", "localStorage"] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

const installDomTraps = (): void => {
  for (const name of DOM_GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`REQ-PARCH-1: Beschriftungslogik greift auf ${name} zu`);
      },
    });
  }
};

afterEach(() => {
  for (const name of DOM_GLOBALS) {
    const d = saved.get(name);
    if (d === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, d);
  }
  saved.clear();
  for (const m of PREACT_MODULES) vi.doUnmock(m);
  vi.resetModules();
});

const importFresh = async <T>(path: string): Promise<T> =>
  (await import(/* @vite-ignore */ new URL(path, import.meta.url).href)) as T;

const LABELS_KEY = "carrera-planer:beschriftung";

describe("Architektur", () => {
  test("[REQ-PARCH-1] Beschriftungslogik und Schalter laden und rechnen ohne Preact und ohne DOM-Globale", async () => {
    vi.resetModules();
    for (const m of PREACT_MODULES) {
      vi.doMock(m, () => {
        throw new Error(`REQ-PARCH-1: ${m} darf von der Beschriftungslogik nicht geladen werden`);
      });
    }
    installDomTraps();
    // Kanarienvogel: Stubs und Getter greifen
    expect(PREACT_MODULES).toEqual(
      expect.arrayContaining(["preact", "preact/hooks", "preact/jsx-runtime"]),
    );
    await expect(import("preact")).rejects.toThrow();
    await expect(import("preact/hooks")).rejects.toThrow();
    expect(() => (globalThis as { localStorage?: unknown }).localStorage).toThrow();
    expect(() => (globalThis as { document?: unknown }).document).toThrow();
    expect(() => (globalThis as { window?: unknown }).window).toThrow();

    const L = await importFresh<LabelsApi>("./labels.js");
    const D = await importFresh<DrawingApi>("./drawing.js");
    const P = await importFresh<PlannerSessionApi>("./planner-session.js");

    expect(L.labelTexts(CATALOG, "gerade-114")).toEqual({ full: "Gerade 114", short: "114" });
    expect(L.symbolOf("rundenzaehler")).toBe("zielflagge");
    const elements: Elements = [
      { id: "a", part: "gerade-342" },
      { id: "b", part: "rundenzaehler" },
      { id: "c", part: "gerade-100" },
    ];
    const plan = L.labelPlan(CATALOG, elements, D.drawing(CATALOG, elements), 0.4, true);
    expect(plan.map((e) => [e.id, e.variant, e.text, e.symbol])).toEqual([
      ["a", "voll", "Gerade 342", undefined],
      ["b", "nurSymbol", undefined, "zielflagge"],
      ["c", "kurz", "100", undefined],
    ]);
    expect(plan[0]?.at.x).toBeCloseTo(171, 9);
    expect(plan[0]?.at.y).toBeCloseTo(0, 9);

    const storage = new MemoryStorage();
    const session = P.createPlannerSession({
      catalog: CATALOG,
      templates: TEMPLATES,
      storage,
      clock: fixedClock("2026-11-25T07:15:00.000Z"),
    }) as unknown as LabelSession;
    expect(session.labels).toBe(true);
    session.setLabels(false);
    expect(session.labels).toBe(false);
    expect(storage.data.get(LABELS_KEY)).toBe("aus");
  });
});
