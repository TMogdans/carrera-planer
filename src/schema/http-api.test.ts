/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Lage der `HttpApi`-Definition.
 * Abnahmetests REQ-API-4 (Entscheidung 7; Muster wie REQ-WARCH-1 in
 * src/web/editor/architecture.test.ts).
 *
 * Wirkungsnachweis: `@effect/platform` wird mit allen Unterpfaden aus dessen package.json-exports
 * durch Stubs ersetzt, die beim Laden werfen. Dann
 * - lädt `src/schema/index.ts` und dekodiert einen Layout-Stand (die Datenschemas aus REQ-API-1
 *   bis -3 hängen nicht an `@effect/platform`), und
 * - scheitert das Laden von `src/schema/http-api.ts` (die `HttpApi`-Definition hängt daran und
 *   liegt dort, nicht im Barrel).
 * Kanarienvogel: derselbe Test zeigt zuerst, dass die Stubs wirken.
 *
 * Öffentliche API (von spec-to-tests gewählt): `src/schema/http-api.ts` exportiert die Definition
 * als `CarreraApi` (ein `HttpApi`). Ohne Stub wird ihr Inhalt per `HttpApi.reflect` gegen die
 * Tabelle „API M3b“ geprüft (Methode und Pfad jedes Endpunkts; die Fehlerstatus 404/409 dort, wo
 * die Tabelle sie nennt). Das Verhalten an der Leitung prüfen die Server-Tests in src/server.
 */
import { readFileSync } from "node:fs";
import { Either, Schema } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";

const HTTP_API_MODULE = "./http-api.js";
const INDEX_MODULE = "./index.js";

const platformPackage = JSON.parse(
  readFileSync(
    new URL("../../node_modules/@effect/platform/package.json", import.meta.url),
    "utf8",
  ),
) as { readonly exports: Record<string, unknown> };
const PLATFORM_MODULES = Object.keys(platformPackage.exports)
  .filter((k) => !k.endsWith("package.json"))
  .map((k) => (k === "." ? "@effect/platform" : `@effect/platform/${k.slice(2)}`));

afterEach(() => {
  for (const m of PLATFORM_MODULES) vi.doUnmock(m);
  vi.resetModules();
});

const importFresh = async (path: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ new URL(path, import.meta.url).href)) as Record<string, unknown>;

const LAYOUT_STATE = {
  name: "Oval",
  version: 1,
  updatedAt: "2026-11-25T08:15:00.000Z",
  layout: {
    schemaVersion: 1,
    elements: [
      { id: "o1", part: "kurve-1-90", turn: "links" },
      { id: "o2", part: "gerade-342" },
    ],
  },
};

describe("Architektur des Datenvertrags", () => {
  test("[REQ-API-4] mit werfendem @effect/platform lädt src/schema/index.ts und dekodiert einen Layout-Stand; http-api.ts scheitert", async () => {
    vi.resetModules();
    for (const m of PLATFORM_MODULES) {
      vi.doMock(m, () => {
        throw new Error(`REQ-API-4: ${m} darf vom Barrel src/schema/index.ts nicht geladen werden`);
      });
    }
    // Kanarienvogel: die Stubs greifen
    expect(PLATFORM_MODULES).toEqual(
      expect.arrayContaining(["@effect/platform", "@effect/platform/HttpApi"]),
    );
    await expect(import("@effect/platform")).rejects.toThrow();
    await expect(import("@effect/platform/HttpApi")).rejects.toThrow();
    await expect(import("@effect/platform/HttpApiEndpoint")).rejects.toThrow();

    const index = await importFresh(INDEX_MODULE);
    const state = index.LayoutStateSchema as Schema.Schema<unknown, unknown> | undefined;
    expect(state).toBeDefined();
    const decoded = Schema.decodeUnknownEither(state as Schema.Schema<unknown, unknown>)(
      LAYOUT_STATE,
    );
    expect(Either.isRight(decoded)).toBe(true);
    expect(
      Schema.encodeSync(state as Schema.Schema<unknown, unknown>)(Either.getOrThrow(decoded)),
    ).toEqual(LAYOUT_STATE);
    // Die HttpApi-Definition ist nicht Teil des Barrels
    expect(Object.keys(index)).not.toContain("CarreraApi");

    await expect(importFresh(HTTP_API_MODULE)).rejects.toThrow();
  });

  test("[REQ-API-4] http-api.ts lädt ohne Stub und enthält genau die Endpunkte der Tabelle „API M3b“", async () => {
    const mod = await importFresh(HTTP_API_MODULE);
    const { HttpApi } = await import("@effect/platform");
    const api = mod.CarreraApi as Parameters<typeof HttpApi.reflect>[0] | undefined;
    expect(api).toBeDefined();
    expect(HttpApi.isHttpApi(api)).toBe(true);

    const endpoints: Array<{ method: string; path: string; errors: ReadonlyArray<number> }> = [];
    HttpApi.reflect(api as Parameters<typeof HttpApi.reflect>[0], {
      onGroup: () => {},
      onEndpoint: ({ endpoint, errors }) => {
        endpoints.push({
          method: endpoint.method,
          path: endpoint.path,
          errors: [...errors.keys()],
        });
      },
    });

    const key = (e: { method: string; path: string }): string => `${e.method} ${e.path}`;
    expect(endpoints.map(key).sort()).toEqual(
      [
        "GET /api/status",
        "GET /api/layouts",
        "GET /api/layouts/:name",
        "PUT /api/layouts/:name",
        "DELETE /api/layouts/:name",
        "GET /api/bestand",
        "PUT /api/bestand",
      ].sort(),
    );
    const errorsOf = (k: string): ReadonlyArray<number> =>
      endpoints.find((e) => key(e) === k)?.errors ?? [];
    expect(errorsOf("GET /api/layouts/:name")).toEqual(expect.arrayContaining([404]));
    expect(errorsOf("PUT /api/layouts/:name")).toEqual(expect.arrayContaining([409]));
    expect(errorsOf("DELETE /api/layouts/:name")).toEqual(expect.arrayContaining([404, 409]));
    expect(errorsOf("PUT /api/bestand")).toEqual(expect.arrayContaining([409]));
  });
});
