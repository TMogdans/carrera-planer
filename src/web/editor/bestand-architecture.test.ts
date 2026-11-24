/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Architektur der Bestandslogik. Abnahmetests
 * REQ-BARCH-1 und REQ-BARCH-2 (Muster wie REQ-WARCH-1 in architecture.test.ts).
 *
 * REQ-BARCH-1: Die Module inventory.ts und planner-session.ts werden geladen, während `preact`
 * (alle Unterpfade aus dessen package.json-exports) durch werfende Stubs ersetzt ist und die
 * DOM-Globalen `window`, `document`, `localStorage` als werfende Getter auf globalThis liegen.
 * Danach muss die Logik korrekt rechnen. Kanarienvogel: Stubs und Getter wirken nachweislich.
 *
 * REQ-BARCH-2: Verbrauch kommt ausschließlich aus `consumption` des Kerns. Nachweis über die
 * Wirkung: (a) verfälschter Katalog (Steilkehre aus 4 K + 3 Kurven) ändert Einkaufsliste und
 * Rest; (b) ein im Test ersetztes `consumption` (Modul src/core/consumption.ts, das auch
 * src/core/index.ts weiterreicht) bestimmt Einkaufsliste, Rest und Sperre, unabhängig von der
 * Folge. „M3a ändert keine Datei unter src/core und src/server“ prüft der Diff des PR, kein Test.
 *
 * REQ-BARCH-3 (Mutations-Ratchet) prüft der CI-Job `mutation`, kein Vitest-Test.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  BESTAND_MODULE_PATHS,
  INVENTORY_KEY,
  type InventoryApi,
  loadInventory,
  MACH8,
  type PlannerSessionApi,
  T_MACH8,
  TEMPLATES,
} from "../test-support/bestand-fixtures.js";
import {
  CATALOG,
  type CatalogEntry,
  fixedClock,
  type LayoutElement,
  MemoryStorage,
  OVAL,
} from "../test-support/editor-fixtures.js";

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
        throw new Error(`REQ-BARCH-1: Bestandslogik greift auf ${name} zu`);
      },
    });
  }
};

const CONSUMPTION_MODULE = "../../core/consumption.js";

afterEach(() => {
  for (const name of DOM_GLOBALS) {
    const d = saved.get(name);
    if (d === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, d);
  }
  saved.clear();
  for (const m of PREACT_MODULES) vi.doUnmock(m);
  vi.doUnmock(CONSUMPTION_MODULE);
  vi.resetModules();
});

const importFresh = async <T>(path: string): Promise<T> =>
  (await import(
    /* @vite-ignore */ new URL(path, new URL("../test-support/", import.meta.url)).href
  )) as T;

describe("Architektur der Bestandslogik", () => {
  test("[REQ-BARCH-1] Bestandslogik und Planer-Sitzung laden und rechnen ohne Preact und ohne DOM-Globale", async () => {
    vi.resetModules();
    for (const m of PREACT_MODULES) {
      vi.doMock(m, () => {
        throw new Error(`REQ-BARCH-1: ${m} darf von der Bestandslogik nicht geladen werden`);
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
    expect(() => (globalThis as { window?: unknown }).window).toThrow();

    const [inventoryPath, sessionPath] = BESTAND_MODULE_PATHS as [string, string];
    const I = await importFresh<InventoryApi>(inventoryPath);
    const api = await importFresh<PlannerSessionApi>(sessionPath);

    const list = I.shoppingList(CATALOG, {}, OVAL);
    expect(list.ok && list.total).toBe(6);
    const palette = I.stockPalette(CATALOG, MACH8, OVAL);
    expect(palette.find((e) => e.partId === "kurve-1-90")?.rest).toBe(2);

    const storage = new MemoryStorage();
    const s = api.createPlannerSession({
      catalog: CATALOG,
      templates: TEMPLATES,
      storage,
      clock: fixedClock("2026-11-24T07:15:00.000Z"),
    });
    s.addSet(T_MACH8.id, true);
    s.setMode("bestand");
    for (let i = 0; i < 5; i++) s.dispatch({ type: "choosePart", partId: "gerade-342" });
    expect(s.state.elements).toHaveLength(4);
    expect(storage.data.has(INVENTORY_KEY)).toBe(true);
    expect(s.messages.map((m) => m.kind)).toEqual(["befehlAbgewiesen"]);
  });
});

describe("Verbrauch nur aus dem Kern", () => {
  test("[REQ-BARCH-2] Verfälschter Katalog (Steilkehre aus 4 K + 3 Kurven): Einkaufsliste fehlt 3, Rest bei Mach 8 = 3 (echt 4)", async () => {
    const I = await loadInventory();
    const forged: ReadonlyArray<CatalogEntry> = CATALOG.map(
      (e): CatalogEntry =>
        e.id === "steilkehre"
          ? {
              ...e,
              geometry: {
                kind: "baugruppe",
                parts: [
                  { part: "steilkehre-teil", count: 4 },
                  { part: "kurve-1-90", count: 3 },
                ],
              },
            }
          : e,
    );
    const steilkehre: ReadonlyArray<LayoutElement> = [{ id: "s", part: "steilkehre" }];
    const list = I.shoppingList(forged, {}, steilkehre);
    expect(list.ok && list.rows.find((r) => r.partId === "kurve-1-90")?.missing).toBe(3);
    const real = I.shoppingList(CATALOG, {}, steilkehre);
    expect(real.ok && real.rows.find((r) => r.partId === "kurve-1-90")?.missing).toBe(2);
    const rest = (catalog: ReadonlyArray<CatalogEntry>) =>
      I.stockPalette(catalog, MACH8, steilkehre).find((e) => e.partId === "kurve-1-90")?.rest;
    expect(rest(forged)).toBe(3);
    expect(rest(CATALOG)).toBe(4);
  });

  test("[REQ-BARCH-2] Ersetztes consumption des Kerns bestimmt Einkaufsliste, Rest und Sperre", async () => {
    vi.resetModules();
    let answer: unknown = { ok: true, counts: { "gerade-114": 7 } };
    vi.doMock(CONSUMPTION_MODULE, () => ({ consumption: () => answer }));
    // Kanarienvogel: auch über src/core/index.ts kommt das Ersatz-consumption
    const core = (await import("../../core/index.js")) as {
      readonly consumption: (...a: unknown[]) => unknown;
    };
    expect(core.consumption(CATALOG, [])).toEqual(answer);

    const I = await importFresh<InventoryApi>(BESTAND_MODULE_PATHS[0] as string);
    const list = I.shoppingList(CATALOG, {}, OVAL);
    expect(list.ok && list.rows.map((r) => [r.partId, r.needed, r.missing])).toEqual([
      ["gerade-114", 7, 7],
    ]);
    const palette = I.stockPalette(CATALOG, { "gerade-114": 10, "kurve-1-90": 1 }, OVAL);
    expect(palette.find((e) => e.partId === "gerade-114")?.rest).toBe(3);
    expect(palette.find((e) => e.partId === "kurve-1-90")).toMatchObject({
      rest: 1,
      locked: false,
    });

    answer = { ok: false, errors: [{ kind: "unbekanntesTeil", index: 0, partId: "x" }] };
    expect(I.shoppingList(CATALOG, MACH8, OVAL)).toEqual({
      ok: false,
      text: "Einkaufsliste nicht bestimmbar",
    });
    const locked = I.stockPalette(CATALOG, MACH8, OVAL).filter((e) => e.kind === "platzierbar");
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((e) => e.locked && e.rest === undefined)).toBe(true);
  });
});
