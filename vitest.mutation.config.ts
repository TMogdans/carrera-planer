import { defineConfig } from "vitest/config";

/**
 * Vitest-Konfiguration ausschließlich für Stryker (`pnpm test:mutation`).
 *
 * Mutiert wird der reine Kern (src/core, src/catalog, src/schema), die DOM-freie
 * Editor-Logik (src/web/editor, ab M2) und der Server (src/server, ab M3b). Die Oberfläche
 * gehört nicht dazu: Sie braucht DOM.
 */
export default defineConfig({
  test: {
    include: [
      "src/core/**/*.test.ts",
      "src/catalog/**/*.test.ts",
      "src/schema/**/*.test.ts",
      "src/web/editor/**/*.test.ts",
      "src/server/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
    passWithNoTests: true,
  },
});
