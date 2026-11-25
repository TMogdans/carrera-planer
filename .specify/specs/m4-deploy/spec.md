# Spec: M4 — Deploy als Container auf dem Raspberry Pi

Status: **Entwurf, zur Abnahme per Review des Spec-PR.** Die Abschnitte „Empfehlungen“ und „Zur
Abnahme — offen“ enthalten Entscheidungen, die der Mensch noch treffen muss; die Kriterien sind so
geschrieben, wie die Empfehlungen sie verlangen. Grundlage: [KONZEPT.md](../../../KONZEPT.md)
(Ziel: „läuft auf dem Raspi im Heimnetz und ist von unterwegs per VPN erreichbar“; Architektur:
„Docker auf dem Raspi, eigener Port“; Meilenstein M4), [constitution.md](../../constitution.md),
die umgesetzte Spec [M3b Teil A](../m3b-backend/spec.md) (Abschnitte „Annahmen zum Zielbetrieb“,
„Bekannte Grenzen“, „Nach dem Deploy“) und die Befunde aus Kritik Runde 2 und Smoke an PR #49.
Basisstand: `origin/main` = `05039f7`.

**Vorbild** ist die Rezepte-App (Nachbar-Repo, gleicher Raspi): mehrstufiges Dockerfile,
Image-Build in GitHub Actions nach ghcr.io für `linux/arm64`, Tags `latest` und Commit-SHA,
Compose-Datei mit Bind-Mount, `restart: unless-stopped`, Deploy per `docker compose pull` und
`up -d`. Abweichungen sind unter „Empfehlungen“ einzeln begründet.

