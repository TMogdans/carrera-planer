/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Architektur der Editor-Logik, Abnahmetest
 * REQ-WARCH-1 (Muster wie REQ-ARCH-1 in src/core/architecture.test.ts).
 *
 * Die Editor-Module (editor.ts, status.ts, drawing.ts, session.ts) werden geladen, während
 * - `preact` mit allen Unterpfaden aus dessen package.json-exports durch Stubs ersetzt ist, die
 *   beim Laden werfen, und
 * - die DOM-Globalen `window`, `document`, `localStorage` als Getter auf globalThis liegen, die
 *   bei jedem Zugriff werfen (auch `typeof window` löst den Getter aus).
 * Danach muss die Logik korrekt rechnen: Oval geschlossen, Sitzung sichert in die eingereichte
 * Speicher-Attrappe, Export liefert Dateiname und Text.
 *
 * Kanarienvogel: derselbe Test zeigt zuerst, dass Stubs und Getter wirken. Ohne diesen Nachweis
 * wäre ein grüner Test kein Beleg.
 *
 * Schnittstelle: siehe src/web/test-support/editor-fixtures.ts.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CATALOG,
  type DrawingApi,
  type EditorApi,
  fixedClock,
  layoutJson,
  MemoryStorage,
  MODULE_PATHS,
  OVAL,
  type SessionApi,
  type StatusApi,
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
        throw new Error(`REQ-WARCH-1: Editor-Logik greift auf ${name} zu`);
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
  (await import(
    /* @vite-ignore */ new URL(path, new URL("../test-support/", import.meta.url)).href
  )) as T;

describe("Architektur", () => {
  test.skip("[REQ-WARCH-1] Editor-Logik lädt und rechnet ohne Preact und ohne DOM-Globale", async () => {
    vi.resetModules();
    for (const m of PREACT_MODULES) {
      vi.doMock(m, () => {
        throw new Error(`REQ-WARCH-1: ${m} darf von der Editor-Logik nicht geladen werden`);
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

    const [editorPath, statusPath, drawingPath, sessionPath] = MODULE_PATHS as [
      string,
      string,
      string,
      string,
    ];
    const E = await importFresh<EditorApi>(editorPath);
    const S = await importFresh<StatusApi>(statusPath);
    const D = await importFresh<DrawingApi>(drawingPath);
    const api = await importFresh<SessionApi>(sessionPath);

    const s = E.apply(CATALOG, E.initialState(), { type: "load", elements: OVAL });
    expect(S.statusOf(CATALOG, s.elements)).toEqual({ kind: "geschlossen" });
    expect(D.drawnSection(CATALOG, s.elements).drawnCount).toBe(6);

    const storage = new MemoryStorage();
    const session = api.createSession({
      catalog: CATALOG,
      storage,
      clock: fixedClock("2026-11-24T07:15:00.000Z"),
    });
    session.dispatch({ type: "load", elements: OVAL });
    expect(JSON.parse(storage.data.get(api.WORKING_KEY) as string)).toStrictEqual(layoutJson(OVAL));
    expect(session.exportFile().fileName).toBe("strecke-2026-11-24-0815.json");
    expect(session.messages).toEqual([]);
  });
});
