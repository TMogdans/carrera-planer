import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

/**
 * Frontend M2 (Spec M2, REQ-UI-11): `pnpm dev` (Dev-Server), `pnpm dev --host` (Heimnetz),
 * `pnpm build` (statische Dateien nach dist/). Wurzel ist src/web mit index.html.
 *
 * Dev-Proxy (Spec M3b, REQ-SRV-6): `/api` geht an den Server auf `CARRERA_PORT` (Vorgabe 8080).
 * `changeOrigin` setzt `Host: localhost:<P>`, damit die Host-Prüfung des Servers greift, ohne die
 * Erlaubtliste aufzuweichen.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./src/web", import.meta.url)),
  plugins: [preact()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.CARRERA_PORT ?? "8080"}`,
        changeOrigin: true,
      },
    },
  },
});