**Tier: T2** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` gegen
`.devloop/tier-map.json` aus den geplanten Pfaden des implement-Laufs:
`.specify/specs/m4-deploy/spec.md`, `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`,
`deploy/backup.sh`, `deploy/measure.mjs`, `deploy/*.test.ts`, `docs/raspi-deploy.md`,
`README.md`, `src/server/server.ts` (+ Tests) → `{"tier":"T2"}`. T2 kommt allein aus
`src/server/**` (REQ-DATA-1, Empfehlung 6). Gegenprobe ohne `src/server` → T1. Der Admin-PR
(`.github/workflows/ci.yml`, `.devloop/*`, `vitest.container.config.ts`, `tsconfig.json`) ist ein
eigener PR → T1, geschützt über CODEOWNERS. Das autoritative Tier rechnet CI aus dem Diff.
**Hinweis Smoke:** `smoke.tiers` in `.devloop/config.json` nennt `T1` und `T3`, nicht `T2`. Fällt
REQ-DATA-1 weg (T1), läuft der Smoke automatisch; bleibt es bei T2, muss der Smoke ausdrücklich
angestoßen werden. Für einen Deploy-Meilenstein ist der Smoke der eigentliche Nachweis.

## User Story

Als Bahnbauer, der mit seiner Familie auf Laptop, Tablet und Handy Strecken plant, möchte ich den
Planer als Container auf unserem Raspi im Heimnetz laufen haben, einmal eingerichtet, nach einem
Stromausfall von selbst wieder da, mit gesicherter Datenbank und einem Weg zurück auf die vorige
Version, damit wir ihn ohne Entwicklungsrechner im Haus und per VPN benutzen können.

## Begriffe und Konventionen

- **Zielgerät:** Raspberry Pi 3B, Userland `arm64`, 906 MB RAM, davon etwa 615 MB verfügbar neben
  der Rezepte-App (gemessen 2026-11-25). Port 80 belegt die Rezepte-App, 8080 ist frei. Kein Node
  auf dem Host, Docker mit Compose-Plugin läuft.
- **Image:** das Ergebnis von `docker build` aus dem `Dockerfile` im Repo-Wurzelverzeichnis.
- **Container-Test:** Test unter `deploy/*.test.ts`, der ein fertiges Image als Container startet
  und von außen prüft (HTTP über den veröffentlichten Port, `docker inspect`, `docker exec … node
  -e …`). Das Image kommt aus den Umgebungsvariablen `CARRERA_IMAGE` und `CARRERA_TAG`.
- **Datenverzeichnis:** das Host-Verzeichnis `data/` neben der Compose-Datei, im Container
  `/data`; darin `carrera-planer.sqlite` samt `-wal` und `-shm`.
- **Erlaubter Host:** wie in M3b (REQ-SRV-7). Ohne Port gilt Port P = `CARRERA_PORT` = 8080.
- **Messprofil „typisch“:** 40 Layouts zu je 200 Elementen. **Messprofil „groß“:** 40 Layouts,
  jedes knapp unter der Körpergrenze von 1 MiB (REQ-API-13 aus M3b).
- Keine echten Adressen oder Benutzernamen in dieser Datei: `<LAN-IP>` steht für die feste
  IPv4-Adresse des Raspi im Heimnetz.

## Aufteilung: implement gegen Admin-PR

| Liefert | Inhalt | Geschützt? |
|---|---|---|
| **implement** | `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`, `deploy/backup.sh`, `deploy/measure.mjs`, `docs/raspi-deploy.md`, `README.md` (Abschnitt Betrieb), Startprüfung „beschreibbar“ in `src/server/server.ts` | nein (Server: T2, CODEOWNERS) |
| **spec-to-tests** | `src/server/*.test.ts` für REQ-DATA-1; `deploy/*.test.ts` für alle Container-Kriterien | managed (Server heute, `deploy/` nach Admin-PR Teil 1) |
| **Admin-PR Teil 1** (vor implement) | siehe unten | ja |
| **Admin-PR Teil 2** (Workflow) | siehe unten | ja |
| **Mensch am Gerät** | Erst-Deploy, Messung am Zielgerät, Neustart des Raspi, VPN-Probe, Sichtbarkeit des Pakets auf ghcr.io | – |

**Admin-PR Teil 1 (vor implement; spec-to-tests kann vorher laufen):**

- `.devloop/managed-tests.json`: `globs` bekommt `deploy/**/*.test.ts`. Sonst darf implement die
  Container-Tests schreiben, die seine eigene Arbeit prüfen.
- `vitest.container.config.ts` (neu, Wurzel, damit `tsconfig.json` sie über `*.config.ts`
  typprüft): `include: ["deploy/**/*.test.ts"]`, **ohne** `passWithNoTests`, `testTimeout`
  großzügig (Container-Start), `fileParallelism: false` (feste Ports, ein Docker-Daemon).
  Die Standard-`vitest.config.ts` bleibt bei `src/**`, damit `pnpm test` kein Docker braucht.
- `.devloop/protected-globs.json` und `.github/CODEOWNERS`: `vitest.container.config.ts`.
- `.github/workflows/ci.yml`, Job `escape-hatches`: Semgrep läuft über `src deploy`.
- Optional `tsconfig.json`: `include` bekommt `deploy`, damit `pnpm typecheck` die Container-Tests
  prüft (sonst nur von Vitest/esbuild übersetzt, ohne Typprüfung; dann bekannte Grenze).

**Admin-PR Teil 2 (Workflow; Empfehlung 4 zur Reihenfolge):** neuer Job `image` in
`.github/workflows/ci.yml`:

- `runs-on: ubuntu-24.04-arm` (nativer arm64-Runner, für öffentliche Repos frei), kein QEMU.
- Läuft auf jedem PR und jedem Push nach `main` (kein Pfadfilter, damit der Check nie hängt und
  keine Filterlogik den Build still auslässt), `needs: [typecheck, lint, test]`.
- `docker/setup-buildx-action`, `docker/build-push-action` mit `platforms: linux/arm64`,
  Cache `type=gha`; Aktionen auf Commit-SHAs gepinnt wie im übrigen `ci.yml`.
- Nach dem Build: `pnpm install --frozen-lockfile`, dann
  `CARRERA_IMAGE=… CARRERA_TAG=… pnpm exec vitest run --config vitest.container.config.ts`
  gegen das eben gebaute Image (geladen mit `load: true`).
- Nur bei Push nach `main` und nur wenn die Container-Tests grün sind: Login bei ghcr.io mit
  `GITHUB_TOKEN`, Push als `ghcr.io/tmogdans/carrera-planer:latest` und `:<voller Commit-SHA>`,
  Labels `org.opencontainers.image.source` (verknüpft das Paket mit dem Repo) und
  `org.opencontainers.image.revision`. `permissions: packages: write` nur für diesen Job.
- Danach einmalig von Hand: Paket auf ghcr.io auf **öffentlich** stellen (Empfehlung 5).

## Akzeptanzkriterien

Alle Container-Kriterien werden am **laufenden Container** nachgewiesen. Ein Test, der das
`Dockerfile` oder die Compose-Datei als Text liest und nach Mustern sucht, ist kein gültiger
Nachweis. Erlaubt ist das Lesen der von Docker **aufgelösten** Konfiguration (`docker compose
config`, `docker inspect`) nur dort, wo das Kriterium es ausdrücklich nennt, und jeweils mit einer
Wirkungsprobe daneben.

### Image (`Dockerfile`, `.dockerignore`)

- **REQ-IMG-1** [Where] Das Image wird mehrstufig gebaut: Eine Build-Stufe installiert alle
  Abhängigkeiten mit `pnpm install --frozen-lockfile` und führt `pnpm build` und
  `pnpm build:server` aus; die Laufzeit-Stufe enthält nur Laufzeit-Abhängigkeiten
  (`--prod`). Wirkungsnachweis im Container: Unter `/app` liegen genau `dist/`, `dist-server/`,
  `node_modules/` und `package.json`; `require.resolve` von `typescript`, `vite` und `vitest`
  scheitert; unter `/app` gibt es keine Datei `*.sqlite*` und kein `.git`.
- **REQ-IMG-2** [Contract] Das Image ist `linux/arm64` (`docker image inspect`, Feld
  `Architecture`), und ein Container daraus beantwortet `GET /api/status` mit 200
  `{"status":"ok"}`. Damit ist nachgewiesen, dass die `better-sqlite3`-Binärdatei für arm64 lädt.
  Im CI läuft das auf einem arm64-Runner, lokal auf einem Apple-Silicon-Rechner, jeweils nativ.
- **REQ-IMG-3** [Contract] Im Container läuft der Server als **PID 1** und **nicht als root**:
  `/proc/1/cmdline` nennt `node` und `dist-server/server/main.js` (kein `pnpm`, keine Shell
  dazwischen, die Signale schlucken könnte), und `process.getuid()` des Prozesses 1 ist 1000
  (gelesen über `/proc/1/status`, Zeile `Uid`).
- **REQ-IMG-4** [When] Startet ein Container aus dem Image mit leerem, für UID 1000
  beschreibbarem Verzeichnis unter `/data` und ohne weitere Variablen außer
  `CARRERA_ALLOWED_HOSTS`, gilt: Die Datei `/data/carrera-planer.sqlite` entsteht (auf dem Host
  sichtbar), die Startzeile nennt diesen Pfad, `GET /` über den veröffentlichten Port 8080 liefert
  die `index.html` mit `<title>Carrera-Planer</title>`, und eine darin verlinkte JS-Datei kommt
  mit `Content-Type` JavaScript. Vorgaben im Image: `CARRERA_DB=/data/carrera-planer.sqlite`,
  `CARRERA_STATIC=/app/dist`, `CARRERA_PORT=8080`, `CARRERA_HOST` unverändert `0.0.0.0`.
- **REQ-IMG-5** [When] **Healthcheck.** Das Image bringt einen `HEALTHCHECK` mit, der
  `http://127.0.0.1:<CARRERA_PORT>/api/status` mit dem Node des Images abfragt (nicht `localhost`:
  der Server lauscht bei `0.0.0.0` nur auf IPv4, und `localhost` kann zu `::1` auflösen; der Host
  `127.0.0.1:<P>` steht in der Vorgabe-Erlaubtliste). Werte: `start-period` 30 s,
  `start-interval` 2 s, `interval` 60 s, `timeout` 10 s, `retries` 3. Nachweis: Ein normal
  gestarteter Container ist binnen 30 s `healthy`. **Gegenprobe:** Ein Container aus demselben
  Image, dessen Startbefehl durch einen Node-Prozess ohne Server ersetzt ist
  (`--entrypoint node … -e "setInterval(()=>{},1e9)"`), wird `unhealthy`; der Test darf dafür
  `--health-interval` und `--health-retries` verkürzen, aber nicht den Prüfbefehl ersetzen.
  Ebenso ein Container mit `CARRERA_ALLOWED_HOSTS=rezepte.local`: Er wird `healthy` (die
  Erlaubtliste aus M3b schließt `127.0.0.1:<P>` immer ein).
- **REQ-IMG-6** [When] **Beenden.** `docker stop` (SIGTERM, Frist 10 s) beendet den Container
  mit Exit-Code 0 (`State.ExitCode`) binnen 5 s, gemessen vom Aufruf bis zur Rückkehr. Ein Layout
  und ein Bestand, die vor dem Stopp mit 201/200 bestätigt wurden, liefert ein **neuer** Container
  auf demselben Datenverzeichnis mit derselben Version, demselben `updatedAt` und demselben Inhalt.
  Ebenso nach `docker restart`.
- **REQ-IMG-7** [If/Then] **Host-Prüfung durch den veröffentlichten Port** (Befund M3b:
  der Host-Header trägt den äußeren Port). Container mit `-p 8080:8080` und
  `CARRERA_ALLOWED_HOSTS=rezepte.local`: Anfragen an den Host-Port mit `Host: rezepte.local:8080`
  → 200; mit `Host: evil.example:8080` → 421 `FremderHost`, Körper ohne Layoutnamen (vorher ein
  Layout „Oval“ angelegt); mit `Host: rezepte.local` (ohne Port) → 421. Derselbe Container ohne
  `CARRERA_ALLOWED_HOSTS`: `Host: rezepte.local:8080` → 421, `Host: localhost:8080` → 200.

### Compose-Datei (`deploy/docker-compose.yml`)

- **REQ-CMP-1** [If/Then] Ist `CARRERA_ALLOWED_HOSTS` nicht gesetzt oder leer, verweigert
  `docker compose up -d` den Start mit einer Meldung, die die Variable nennt, und es entsteht kein
  Container (`docker compose ps -a` leer). Grund: ohne die Variable bekäme jedes Gerät im Heimnetz
  421 (Befund M3b).
- **REQ-CMP-2** [When] Mit `CARRERA_ALLOWED_HOSTS` gesetzt startet `docker compose up -d` einen
  Container, der auf dem Host-Port **8080** antwortet (Abbildung `8080:8080`, Empfehlung 3), seine
  Datenbank im Datenverzeichnis `./data` neben der Compose-Datei ablegt (auf dem Host sichtbar,
  nach `docker compose down` und erneutem `up -d` mit unveränderten Daten) und den Image-Namen aus
  `${CARRERA_IMAGE:-ghcr.io/tmogdans/carrera-planer}:${CARRERA_TAG:-latest}` nimmt.
  Nachweis Rückweg: Mit `CARRERA_TAG` auf ein zweites, lokal getaggtes Image läuft der Container
  danach mit dessen Image-ID (`docker inspect`, Feld `Image`); die Daten bleiben.
- **REQ-CMP-3** [Where] Die Compose-Datei setzt `restart: unless-stopped`, ein Speicherlimit
  (vorläufig **384 MiB**, endgültiger Wert nach der Messung am Zielgerät, „Zur Abnahme“ Punkt 3)
  und eine Begrenzung der Container-Logs (`json-file`, `max-size` 1 MB, `max-file` 3), damit die
  SD-Karte nicht volläuft. Nachweis: im laufenden Container zeigt `/sys/fs/cgroup/memory.max`
  das Limit in Byte (Wirkung der cgroup, nicht nur der Datei); `docker inspect` zeigt
  `RestartPolicy.Name` `unless-stopped` und `LogConfig` mit beiden Grenzen.
- **REQ-CMP-4** [When] Der Container aus der Compose-Datei wird `healthy` (REQ-IMG-5 über
  Compose, kein eigener Prüfbefehl in der Compose-Datei, der den aus dem Image überschreibt).

### Daten und Sicherung (`src/server`, `deploy/backup.sh`)

- **REQ-DATA-1** [If/Then] **Startprüfung „beschreibbar“** (`src/server`, Empfehlung 6; Befund
  M3b: bei schreibgeschützter Datei startet der Server, und jeder Schreibzugriff endet mit 500).
  Kann der Server-Prozess die Datenbankdatei oder ihr Verzeichnis nicht beschreiben, startet er
  **nicht**: Exit-Code ≠ 0, eine Zeile auf der Fehlerausgabe mit Pfad und „nicht beschreibbar“,
  und eine vorhandene Datei ist danach Byte für Byte unverändert. Fälle: vorhandene, vom Server
  angelegte Datei mit Rechten 0444; Verzeichnis 0555 ohne Datei; Verzeichnis 0555 mit
  beschreibbarer Datei. Gegenprobe: dieselbe Datei mit 0644 in einem Verzeichnis 0755 startet und
  `PUT` liefert 201. API, Schema und Migrationen ändern sich nicht. Läuft der Test als root
  (Rechte greifen dann nicht), scheitert er mit diesem Hinweis, statt still zu bestehen.
- **REQ-DATA-2** [If/Then] Gehört das Datenverzeichnis root und ist für UID 1000 nicht
  beschreibbar (der Fall, dass Docker ein fehlendes Bind-Mount-Verzeichnis selbst anlegt), endet
  der Container mit Exit-Code ≠ 0, und `docker logs` nennt `/data/carrera-planer.sqlite` und
  „nicht beschreibbar“. Kein Container läuft weiter, der Lesen erlaubt und Schreiben mit 500
  ablehnt.
- **REQ-DATA-3** [When] **Sicherung.** `deploy/backup.sh`, im Verzeichnis der Compose-Datei
  aufgerufen, stoppt den Dienst (`docker compose stop`, SIGTERM, die WAL wird beim Schließen
  zurückgeschrieben), kopiert das Datenverzeichnis mit allen `carrera-planer.sqlite*` nach
  `backup/<Zeitstempel UTC>/`, startet den Dienst wieder und endet mit 0; scheitert ein Schritt,
  endet es ≠ 0 und versucht trotzdem, den Dienst wieder zu starten. Nachweis: nach Anlegen von
  Layouts und Bestand das Skript laufen lassen; danach ist der Dienst wieder `healthy`, und ein
  frischer Container auf einer **Kopie** der Sicherung liefert dieselben Layouts, Versionen,
  `updatedAt` und denselben Bestand. Gegenprobe: eine Änderung nach der Sicherung fehlt in der
  Kopie.

### Messwerkzeug (`deploy/measure.mjs`)

- **REQ-MESS-1** [Performance] `node deploy/measure.mjs <Basis-URL> <typisch|groß>` (Node 22,
  ohne neue Abhängigkeit, läuft auf dem Entwicklungsrechner gegen den Raspi) legt die Layouts des
  Profils unter dem Präfix `messung-` an, misst je 20 Durchläufe von `GET /api/layouts`,
  `GET /api/layouts/{name}` und `PUT /api/layouts/{name}` und gibt als JSON je Vorgang Maximum,
  Median und Anzahl in Millisekunden aus, dazu Profil, Zeitpunkt und Anzahl Layouts. Danach löscht
  es genau seine eigenen Layouts (mit Version). Gibt es vor dem Start schon Layouts mit dem
  Präfix, bricht es mit Exit-Code ≠ 0 ab, ohne etwas zu schreiben. Nachweis gegen einen Container
  mit vorher angelegtem fremdem Layout „Oval“: Ausgabe hat die Felder, alle Werte > 0, die
  Layoutliste ist danach genau die vorige (Oval mit unveränderter Version und `updatedAt`).

### Architektur

- **REQ-DARCH-1** [Architektur] M4 ändert in `src/server` nur die Startprüfung (REQ-DATA-1) und
  keine Datei unter `src/schema`, `src/core`, `src/catalog`, `src/web` und
  `src/server/migrations`. Wirkungsnachweis: alle Tests bis M3b laufen unverändert grün,
  `pnpm typecheck`, `pnpm lint`, `pnpm test` und `pnpm test:mutation` sind grün (die Startprüfung
  steht im Server-Ratchet, Überlebende werden mit Tests getötet).

**Zählung:** IMG 7, CMP 4, DATA 3, MESS 1, DARCH 1, zusammen 16 Kriterien.

## Prüfarchitektur

- **Container-Tests** (`deploy/*.test.ts`, managed nach Admin-PR Teil 1) laufen nur über
  `pnpm exec vitest run --config vitest.container.config.ts`, nicht in `pnpm test`. Sie bauen kein
  Image, sondern nehmen `CARRERA_IMAGE`/`CARRERA_TAG`. **Fehlt die Variable oder das Image oder
  läuft kein Docker, scheitern sie mit Meldung; sie überspringen nie** (kein bedingtes Skip).
  Jeder Test räumt seine Container, Netze und temporären Verzeichnisse ab und benutzt eigene
  Container-Namen mit Zufallsanteil. Für REQ-CMP-2 erzeugt der Test das zweite Image durch
  `docker tag` desselben Images unter anderem Namen plus eine triviale Ableitung (z. B.
  `FROM <image>` mit einem Label), damit sich die Image-IDs unterscheiden.
- Lokal: `docker build -t carrera-planer:test .`, dann
  `CARRERA_IMAGE=carrera-planer CARRERA_TAG=test pnpm exec vitest run --config
  vitest.container.config.ts`. Auf einem Apple-Silicon-Rechner nativ arm64.
- **Server-Tests** für REQ-DATA-1 liegen in `src/server` (managed, Vitest, laufen in `pnpm test`
  und unter Stryker).
- **Kanarienvögel für den Critic** (je eine Verfälschung, ein Test muss rot werden): Laufzeit-Stufe
  kopiert alle `node_modules` aus der Build-Stufe (Dev-Abhängigkeiten im Image); `CMD` über
  `pnpm start` oder `sh -c`; `USER` entfernt; Healthcheck gegen `localhost` statt `127.0.0.1`;
  Healthcheck immer `exit 0`; Compose ohne `:?` an `CARRERA_ALLOWED_HOSTS`; Portabbildung
  `80:8080`; `restart` entfernt; Speicherlimit entfernt; `backup.sh` ohne Stopp (kopiert bei
  laufendem Server nur die Hauptdatei); Startprüfung entfernt; Startprüfung nur auf die Datei,
  nicht auf das Verzeichnis.

## Empfehlungen (mit Gegenrede)

1. **Basis-Image `node:22-bookworm-slim` für Build- und Laufzeit-Stufe** (Rezepte-App:
   `node:22-alpine` zum Bauen, `distroless/nodejs22-debian12:nonroot` zur Laufzeit).
   - Dafür: Genau dort hat Kritiker A gemessen (Prebuild lädt, 69 MiB Leerlauf, höchstens 269 MB,
     `docker stop` 2,3 s). glibc passt zur Prebuild-Datei `linux-arm64.node`. Node 22 passt zu
     `.nvmrc`. Eine Shell erleichtert die Fehlersuche auf dem Raspi.
   - Gegen alpine: `linuxmusl-arm64.node` existiert, ist aber ungemessen; musl-Node hat einen
     anderen Allokator, die Speicherzahlen wären neu zu messen. Die Rezepte-App nutzt alpine nur
     zum Bauen, wo native Module keine Rolle spielen; hier landen sie im Image.
   - Gegenrede distroless (wie Rezepte-App): kleinere Angriffsfläche, kein Paketmanager im Image,
     läuft schon so auf dem Gerät. Healthcheck und Sicherung brauchen keine Shell im Container
     (beide laufen über Node bzw. auf dem Host), technisch ginge es also. Preis: keine Shell zur
     Fehlersuche und Zahlen nicht auf genau diesem Image gemessen. Ein Wechsel später ist nur das
     `FROM` der Laufzeit-Stufe plus erneuter Messung. → „Zur Abnahme“ Punkt 1.
   - Pinnen: Tag `node:22-bookworm-slim` mit Digest (`@sha256:…`), damit ein Rebuild nicht still
     eine andere Node-Version bringt; Aktualisieren ist eine bewusste Änderung.
2. **Nativ auf arm64 bauen, nicht per QEMU** (Rezepte-App: amd64-Runner mit QEMU und
   `--platform=$BUILDPLATFORM` in der Build-Stufe).
   - Grund: Mit `$BUILDPLATFORM` würde pnpm auf amd64 installieren. `better-sqlite3` bringt zwar
     alle Prebuilds mit, aber plattformgebundene optionale Pakete (z. B. die von
     `msgpackr-extract`) kämen für x64. Ein nativer arm64-Runner (frei für öffentliche Repos)
     baut und testet ohne Emulation, und die Container-Tests laufen auf der Zielarchitektur.
     Lokal auf Apple Silicon ebenso.
   - Gegenrede: arm-Runner sind jünger, Warteschlangen möglich. Rückfallebene ist der Weg der
     Rezepte-App (QEMU), dann aber mit der Laufzeit-Installation in einer Stufe ohne
     `$BUILDPLATFORM`.
   - Kein multi-arch: amd64 hätte keinen Abnehmer, kostet Bauzeit und würde in CI einen Pfad
     grün testen, der nicht ausgeliefert wird.
3. **Port `8080:8080`, fester Port, kein eigener mDNS-Name, kein Reverse-Proxy.**
   - Grund: Der Host-Header trägt den äußeren Port; bei Umbiegen müsste
     `CARRERA_ALLOWED_HOSTS` den äußeren Port tragen, ein stiller Fehler mit 421. Ein eigener Name
     (`carrera.local`) bräuchte einen Avahi-Alias auf dem Host und spart den Port trotzdem nicht,
     solange Port 80 der Rezepte-App gehört; ein Proxy auf Port 80 griffe in deren Betrieb ein.
   - Gegenrede: `http://rezepte.local:8080` ist ein unschöner Name für einen Streckenplaner.
     Ein Proxy (z. B. Caddy) vor beiden Apps wäre eine eigene, spätere Änderung.
4. **Reihenfolge der Admin-PRs.** Teil 1 vor implement. Teil 2 (Workflow-Job) als Admin-PR **auf
   dem implement-Branch** aufsetzen, sodass sein CI-Lauf Image-Build und Container-Tests auf dem
   gemeinsamen Stand zeigt; implement-PR zuerst mergen, Teil 2 direkt danach.
   - Grund: Käme der Job vor dem `Dockerfile` nach `main`, wäre `main` rot, bis implement landet.
     Ein Job, der bei fehlendem `Dockerfile` mit 0 endet, wäre ein bedingtes Überspringen.
   - Gegenrede: Der implement-PR selbst hat dann keinen CI-Lauf der Container-Tests, nur den
     lokalen Lauf von Critic und Smoke plus den Lauf auf PR Teil 2. Alternative: der Mensch
     schiebt den Workflow-Commit auf den implement-Branch (ein PR, aber geschützte und
     ungeschützte Änderungen gemischt im selben Review).
5. **Paket auf ghcr.io öffentlich** (Rezepte-App: privat, Token `read:packages` auf dem Raspi).
   - Grund: Das Repo ist öffentlich, das Image enthält nichts, was nicht im Repo steht (geprüft
     durch REQ-IMG-1: keine Datenbank, kein `.git`). Auf dem Raspi liegt dann kein Token.
   - Gegenrede: Ein öffentliches Image ist ein weiterer öffentlicher Artefakt-Kanal; versehentlich
     eingebackene Daten wären sofort öffentlich. Dagegen steht REQ-IMG-1 als Wirkungsprüfung im CI
     vor jedem Push.
6. **Startprüfung „beschreibbar“ im Server (REQ-DATA-1), nicht nur Doku.**
   - Grund: Der falsche Besitzer entsteht leicht (Docker legt ein fehlendes Bind-Mount-Verzeichnis
     als root an; eine Rücksicherung per `sudo cp` macht Dateien root-eigen). Heute fällt das erst
     beim ersten Speichern auf; in M4 noch später, weil die Oberfläche bis Teil B gar nicht auf den
     Server schreibt. Ein lauter Startabbruch zeigt den Fehler in `docker ps`/`docker logs`.
   - Gegenrede: Hebt das Tier von T1 auf T2 (Critic-Tiefe, Server-Ratchet, managed Tests) und
     ändert `src/server` in einem Deploy-Meilenstein. Ohne die Änderung bliebe der Nachweis bei
     Doku plus Schreibprobe im Smoke; die spätere Rücksicherung bliebe ungeschützt.
     Auch ein Entrypoint, der als root `chown` ausführt und dann die Rechte abgibt, wäre möglich,
     bringt aber einen root-Start und `gosu`/`su-exec` ins Image. → „Zur Abnahme“ Punkt 2.
7. **Sicherung: Stopp, Kopie, Start, als Skript in M4; Automatik als Folge-Issue.**
   - Grund: Bei laufender WAL ist eine Dateikopie der Hauptdatei nicht konsistent. Nach sauberem
     Stopp (gemessen ~2 s) schreibt SQLite die WAL zurück, die Kopie ist konsistent; wenige
     Sekunden Ausfall sind für einen Haushaltsdienst egal. Das Skript macht die Sicherung
     prüfbar (REQ-DATA-3); eine reine Doku-Anleitung hätte keinen Detektor. Gehört in M4, weil der
     Rückweg nach einem Update mit neuer Migration nur über die Sicherung geht (REQ-DB-3 aus M3b
     verweigert den Start eines älteren Images auf einer neueren Datei, zu Recht).
   - Gegenrede: Online-Sicherung (`sqlite3 .backup` auf dem Host oder `VACUUM INTO` über den
     Server) käme ohne Ausfall aus und ließe sich häufiger fahren. Kosten: Paket `sqlite3` auf dem
     Host bzw. Server-Code. Zweiter Einwand: Eine Sicherung auf derselben SD-Karte schützt nicht
     vor dem Tod der Karte. Beides gehört ins Folge-Issue (Zeitplan per Cron, Kopie weg vom
     Raspi), **vor** dem Einsatz von Teil B, denn erst ab Teil B liegen echte Daten auf dem Server.
8. **Deploy wie bei der Rezepte-App: `docker compose pull` und `up -d`, von Hand.** Davor
   `deploy/backup.sh`. Rückweg: `CARRERA_TAG=<voriger SHA>` in `.env` und `up -d`; hat die neue
   Version migriert, vorher die Sicherung zurückspielen. Kein Watchtower, kein automatischer
   Deploy: Ein Update mit Migration braucht die Sicherung davor und einen Menschen, der
   hinsieht. Gegenrede: Bequemlichkeit; bei seltenen Updates kein echter Preis.
9. **Kein TLS im Heimnetz.**
   - Grund: kein Login, keine Geheimnisse (Constitution); außerhalb des Hauses verschlüsselt der
     VPN-Tunnel. Die Oberfläche nutzt heute keine Browser-Funktion, die einen sicheren Kontext
     verlangt (gesucht in `src/web`: kein `crypto.randomUUID`, `crypto.subtle`,
     `navigator.clipboard`, Service Worker).
   - Gegenrede: Jedes Gerät im WLAN kann den Verkehr mitlesen und verändern (wie es ohne Login
     ohnehin schreiben darf). **Folge für Teil B:** Unter `http://<LAN-IP>:8080` ist die Seite
     kein sicherer Kontext. Will Teil B einen Service Worker (Offline-Cache) oder
     `crypto.randomUUID`, braucht es dann TLS oder einen anderen Weg. Das gehört in die Spec von
     Teil B.
10. **Speicherlimit vorläufig 384 MiB**, endgültig aus der Messung: höchstens das Doppelte des
    gemessenen Maximums (VmHWM) im Profil „typisch“, aufgerundet auf 32 MiB, und so, dass neben
    der Rezepte-App mindestens 150 MB für System und Seiten-Cache frei bleiben. Gegenrede: Ein zu
    knappes Limit tötet den Prozess im Profil „groß“; `restart: unless-stopped` startet ihn neu,
    eine einzelne Anfrage scheitert. Das ist im Haushalt erträglich, solange das Profil „typisch“
    sicher passt.

## Messung am Zielgerät (Ziel von M4, Abnahme mit dem Menschen)

Nicht automatisierbar (echtes Gerät), deshalb kein `REQ-`-Kriterium; das Werkzeug dafür ist
REQ-MESS-1. Die Entscheidungsregeln stehen **vor** der Messung fest:

- Aufbau: Produktiv-Container und Rezepte-App laufen (realer Nachbar im Speicher). Gemessen wird
  gegen einen **zweiten, temporären** Container aus demselben Image mit eigenem leerem
  Datenverzeichnis auf Port 8081 (danach entfernt), damit keine Messdaten in die echte Datenbank
  kommen. Client ist der Entwicklungsrechner im LAN (realer Pfad).
- Speicher: `VmHWM` und `VmRSS` aus `/proc/<PID>/status` des Server-Prozesses auf dem Host
  (`docker inspect -f '{{.State.Pid}}'`), vor und nach jedem Profil; dazu
  `/sys/fs/cgroup/memory.peak` im Container. Gemeldet wird das **Maximum**, nicht ein Mittel.
- Zeiten: Ausgabe von REQ-MESS-1, je Vorgang **Maximum** und Median.
- **Schwellen Profil „typisch“** (vorgeschlagen, „Zur Abnahme“ Punkt 4): `GET /api/layouts`
  Maximum ≤ 1000 ms, `GET /api/layouts/{name}` und `PUT` je Maximum ≤ 500 ms, VmHWM ≤ 50 % des
  Speicherlimits. Wird eine Schwelle gerissen, wird die Liste (Übersicht ohne Volldekodierung,
  Befund Kritik Runde 2) **vor Teil B** umgebaut; dafür ein Issue, das Teil B blockiert.
- **Profil „groß“** wird gemessen und dokumentiert, blockiert aber nichts (konstruierter Grenzfall:
  1 MiB je Layout sind über 10 000 Elemente, weit jenseits jedes realen Bestands). Stirbt der
  Prozess dabei am Speicherlimit, kommt das als bekannte Grenze in den PR.
- Zusätzlich: Leerlauf-RSS nach dem Start, Startdauer bis `healthy`, Dauer eines Healthchecks
  (Node-Start auf dem Pi 3B; wird er teuer, ist `interval` zu vergrößern).

## Uhr ohne Echtzeituhr (geklärt, kein Kriterium)

Der Raspi stellt nach dem Booten die zuletzt gespeicherte Zeit ein (systemd-timesyncd bzw.
fake-hwclock auf Raspberry Pi OS) und springt vorwärts, sobald NTP greift. Bis dahin geht die Uhr
**nach**. Wirkung auf den Planer, nachgesehen:

- `updatedAt` setzt der Server aus `new Date()` (`src/server/server.ts:118`). Beim Ändern
  nimmt er `max(updated_at, now)` (`src/server/server.ts:124`): Die Zeit eines Layouts läuft nie
  rückwärts. Ein in der Nachlaufphase **neu** angelegtes Layout kann eine zu frühe Zeit tragen.
- Versionsprüfung und Konflikterkennung hängen nicht an der Zeit (Versionsnummern, M3b).
  Sortiert wird die Liste nach Namen, nicht nach Zeit.
- Folge: rein kosmetisch (Teil B zeigt „Stand vom …“). Kein Eingriff in den Host (etwa
  `docker.service` nach `time-sync.target`): Ohne Netz würde der Dienst dann gar nicht starten.
  Als bekannte Grenze geführt.

## Erreichbarkeit

- Im Heimnetz: `http://rezepte.local:8080` (mDNS) und `http://<LAN-IP>:8080`; die LAN-IP ist im
  Router fest vergeben (wie bei der Rezepte-App). Beide Namen stehen in `CARRERA_ALLOWED_HOSTS`
  in der Datei `.env` neben der Compose-Datei auf dem Raspi (nicht im Repo: sie enthält die
  LAN-IP).
- Per VPN: mDNS (`.local`) geht in der Regel nicht durch einen VPN-Tunnel (Multicast). Von
  unterwegs funktioniert nur ein Name, den der DNS im Tunnel auflöst, oder die LAN-IP, sofern der
  Tunnel das Heimnetz routet. Welcher VPN es ist und was er routet, ist offen („Zur Abnahme“
  Punkt 5).
- **Falle bis Teil B: getrennte Daten je Adresse.** Die Oberfläche speichert bis Teil B im
  `localStorage` des Browsers (`src/web/ui/browser.ts:15`), und der ist je **Herkunft** getrennt:
  `rezepte.local:8080` und `<LAN-IP>:8080` sehen auf demselben Gerät verschiedene gespeicherte
  Layouts und verschiedene Bestände. Empfehlung: eine kanonische Adresse für alle Geräte, die auch
  per VPN funktioniert (vermutlich die LAN-IP), die andere nur als Notweg. Teil B löst das, weil
  die Daten dann auf dem Server liegen. M4 macht den Planer im Heimnetz **erreichbar**,
  geräteübergreifend wird er erst mit Teil B.
- IPv6: Der Server lauscht bei `0.0.0.0` nur auf IPv4 (Smoke M3b). Docker nimmt veröffentlichte
  Ports auf dem Host auch über IPv6 an und reicht sie an den Container weiter; löst `rezepte.local`
  auf einem Gerät zuerst zu IPv6 auf, muss das trotzdem gehen (Smoke „Nach dem Deploy“).

## Nicht-Ziele (M4)

- Teil B (Anbindung des Browsers an den Server).
- Login, Benutzer, Rechte (Konzept, Constitution).
- TLS (Empfehlung 9).
- Reverse-Proxy, eigener Hostname, Port 80.
- Automatische Sicherung nach Zeitplan und Kopie weg vom Raspi (Folge-Issue, vor Teil B).
- Automatischer Deploy (Watchtower o. Ä.).
- Änderungen an API, Schema, Migrationen, Oberfläche.
- Einrichtung des Raspi selbst (Betriebssystem, Docker, feste IP): steht in der Doku der
  Rezepte-App und ist erledigt.

## Bekannte Grenzen

- Healthcheck-Zustand führt nicht zum Neustart: `restart: unless-stopped` greift nur, wenn der
  Prozess endet. `unhealthy` ist sichtbar (`docker ps`), heilt aber nicht von selbst.
- Ein Speicherlimit greift nur, wenn der Kernel des Raspi die Speicher-cgroup aktiviert hat. Auf
  Raspberry-Pi-Kerneln war sie früher per Vorgabe aus; dann ignoriert Docker das Limit mit einer
  Warnung. Geprüft wird es am Gerät (REQ-CMP-3 dort ausgeführt, „Nach dem Deploy“).
- Uhr nach dem Booten (Abschnitt oben).
- Getrennte `localStorage`-Daten je Adresse bis Teil B (Abschnitt „Erreichbarkeit“).
- Sicherung auf derselben SD-Karte (Empfehlung 7).
- Container-Tests ohne Typprüfung, falls `tsconfig.json` nicht um `deploy` erweitert wird.

## Zur Abnahme — offen

1. **Basis-Image:** `node:22-bookworm-slim` für die Laufzeit (Empfehlung) oder distroless wie die
   Rezepte-App?
2. **REQ-DATA-1 (Server-Startprüfung, Tier T2)** aufnehmen oder streichen (dann T1, nur Doku und
   Smoke-Schreibprobe)? Empfehlung: aufnehmen.
3. **Speicherlimit:** vorläufig 384 MiB, endgültig nach der Regel in Empfehlung 10. Einverstanden?
4. **Schwellen am Zielgerät** (Profil „typisch“, 40 × 200 Elemente): Liste ≤ 1000 ms, Einzel-GET
   und PUT ≤ 500 ms im Maximum, VmHWM ≤ 50 % des Limits. Passt das Profil zu euren realen
   Strecken, passen die Schwellen?
5. **VPN:** Welcher VPN ist „das Heim-VPN“, routet er das Heimnetz, und welcher Name wird darin
   aufgelöst? Davon hängt ab, welche Adresse kanonisch wird und was in
   `CARRERA_ALLOWED_HOSTS` steht.
6. **Reihenfolge Admin-PR Teil 2** wie Empfehlung 4 (auf dem implement-Branch, danach mergen) oder
   der Workflow-Commit direkt auf den implement-Branch?
7. **ghcr-Paket öffentlich** (Empfehlung 5) oder privat mit Token auf dem Raspi wie bei der
   Rezepte-App?
8. **Smoke trotz T2:** `smoke.tiers` enthält T2 nicht. Den Smoke für M4 ausdrücklich anstoßen
   (Empfehlung) oder `smoke.tiers` per Admin-PR um T2 ergänzen?

## Smoke

**Aufrufer des geänderten Pfads.** Nachgesehen am Basisstand `05039f7`:

- **Browser** auf Laptop, Tablet, Handy: lädt `/` über den statischen Teil des Servers
  (`files` in `src/server/server.ts:389`, aufgerufen aus `handle` in `src/server/server.ts:421`,
  davor die Host-Prüfung `src/server/server.ts:425`). Die Erlaubtliste baut `resolveConfig` in
  `src/server/config.ts:58-69`. Die Oberfläche spricht in M4 weiter **nicht** mit der API, sie
  speichert im `localStorage` (`src/web/ui/browser.ts:15`).
- **Docker-Healthcheck:** `GET /api/status` (`src/server/server.ts:375`).
- **Docker beim Stoppen:** SIGTERM an PID 1, behandelt über `NodeRuntime.runMain`
  (`src/server/main.ts:11`), Abbau in `serve` (`src/server/server.ts:459`, Lauschen ab `:483`).
- **Datenbank beim Start:** `openDatabase` (`src/server/server.ts:80`); hier setzt die
  Startprüfung aus REQ-DATA-1 an.
- **Messwerkzeug und `curl`** über die API. Kein MCP, kein anderer Dienst ruft den Planer.

**Lokal (vor dem Merge, Entwicklungsrechner mit Docker, arm64):**

```
docker build -t carrera-planer:test .
mkdir -p /tmp/carrera-m4 && cd /tmp/carrera-m4
cp <repo>/deploy/docker-compose.yml <repo>/deploy/backup.sh .
mkdir data
printf 'CARRERA_IMAGE=carrera-planer\nCARRERA_TAG=test\nCARRERA_ALLOWED_HOSTS=rezepte.local,<LAN-IP des Rechners>\n' > .env
docker compose up -d
```

1. **Start.** `docker compose ps` → `healthy` binnen 30 s. `curl -s
   http://localhost:8080/api/status` → `{"status":"ok"}`. `ls data` → `carrera-planer.sqlite`.
2. **Planer.** Browser `http://localhost:8080/` → der Planer erscheint; vom Handy
   `http://<LAN-IP des Rechners>:8080/` ebenso.
3. **Schreiben und Neustart.** `PUT /api/layouts/Oval` (Version 0) → 201; `docker compose down`,
   `docker compose up -d` → `GET /api/layouts/Oval` gleiche Version und `updatedAt`.
4. **Sicherung.** `./backup.sh` → Exit 0, danach wieder `healthy`, unter `backup/` ein Ordner mit
   der Datei; eine Änderung danach; die Sicherung in einen zweiten Ordner kopieren und dort einen
   Container auf Port 8081 starten → Stand vor der Änderung.
5. **Rückweg.** `docker tag carrera-planer:test carrera-planer:alt`, `CARRERA_TAG=alt` in `.env`,
   `docker compose up -d` → läuft, Daten gleich.
6. **Stoppen.** `time docker compose stop` → unter 5 s; `docker inspect` → Exit-Code 0.

Gegenfälle, die geschlossen bleiben müssen:

7. `CARRERA_ALLOWED_HOSTS` aus `.env` entfernen → `docker compose up -d` verweigert mit Meldung.
8. `curl -i -H 'Host: evil.example:8080' http://localhost:8080/api/layouts` → 421, kein „Oval“
   im Körper.
9. `sudo chown root data && sudo chmod 755 data` (bzw. `data` löschen und Docker anlegen lassen),
   `docker compose up -d` → Container endet, `docker compose logs` nennt den Pfad und „nicht
   beschreibbar“; `docker ps` zeigt keinen laufenden Planer, der Schreiben mit 500 ablehnt.
10. `docker run --rm carrera-planer:test node -e "require.resolve('typescript')"` → scheitert.
11. `docker exec <container> node -e "console.log(require('fs').readdirSync('/app'))"` → genau
    `dist`, `dist-server`, `node_modules`, `package.json`.

### Nach dem Deploy

Nur auf dem echten Raspi nachweisbar. Der Deploy ist eine Handlung des Menschen am Gerät (per SSH
über den Alias des Raspi), kein Agent führt ihn unbeaufsichtigt aus. Die Schritte stehen in
`docs/raspi-deploy.md`.

1. **Image da.** Nach dem Merge zeigt ghcr.io `carrera-planer:latest` und `:<SHA>`;
   `docker pull` auf dem Raspi klappt ohne Anmeldung (falls öffentlich).
2. **Erst-Deploy.** Verzeichnis anlegen, `data/` als Raspi-Benutzer anlegen (UID 1000),
   Compose-Datei, `backup.sh` und `.env` (mit `CARRERA_ALLOWED_HOSTS=rezepte.local,<LAN-IP>`)
   hinlegen, `docker compose pull && docker compose up -d` → `healthy`. Die Rezepte-App auf Port
   80 läuft unverändert weiter.
3. **Speicherlimit greift.** `docker exec <container> cat /sys/fs/cgroup/memory.max` → das Limit
   in Byte, nicht `max`. Sonst: Speicher-cgroup im Kernel aus; der Mensch entscheidet, ob sie
   eingeschaltet wird (Kernel-Kommandozeile), oder das Limit bleibt wirkungslos und kommt als
   bekannte Grenze in den PR.
4. **Geräte.** Laptop, Tablet und Handy öffnen die kanonische Adresse → der Planer erscheint;
   `rezepte.local:8080` auf mindestens einem Handy (mDNS-Unterstützung unterscheidet sich je
   Gerät). Ein anderer Name auf dieselbe IP → 421.
5. **VPN.** Von außerhalb (Handy im Mobilfunk mit VPN) die kanonische Adresse → der Planer
   erscheint.
6. **Messung am Zielgerät** nach dem gleichnamigen Abschnitt, beide Profile; Ergebnis mit
   Maximum in den PR bzw. in ein Issue, Entscheidung „Liste umbauen vor Teil B: ja/nein“ nach der
   vorab festgelegten Regel.
7. **Stromausfall.** Raspi neu starten (`sudo reboot`) → nach dem Hochfahren ist der Planer ohne
   Eingriff wieder `healthy`, die Daten sind da, die Rezepte-App ebenso.
8. **Sicherung und Rückweg am Gerät.** `./backup.sh` einmal am Raspi; beim ersten echten Update
   den Rückweg einmal üben (`CARRERA_TAG=<voriger SHA>`).
