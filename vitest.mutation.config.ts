import { defineConfig } from "vitest/config";

/**
 * Vitest-Konfiguration ausschließlich für Stryker (`pnpm test:mutation`).
 *
 * Mutiert wird der reine Kern (src/core, src/catalog, src/schema) und die DOM-freie
 * Editor-Logik (src/web/editor, ab M2). Server (SQLite) und Oberfläche gehören nicht dazu:
 * Sie sind langsam bzw. brauchen DOM, und ihre Tests haben keine Tötungskraft auf die
 * Rechenlogik.
 */
export default defineConfig({
  test: {
    include: [
      "src/core/**/*.test.ts",
      "src/catalog/**/*.test.ts",
      "src/schema/**/*.test.ts",
      "src/web/editor/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
    passWithNoTests: true,
  },
});
