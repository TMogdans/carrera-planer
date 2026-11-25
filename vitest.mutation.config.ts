import { defineConfig } from "vitest/config";

/**
 * Vitest-Konfiguration ausschließlich für Stryker (`pnpm test:mutation`).
 *
 * Mutiert wird der reine Kern (src/core, src/catalog, src/schema), die DOM-freie
 * Editor-Logik (src/web/editor, ab M2) und der Server (src/server, ab M3b). Die Oberfläche
 * gehört nicht dazu: Sie braucht DOM. Ausgenommen sind außerdem die Server-Tests, die einen
 * Kindprozess bzw. Vite starten (process, dev-proxy): Sie laufen gegen gebauten Code und
 * töten keine Mutanten, kosten aber je Mutant einen Build.
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
    exclude: [
      "**/node_modules/**",
      "**/.stryker-tmp/**",
      "src/server/process.test.ts",
      "src/server/dev-proxy.test.ts",
    ],
    passWithNoTests: true,
  },
});
