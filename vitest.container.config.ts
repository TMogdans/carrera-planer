import { defineConfig } from "vitest/config";

/**
 * Vitest-Konfiguration für die Container-Tests (M4, `deploy/**`).
 *
 * Sie laufen gegen ein gebautes Image (`CARRERA_IMAGE`, `CARRERA_TAG`) und brauchen Docker.
 * Deshalb sind sie nicht Teil von `pnpm test` (vitest.config.ts bleibt bei `src/**`).
 * Kein `passWithNoTests`: Ein Lauf ohne Tests ist ein Fehler, kein Grün.
 * Nacheinander, weil die Tests Container, Ports und Volumes auf demselben Docker-Host nutzen.
 */
export default defineConfig({
  test: {
    include: ["deploy/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
