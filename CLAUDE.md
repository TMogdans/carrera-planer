# CLAUDE.md — Arbeitsanweisungen für Coding-Agenten in carrera-planer

Zweck: Streckenplaner für Carrera GO!!! im Browser (Bestandsmodus, Sandbox, Einkaufsliste).
[KONZEPT.md](./KONZEPT.md) ist die abgenommene Wurzel; Änderungen daran werden vor dem
Weiterbauen abgenommen. Recherche: [docs/recherche.md](./docs/recherche.md). Invarianten:
[.specify/constitution.md](./.specify/constitution.md).

## Struktur

Einzelnes pnpm-Paket, ESM, TypeScript strict. Node ist über `.nvmrc` (22) und `engines` gepinnt.

| Pfad | Inhalt | Tier |
|---|---|---|
| `src/core` | Geometriekern: reines TypeScript, exakte Ganzzahl-Arithmetik, kein I/O, keine Effect-Laufzeit | T2 |
| `src/catalog` | Teilekatalog als Daten, gegen das Schema geprüft | T2 |
| `src/schema` | Effect Schema: Datenvertrag für Katalog, Layout, Bestand, API | T3 |
| `src/server` | Backend: `@effect/platform` (HttpApi), `@effect/sql-sqlite-node` | T2 |
| `src/web` | Frontend: Vite + Preact, SVG; Effect nur als Schema | T1 |

Die `index.ts` je Verzeichnis sind leere Platzhalter (`export {}`), damit `tsc` Eingaben findet. Sie
werden durch echten Code ersetzt. Zielversion Effect: `effect@3.x` (siehe Constitution).

## Skripte

| Skript | Wirkung |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `biome check .` |
| `pnpm test` | `vitest run --passWithNoTests` |
| `pnpm test:mutation` | Stryker auf `src/core\|catalog\|schema`, `break=100`. Ohne mutierbaren Code gibt das Skript eine Meldung aus und endet mit 0. Mit Code aber ohne Tests scheitert es. |

Semgrep (Fluchttür-Wächter) lokal: `semgrep --config .semgrep --error --metrics=off src`.

## devloop

- **Tier-Map:** [.devloop/tier-map.json](./.devloop/tier-map.json), deterministisch aus den
  berührten Pfaden. `src/schema` und `**/migrations/**` sind T3 (Mensch-Gate), `core|catalog|server`
  T2, alles andere T1. Das Tier wird nie selbst gewählt.
- **Managed Tests:** `src/{core,catalog,schema,server}/**/*.test.ts` schreibt nur spec-to-tests
  (Branch `devloop/spec/<slug>`). Tests der Oberfläche (`src/web`) sind frei.
- **Geschützter Satz** ([.devloop/protected-globs.json](./.devloop/protected-globs.json),
  [.github/CODEOWNERS](./.github/CODEOWNERS)): `.github/**`, `.devloop/**`,
  `.specify/constitution.md`, `.semgrep/**`, `.semgrepignore`, `stryker.config.json`,
  `vitest.config.ts`, `vitest.mutation.config.ts`, `biome.json`, `tsconfig.json`, `package.json`,
  `pnpm-lock.yaml`. Änderungen brauchen den Admin-Override; kein Agent fasst sie an, auch nicht
  als „Fix". Ein Schwellenwert, der gesenkt statt erfüllt wird, ist Reward-Hacking.
- **Neue Abhängigkeit = Änderung am geschützten Satz** (`package.json`, Lockfile). Die gewünschten
  Pakete sind deshalb schon aufgenommen.
- **Bot-Identität:** `sir-tobys-usefull-helper-agent[bot]` produziert Branches und PRs, der Mensch
  reviewt und merged. Der Agent merged nicht selbst.
- **Workflows pusht nur der Mensch** (`.github/workflows/**` braucht eine Berechtigung, die dem Bot
  fehlt).
- Features laufen über `/devloop:loop`: specify, spec-to-tests, implement, critic.

## Regeln für den Kern

- Exakte Rechnung, **keine Toleranz** und kein Epsilon (Constitution).
- Eigenschaftstests mit fast-check; Mutationsproben sind Pflicht, nicht optional. Überlebende
  Mutanten werden mit Tests getötet. `Stryker disable`-Kommentare und `@ts-ignore` sind per Semgrep
  verboten.
- Rot melden statt grün machen: kein Skip, der einen roten Test versteckt.

## Offene Punkte

Siehe GitHub-Issues in TMogdans/carrera-planer (#1 Vermessen, #2 Ausbauset 1).
