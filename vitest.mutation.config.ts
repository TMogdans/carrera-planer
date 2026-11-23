import { defineConfig } from "vitest/config";

/**
 * Vitest-Konfiguration ausschließlich für Stryker (`pnpm test:mutation`).
 *
 * Mutiert wird nur der reine Kern (src/core, src/catalog, src/schema). Server (SQLite) und
 * Oberfläche gehören nicht dazu: Sie sind langsam bzw. brauchen DOM, und ihre Tests haben
 * keine Tötungskraft auf die Rechenlogik.
 */
export default defineConfig({
  test: {
    include: ["src/core/**/*.test.ts", "src/catalog/**/*.test.ts", "src/schema/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
    passWithNoTests: true,
  },
});
