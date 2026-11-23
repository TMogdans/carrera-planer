/**
 * Spec M1 (.specify/specs/m1-rechenkern/spec.md): Architektur, Abnahmetest REQ-ARCH-1.
 *
 * Der Kern wird geladen, während `effect` (Haupteinstieg und alle Unterpfade aus dessen
 * package.json-exports) und die Node-I/O-Module fs, fs/promises, net, http, child_process (mit und
 * ohne `node:`-Präfix) durch Stubs ersetzt sind, die beim Laden werfen. Danach muss er ein
 * geschlossenes Oval korrekt als geschlossen melden. Der Katalog wird hier bewusst inline
 * übergeben (nur die zwei nötigen Einträge), damit nur der Kern selbst geprüft wird.
 *
 * Kanarienvogel: derselbe Test zeigt zuerst, dass die Stubs wirken (Import von `effect`,
 * `effect/Schema` und `node:fs` scheitert). Ohne diesen Nachweis wäre ein grüner Test kein Beleg.
 *
 * API wie in core.test.ts beschrieben (closure(catalog, elements, start)).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";

type Rational = { readonly num: bigint; readonly den: bigint };
type Coord = { readonly a: Rational; readonly b: Rational };
type Pose = { readonly x: Coord; readonly y: Coord; readonly dir: number };
type ClosureResult =
  | { readonly ok: true; readonly closure: { readonly status: string } }
  | { readonly ok: false; readonly errors: ReadonlyArray<unknown> };
type CoreApi = {
  closure(
    catalog: ReadonlyArray<unknown>,
    elements: ReadonlyArray<unknown>,
    start: Pose,
  ): ClosureResult;
};

const ZERO: Coord = { a: { num: 0n, den: 1n }, b: { num: 0n, den: 1n } };
const ORIGIN: Pose = { x: ZERO, y: ZERO, dir: 0 };

const INLINE_CATALOG = [
  {
    id: "gerade-342",
    name: "Gerade 342",
    articleNumbers: ["20061602"],
    source: "CT",
    certainty: "hoch",
    geometry: { kind: "gerade", length: 342 },
  },
  {
    id: "kurve-1-90",
    name: "Kurve 1/90°",
    articleNumbers: ["20061603"],
    source: "Messung",
    certainty: "hoch",
    geometry: { kind: "kurve", radius: 171, angle: 90 },
  },
];
const OVAL = [
  { id: "a", part: "kurve-1-90", turn: "links" },
  { id: "b", part: "kurve-1-90", turn: "links" },
  { id: "c", part: "gerade-342" },
  { id: "d", part: "kurve-1-90", turn: "links" },
  { id: "e", part: "kurve-1-90", turn: "links" },
  { id: "f", part: "gerade-342" },
];

const effectPackage = JSON.parse(
  readFileSync(new URL("../../node_modules/effect/package.json", import.meta.url), "utf8"),
) as { readonly exports: Record<string, unknown> };
const EFFECT_MODULES = Object.keys(effectPackage.exports)
  .filter((k) => k !== "./package.json")
  .map((k) => (k === "." ? "effect" : `effect/${k.slice(2)}`));
const IO_MODULES = ["fs", "fs/promises", "net", "http", "child_process"].flatMap((m) => [
  m,
  `node:${m}`,
]);
const STUBBED = [...EFFECT_MODULES, ...IO_MODULES];

afterEach(() => {
  for (const m of STUBBED) vi.doUnmock(m);
  vi.resetModules();
});

describe("Architektur", () => {
  test("[REQ-ARCH-1] Kern lädt und rechnet ohne Effect-Laufzeit und ohne Node-I/O", async () => {
    vi.resetModules();
    for (const m of STUBBED) {
      vi.doMock(m, () => {
        throw new Error(`REQ-ARCH-1: ${m} darf vom Kern nicht geladen werden`);
      });
    }
    // Kanarienvogel: die Stubs greifen
    expect(EFFECT_MODULES).toContain("effect/Schema");
    await expect(import("effect")).rejects.toThrow();
    await expect(import("effect/Schema")).rejects.toThrow();
    await expect(import("node:fs")).rejects.toThrow();

    const core = (await import("./index.js")) as unknown as CoreApi;
    const status = (elements: ReadonlyArray<unknown>): string | undefined => {
      const r = core.closure(INLINE_CATALOG, elements, ORIGIN);
      return r.ok ? r.closure.status : undefined;
    };
    expect(status(OVAL)).toBe("geschlossen");
    expect(status(OVAL.slice(0, 5))).toBe("offen");
    expect(status([])).toBe("leer");
  });
});
