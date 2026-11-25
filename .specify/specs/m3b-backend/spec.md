# Spec: M3b — Backend (Teil A: Server, API, Datenbank)

Status: **Überarbeitung 1, zur Abnahme per Review des Spec-PR.** Der Entwurf `0b59a44` legte
Empfehlungen zu den Entscheidungsfragen vor; laut Rückmeldung an die Kette vom 2026-11-25 hat der
Mensch sie mit drei Abweichungen angenommen (keine Übernahme-Funktion, Host-Prüfung gegen
DNS-Rebinding, `src/server` im Mutations-Ratchet) und den Schnitt auf Teil A festgelegt. Diese
Fassung trägt das ein; sie selbst ist noch nicht abgenommen. Die Kriterien verweisen mit
„(Entscheidung n)“ auf den Abschnitt „Entscheidungen“.
Grundlage: [KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23; Abschnitte „Ziel“,
„Architektur“ mit „Gleichzeitiges Bearbeiten“, „Meilensteine“),
[constitution.md](../../constitution.md), die umgesetzten Specs [M2](../m2-editor/spec.md),
[M3a](../m3a-bestand/spec.md) und [plan-beschriftung-symbole](../plan-beschriftung-symbole/spec.md).
Basisstand: `origin/main` = `9ffe100`.

**Schnitt (Entscheidung 1).** KONZEPT-M3b wird geteilt: **diese Spec (Teil A)** bringt den Server
mit API, SQLite und Betrieb; prüfbar allein über HTTP, die Oberfläche ändert ihr Verhalten nicht.
Die Anbindung des Browsers (Teil B) ist eine eigene, spätere Spec; ihre Kernentscheidungen stehen
unter „Folgespec Teil B (nicht Gegenstand)“. Den Deploy auf den Raspi bringt M4.

**Tier: T3** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` gegen
`.devloop/tier-map.json` aus den geplanten Pfaden `.specify/specs/m3b-backend/spec.md`,
`src/schema/api.ts`, `src/schema/http-api.ts`, `src/schema/index.ts` (+ Tests),
`src/server/**` einschließlich `src/server/migrations/**` (+ Tests), `vite.config.ts`,
`.gitignore`, `tsconfig.server.json` → `{"tier":"T3"}`. T3 kommt aus **zwei** Quellen:
`src/schema/**` (die Constitution verlangt das API-Schema dort) und `**/migrations/**`
(Tabellenanlage der Datenbank). Gegenprobe ohne `src/schema` und ohne Migrationsordner →
T2. Das Schema ließe sich als eigener PR abtrennen, der Server bliebe aber T3, solange die Tabellen
über einen Migrationsordner entstehen; den Ordner umzubenennen, damit das Tier sinkt, wäre
Umgehung des Gates. Das autoritative Tier rechnet CI aus dem Diff. Smoke: `smoke.tiers` in
`.devloop/config.json` enthält T3; `smoke.setup` ist `null`, der Smoke startet den Server nach
Abschnitt „Smoke“ selbst.

**Vorbedingung für implement (Admin-PR des Menschen am geschützten Satz; kein Agent dieser Kette
fasst die Dateien an, Entscheidung 10):**

- `stryker.config.json`: `mutate` bekommt `src/server/**/*.ts` (Tests und `index.ts` bleiben wie
  bisher ausgenommen).
- `vitest.mutation.config.ts`: `include` bekommt `src/server/**/*.test.ts`. **Ohne diese Zeile
  läuft unter Stryker kein Server-Test, und jeder Server-Mutant überlebt** (gelesen: `include` nennt
  heute nur `src/core`, `src/catalog`, `src/schema`, `src/web/editor`; der Kommentar dort schließt
  den Server bisher ausdrücklich aus).
- `package.json`, Skripte: `"build:server": "tsc -p tsconfig.server.json"` und
  `"start": "node dist-server/server/main.js"` (Entscheidung 6; getrennt, damit in M4 ein
  Container nur `start` braucht und nicht auf dem Raspi übersetzt).

spec-to-tests kann vor dem Admin-PR laufen; implement erst danach.

**Gemessen (2026-11-25, Worktree auf `9ffe100`, `pnpm install --frozen-lockfile --offline`):**

- Installiert: `effect` 3.22.5, `@effect/platform` 0.97.2, `@effect/platform-node` 0.108.4,
  `@effect/sql` 0.52.1, `@effect/sql-sqlite-node` 0.54.1, darunter `better-sqlite3` 13.2.0 und
  (transitiv) `@effect/experimental` 0.61.3. Neue Abhängigkeiten braucht Teil A nicht.
- `better-sqlite3` 13.2.0 bringt fertige N-API-Binärdateien mit (`prebuilds/`: darwin-arm64/x64,
  linux-arm64/x64, linuxmusl-arm64/x64, win32-arm64/x64), **keine für linux-arm (32 Bit)**. Es gibt
  kein Build-Skript, das `allowBuilds` in `pnpm-workspace.yaml` freigeben müsste. Probe mit
  `SqliteClient.layer` (in-memory und Datei): Tabelle anlegen, einfügen,
  `UPDATE … WHERE id = ? AND v = ? RETURNING v` liefert beim ersten Mal `[{"v":2}]`, mit der
  veralteten Version `[]`, SQLite 3.54.1 — der Baustein der Versionsprüfung. Gemessen nur mit
  Node **26.13.1** (auf dieser Maschine ist kein Node 22 installiert).
- Peer-Abweichung: `@effect/sql-sqlite-node` 0.54.1 verlangt `@effect/platform ^0.97.3` und
  `@effect/sql ^0.52.2`, installiert sind 0.97.2 und 0.52.1. Die Probe lief trotzdem.
- **Node kann die Quellen nicht direkt ausführen:** `node -e 'import("./src/schema/index.ts")'`
  scheitert mit `ERR_MODULE_NOT_FOUND` (die Importe nennen `./schema.js`). Eine eigene tsconfig,
  die `tsconfig.json` erweitert und nur `noEmit: false` und `outDir` setzt, übersetzt `src/schema`
  und `src/catalog` fehlerfrei, und `node` lädt das Ergebnis. `tsconfig.json` bleibt unberührt.
- In `@effect/platform` 0.97.2 gibt es `HttpApi`, `HttpApiBuilder`, `HttpApiEndpoint`,
  `HttpApiGroup`, `HttpApiSchema`, `HttpApiError`; in `@effect/sql-sqlite-node` `SqliteClient` und
  `SqliteMigrator`.
- Vite 8 prüft am Dev-Server selbst die `Host`-Kopfzeile (`server.allowedHosts`; Vorgabe laut
  Typdefinition: `localhost`, `*.localhost` und alle IP-Adressen). Für den Proxy aus REQ-SRV-6
  heißt das: der Dev-Port ist eigenständig geschützt.
- Das KONZEPT nennt paperless-mcp als Muster; paperless-mcp benutzt `@effect/platform` nur als
  **HTTP-Client** (`src/paperless/client.ts:2-6`, `src/index.ts:2`), keinen `HttpApi`-Server und
  kein SQL. Übertragbar sind getaggte Fehler und Layer-Aufbau.

**Zielbetrieb (gemessen vom Menschen, 2026-11-25), nur als Rahmen; Deploy ist M4:** Raspberry Pi 3B,
`aarch64`, 906 MB RAM, davon etwa 615 MB verfügbar. Port 80 belegt die Rezepte-App (Docker), sonst
nur 22; 8080 ist frei. Node ist auf dem Host nicht installiert; Anwendungen laufen im Container.
Annahmen dieser Spec dazu und offene Punkte: Abschnitt „Annahmen zum Zielbetrieb“.

## User Story

Als Bahnbauer, der mit seiner Familie auf Laptop, Tablet und Handy Carrera-GO!!!-Strecken plant,
möchte ich einen Dienst im Heimnetz, der unsere gespeicherten Strecken und unseren Teilebestand an
**einer** Stelle hält und eine veraltete Änderung ablehnt statt still zu überschreiben — damit die
Geräte im nächsten Schritt (Teil B) alle dasselbe sehen.

## Begriffe und Konventionen

Konvention zur Prüfbarkeit, keine Domänenwahrheit. Alles aus M1, M2, M3a gilt weiter.

- **Server:** ein Node-Prozess aus `src/server`, der die API unter `/api/…` und die gebauten
  Frontend-Dateien auf **einem** Port ausliefert (Entscheidung 5).
- **Layoutname:** Zeichenkette ohne Leerraum am Rand, nicht leer, höchstens 200 Zeichen (Länge der
  JavaScript-Zeichenkette). Jedes andere Zeichen ist erlaubt, auch `/`, `:`, `%` und Umlaute. Der
  Name ist die Identität eines Layouts (wie der Schlüssel in M2); Umbenennen gibt es nicht
  (Entscheidung 12).
- **Version:** ganze Zahl. Ein Layout entsteht mit Version 1, jede gelungene Änderung erhöht um
  genau 1. Der Bestand hat Version 0, solange er nie gespeichert wurde.
- **Erwartete Version:** die Version, die der Client zuletzt gesehen hat und mit jeder Änderung
  mitschickt. 0 heißt „ich lege neu an“.
- **Stand:** Name (bei Layouts), Version, Änderungszeit (`updatedAt`, ISO 8601 UTC mit
  Millisekunden und `Z`, vom Server gesetzt) und Inhalt.
- **Konflikt:** erwartete Version ≠ Version auf dem Server (einschließlich: neu anlegen, obwohl es
  den Namen gibt; ändern oder löschen, obwohl es ihn nicht mehr gibt).
- **Server-Port P:** der Wert von `CARRERA_PORT` (Vorgabe 8080).
- **Erlaubtliste:** die Werte der `Host`-Kopfzeile, auf die der Server antwortet (REQ-SRV-7).
  Verglichen wird ohne Groß-/Kleinschreibung; eine `Host`-Angabe ohne Port meint Port 80.

## Aufteilung

| Schicht | Inhalt | Ort | Nachweis |
|---|---|---|---|
| Datenvertrag | Layoutname, Stände, Anfragen, Fehler (`api.ts`); `HttpApi`-Definition (`http-api.ts`) | `src/schema` | Tests von spec-to-tests, Ratchet |
| Server | Endpunkte, Host-Prüfung, SQLite, Migrationen, Start, statische Dateien | `src/server` | HTTP-Tests gegen echtes SQLite (spec-to-tests), Ratchet (nach Admin-PR) |
| Entwicklung | Proxy `/api` | `vite.config.ts` | Smoke |

## API M3b

Maßgeblich für REQ-API-5 bis -17. Alle Körper sind JSON (`Content-Type: application/json`); `{name}`
steht prozentkodiert im Pfad (`encodeURIComponent`). Fehlerkörper tragen `_tag`. Vor allem steht
die Host-Prüfung (REQ-SRV-7): mit fremdem Host antwortet jede Route mit 421.

| Methode und Pfad | Anfrage | Erfolg | Fehler |
|---|---|---|---|
| `GET /api/status` | – | 200 `{ "status": "ok" }` | – |
| `GET /api/layouts` | – | 200 Liste aus `{ name, version, updatedAt }`, bei defektem Eintrag zusätzlich `defekt` (Grund) | – |
| `GET /api/layouts/{name}` | – | 200 Stand `{ name, version, updatedAt, layout }` | 404 `NichtGefunden`, 500 `GespeichertUngueltig` |
| `PUT /api/layouts/{name}` | `{ expectedVersion, layout }` | 201 (neu) oder 200 (geändert), Körper `{ name, version, updatedAt }` | 400 `UngueltigeAnfrage`, 409 `VersionKonflikt`, 413 `ZuGross`, 415 |
| `DELETE /api/layouts/{name}?version=n` | – | 204 | 400, 404 `NichtGefunden`, 409 `VersionKonflikt` |
| `GET /api/bestand` | – | 200 `{ version, updatedAt, inventory }` | 500 `GespeichertUngueltig` |
| `PUT /api/bestand` | `{ expectedVersion, inventory }` | 200 `{ version, updatedAt }` | 400, 409 `VersionKonflikt`, 413, 415 |
| jede, fremder Host | – | – | 421 `FremderHost` |

`layout` ist genau ein mit `LayoutSchema` kodiertes Layout, `inventory` genau ein mit
`InventorySchema` kodierter Bestand (beide unverändert aus M1/M3a). `VersionKonflikt` trägt
`expectedVersion` und `aktuell`: den vollständigen Stand auf dem Server oder `null`, wenn es das
Layout nicht (mehr) gibt (Entscheidung 3).

## Akzeptanzkriterien

### Datenvertrag (`src/schema`)

- **REQ-API-1** [Contract] `src/schema` exportiert ein Schema für den Layoutnamen nach
  „Begriffe“. Abgewiesen werden: leer, nur Leerraum, Leerraum am Anfang oder Ende, mehr als 200
  Zeichen, kein String. Angenommen werden u. a. `Oval`, `Acht / groß`, `a:b`, `100%`, ein Name
  mit genau 200 Zeichen.
- **REQ-API-2** [Contract] `src/schema` exportiert Schemas für Layout-Übersicht
  (`name`, `version` ≥ 1, `updatedAt`, optional `defekt`), Layout-Stand (dazu `layout` nach
  `LayoutSchema`), Bestands-Stand (`version` ≥ 0, `updatedAt` als Zeichenkette oder `null`,
  `inventory` nach `InventorySchema`) und die Anfragen `{ expectedVersion, layout }` und
  `{ expectedVersion, inventory }` (`expectedVersion` ganze Zahl ≥ 0). `updatedAt` ist ISO 8601 in
  UTC mit Millisekunden und `Z`. Unbekannte Zusatzfelder, negative oder gebrochene Versionen,
  Versionen als Text und ein fehlendes Pflichtfeld werden abgewiesen; Kodieren und Dekodieren eines
  gültigen Werts ergibt denselben Wert (Eigenschaft). `LayoutSchema` und `InventorySchema` ändern
  sich nicht; die M1- und M3a-Tests in `src/schema` laufen unverändert grün.
- **REQ-API-3** [Contract] `src/schema` exportiert die Fehlerformen `UngueltigeAnfrage`
  (`reason`), `NichtGefunden` (`name`), `VersionKonflikt` (`expectedVersion`, `aktuell`: Layout-
  bzw. Bestands-Stand oder `null`), `GespeichertUngueltig` (`ziel`: Layoutname oder `"bestand"`,
  `version`, `reason`), `ZuGross`, `FremderHost` (`host`: die empfangene Angabe oder `null`) und
  `ServerFehler` (`text`), jede mit `_tag`. Zusatzfelder werden abgewiesen.
- **REQ-API-4** [Architektur] Die `HttpApi`-Definition (Gruppen, Endpunkte, Pfade, Statuscodes,
  Schemas der Tabelle „API M3b“) liegt in `src/schema/http-api.ts` und wird **nicht** über
  `src/schema/index.ts` exportiert; die Datenschemas aus REQ-API-1 bis -3 schon (Entscheidung 7).
  Wirkungsnachweis: Ein Vitest-Lauf, in dem `@effect/platform` durch einen Stub ersetzt ist, der
  beim Laden wirft, lädt `src/schema/index.ts` und dekodiert einen Layout-Stand (Muster wie
  REQ-WARCH-1); derselbe Lauf mit `src/schema/http-api.ts` scheitert.

### Endpunkte (`src/server`)

- **REQ-API-5** [When] `GET /api/layouts` liefert 200 und alle Layouts als Übersicht ohne
  Inhalt, sortiert mit `localeCompare` (Locale „de“, Groß-/Kleinschreibung ignoriert, wie
  REQ-STORE-3). Leere Datenbank → `[]`.
- **REQ-API-6** [When] `PUT /api/layouts/{name}` mit `expectedVersion` 0 und einem Namen, den es
  nicht gibt, legt das Layout an: 201, Körper mit Version 1 und `updatedAt`. Danach liefert
  `GET /api/layouts/{name}` genau dieses Layout. Der Name im Pfad wird nach dem Dekodieren gegen
  REQ-API-1 geprüft und nicht still getrimmt: `%20Oval` → 400. Beispiel: `Acht / groß`, kodiert
  `Acht%20%2F%20gro%C3%9F`, wird angelegt und unter genau diesem Namen gelistet und geladen.
- **REQ-API-7** [When] `PUT /api/layouts/{name}` mit `expectedVersion` gleich der Version auf dem
  Server ersetzt den Inhalt: 200, Version um genau 1 höher, neues `updatedAt` ≥ dem alten.
- **REQ-API-8** [If/Then] Ist bei `PUT /api/layouts/{name}` die erwartete Version eine andere als
  auf dem Server (Konflikt), antwortet der Server 409 `VersionKonflikt` mit dem vollständigen
  aktuellen Stand bzw. `aktuell: null`, und die Datenbank bleibt unverändert (Inhalt, Version,
  `updatedAt`). Fälle: `expectedVersion` 0 bei vorhandenem Namen; `expectedVersion` 3 bei
  Version 4; `expectedVersion` 2 bei gelöschtem Layout (`aktuell: null`).
- **REQ-API-9** [When] `GET /api/layouts/{name}` liefert 200 mit dem Stand; gibt es den Namen
  nicht, 404 `NichtGefunden` mit dem Namen.
- **REQ-API-10** [When] `DELETE /api/layouts/{name}?version=n` löscht nur, wenn n die Version auf
  dem Server ist: 204, danach 404 beim Lesen. Bei anderer Version 409 mit aktuellem Stand, bei
  fehlendem Namen 404, bei fehlendem oder ungültigem `version` 400; in keinem Fehlerfall ändert
  sich die Datenbank (Entscheidung 3).
- **REQ-API-11** [When] `GET /api/bestand` liefert 200 mit dem Bestands-Stand. Wurde nie ein
  Bestand gespeichert: `{ "version": 0, "updatedAt": null, "inventory": { "schemaVersion": 1,
  "counts": {} } }` (Entscheidung 4: ein Bestand für den Haushalt).
- **REQ-API-12** [When] `PUT /api/bestand` mit passender `expectedVersion` speichert den Bestand:
  200, Version + 1. Bei Konflikt 409 mit aktuellem Bestands-Stand, Datenbank unverändert. Der
  Server prüft nur das Schema, nicht den Katalog: Teil-IDs, die der Katalog nicht kennt, werden
  gespeichert und unverändert zurückgegeben (wie REQ-BEST-7). Beispiel: `expectedVersion` 0,
  `{"schemaVersion":1,"counts":{"kurve-1-90":8,"gibt-es-nicht":3}}` → 200, Version 1, `GET`
  liefert beide Einträge.
- **REQ-API-13** [If/Then] Ist ein Anfragekörper kein JSON, besteht er die Schemas aus REQ-API-2
  nicht (fehlende oder fremde `schemaVersion`, Zusatzfeld, doppelte Element-ID, negative Anzahl,
  `expectedVersion` −1) oder ist der Name ungültig, antwortet der Server 400 `UngueltigeAnfrage`
  mit dem Text der Schema-Prüfung als Grund. Ein Körper über 1 MiB → 413 `ZuGross`, ein
  `Content-Type` außer `application/json` bei `PUT` → 415. In allen Fällen ändert sich die
  Datenbank nicht. Nichts wird still bereinigt („alte Layouts scheitern laut“).
- **REQ-API-14** [Contract] **Wettlauf.** Schicken 10 Anfragen gleichzeitig `PUT` mit derselben
  erwarteten Version an dasselbe Layout (bzw. an den Bestand), bekommt genau eine 200/201 und neun
  409; danach ist die Version genau um 1 gestiegen und der Inhalt ist der der erfolgreichen
  Anfrage. Ebenso bei gleichzeitigem `PUT` und `DELETE` mit derselben Version: genau eine gewinnt.
- **REQ-API-15** [Contract] Eigenschaft (beliebige schema-gültige Layouts und Bestände, beliebige
  Folgen aus Anlegen, Ändern, Löschen mit richtigen und falschen Versionen): `GET` nach einem
  gelungenen `PUT` liefert denselben Inhalt (tiefe Gleichheit, Reihenfolge der Elemente
  eingeschlossen); jede gelungene Änderung erhöht die Version um genau 1; jede abgewiesene ändert
  weder Inhalt noch Version noch `updatedAt`.
- **REQ-API-16** [If/Then] Ein Pfad unter `/api/`, den die Tabelle nicht kennt, liefert 404, eine
  bekannte Route mit falscher Methode 404 oder 405; beides als JSON, nie die Startseite.
- **REQ-API-17** [Architektur] Der Server sendet keine CORS-Kopfzeilen: Eine `OPTIONS`-Anfrage mit
  erlaubtem Host, `Origin: http://fremd.example` und `Access-Control-Request-Method: PUT` bekommt
  keine `Access-Control-Allow-Origin`-Kopfzeile. Zusammen mit REQ-API-13 (`PUT` nur mit JSON) kann
  eine fremde Webseite im Browser eines Heimnetz-Geräts damit nichts schreiben; gegen
  DNS-Rebinding, bei dem die fremde Seite gleiche Herkunft vortäuscht, schützt REQ-SRV-7
  (Entscheidung 9).

### Datenbank (`src/server`, `src/server/migrations`)

- **REQ-DB-1** [When] Startet der Server mit einem Datenbankpfad, unter dem es noch keine Datei
  gibt, legt er das Verzeichnis und die Datei an, richtet die Tabellen über die Migrationen aus
  `src/server/migrations` ein und schreibt eine Zeile mit dem Pfad und „neu angelegt“ auf die
  Standardausgabe.
- **REQ-DB-2** [Contract] Nach Beenden (REQ-SRV-5) und Neustart mit derselben Datei liefert die API
  dieselben Layouts mit denselben Versionen, `updatedAt` und Inhalten und denselben Bestands-Stand.
- **REQ-DB-3** [If/Then] Ist die Datei unter dem Datenbankpfad keine SQLite-Datenbank, nicht
  lesbar oder enthält sie eine Migration, die dieser Stand des Servers nicht kennt (neuerer
  Server lief darauf), startet der Server **nicht**: Exit-Code ≠ 0, eine Meldung auf der
  Fehlerausgabe mit Pfad und Grund, und die Datei ist danach Byte für Byte unverändert. Er legt
  nie eine neue leere Datenbank über eine vorhandene Datei (Entscheidung 8).
- **REQ-DB-4** [If/Then] Besteht ein gespeicherter Inhalt beim Lesen sein Schema nicht (z. B. von
  Hand in der Datei geändert), antwortet `GET` auf dieses Layout bzw. den Bestand mit 500
  `GespeichertUngueltig` (Ziel, Version, Grund). `GET /api/layouts` listet das Layout weiter, mit
  Feld `defekt` und Grund. Der gespeicherte Wert wird beim Lesen weder verändert noch gelöscht;
  `PUT` und `DELETE` mit der Version aus der Fehlerantwort wirken normal (Weg zur Reparatur).
- **REQ-DB-5** [Contract] In der Datenbank steht je Layout genau eine Zeile (Name, Version,
  `updatedAt`, Inhalt als JSON-Text des mit `LayoutSchema` kodierten Layouts) und für den Bestand
  höchstens eine Zeile (Version, `updatedAt`, JSON-Text des mit `InventorySchema` kodierten
  Bestands). Wirkungsnachweis: nach den Beispielen aus REQ-API-6/-12 die Datei mit
  `better-sqlite3` öffnen und die Zeilen lesen.

### Betrieb (`src/server`, `vite.config.ts`)

- **REQ-SRV-1** [Where] Der Server startet aus dem Repo mit `pnpm build` (Frontend nach `dist/`),
  `pnpm build:server` (übersetzt mit der neuen Datei `tsconfig.server.json`, die `tsconfig.json`
  erweitert, nach `dist-server/`) und `pnpm start` (Skripte aus dem Admin-PR, Vorbedingung oben).
  Einstellungen über Umgebungsvariablen mit Vorgabe: `CARRERA_HOST` (`0.0.0.0`), `CARRERA_PORT`
  (`8080`), `CARRERA_DB` (`data/carrera-planer.sqlite`), `CARRERA_STATIC` (`dist`),
  `CARRERA_ALLOWED_HOSTS` (leer, REQ-SRV-7). Nach dem Start steht auf der Standardausgabe eine
  Zeile mit Adresse, Datenbankpfad und wirksamer Erlaubtliste. Ein ungültiger Port (kein
  ganzzahliger Wert 1–65535) bricht mit Exit-Code ≠ 0 und Meldung ab. `.gitignore` bekommt
  `dist-server/`, `data/`, `*.sqlite-wal` und `*.sqlite-shm` (Entscheidung 6).
- **REQ-SRV-2** [When] Der Server liefert unter `/` die `index.html` aus `CARRERA_STATIC` und alle
  gebauten Dateien mit passendem `Content-Type`, auf demselben Port wie die API (Entscheidung 5).
  Ein Pfad außerhalb von `CARRERA_STATIC` ist nicht erreichbar (`/../package.json`,
  `/%2e%2e/package.json` → 404). Fehlt das Verzeichnis, startet der Server trotzdem, warnt beim
  Start und antwortet unter `/` mit 404 und dem Hinweis „Frontend nicht gebaut (pnpm build)“; die
  API läuft.
- **REQ-SRV-3** [When] `GET /api/status` antwortet 200 `{ "status": "ok" }`, sobald die Datenbank
  offen und migriert ist.
- **REQ-SRV-4** [If/Then] Wirft die Verarbeitung einer Anfrage einen unerwarteten Fehler,
  antwortet der Server 500 `ServerFehler` ohne Stacktrace im Körper, schreibt den Fehler auf die
  Fehlerausgabe und beantwortet die nächste Anfrage normal.
- **REQ-SRV-5** [When] Auf `SIGINT` oder `SIGTERM` nimmt der Server keine neuen Verbindungen mehr
  an, schließt die Datenbank und endet mit Exit-Code 0 binnen 5 s. Eine danach geöffnete Datei
  zeigt alle vorher bestätigten Änderungen. Das gilt auch, wenn der Server als PID 1 läuft
  (Container in M4: Node installiert dort keine Standard-Signalbehandlung, der Server muss die
  Signale selbst abfangen).
- **REQ-SRV-6** [Where] Für die Entwicklung leitet `pnpm dev` (Vite) Anfragen unter `/api` an
  `http://localhost:<CARRERA_PORT, sonst 8080>` weiter (`server.proxy` in `vite.config.ts`, nicht
  geschützt), mit `changeOrigin: true`, damit beim Server `Host: localhost:<P>` ankommt und
  REQ-SRV-7 greift, ohne die Erlaubtliste aufzuweichen. Grund: Teil B entwickelt gegen den Server
  mit Vites Neuladen.
- **REQ-SRV-7** [If/Then] **Host-Prüfung gegen DNS-Rebinding.** Steht die `Host`-Kopfzeile einer
  Anfrage nicht in der Erlaubtliste oder fehlt sie, antwortet der Server **421 Misdirected
  Request** mit `FremderHost` und nichts sonst (Entscheidung 9). Die Prüfung kommt vor Routing,
  Körperlesen, Datenbank und Dateisystem; sie gilt für API und statische Dateien gleich. Die
  Erlaubtliste ist `localhost:<P>`, `127.0.0.1:<P>`, `[::1]:<P>`, dazu `<CARRERA_HOST>:<P>`, wenn
  `CARRERA_HOST` eine bestimmte Adresse ist (nicht `0.0.0.0` und nicht `::`), dazu jeder Eintrag
  aus `CARRERA_ALLOWED_HOSTS` (durch Komma getrennt; Leerraum am Rand wird entfernt; ein Eintrag
  ohne Port gilt mit Port P, einer mit Port genau so). Ein ungültiger Eintrag (leer zwischen zwei
  Kommas, mit Schema wie `http://`, mit Pfad, Port außerhalb 1–65535) bricht den Start mit
  Exit-Code ≠ 0 und Meldung ab. Beispiel mit P = 8080 und
  `CARRERA_ALLOWED_HOSTS=rezepte.local,192.168.178.113`: erlaubt `rezepte.local:8080`,
  `REZEPTE.local:8080`, `192.168.178.113:8080`, `localhost:8080`; abgelehnt `rezepte.local`
  (Port 80), `evil.example:8080`, `192.168.178.113:9999`, fehlender Host. Wirkungsnachweis über
  echte HTTP-Anfragen mit fremdem Host (Datenbank mit einem angelegten Layout „Oval“ und einem
  Bestand, Version 1): `GET /api/layouts`, `GET /api/layouts/Oval`, `GET /api/bestand` und
  `GET /` liefern 421, und der Körper enthält weder `Oval` noch einen Teilenamen noch Inhalt der
  `index.html`; `PUT /api/layouts/Neu` (Version 0), `PUT /api/bestand` (Version 1) und
  `DELETE /api/layouts/Oval?version=1` liefern 421, und danach zeigt die Datenbank genau den
  vorigen Inhalt (Layoutliste, Versionen, `updatedAt`, Bestand). Dieselben Anfragen mit erlaubtem
  Host wirken normal (Gegenprobe, sonst bewiese die Ablehnung nichts).

### Architektur

- **REQ-SARCH-1** [Architektur] Teil A ändert keine Datei unter `src/core`, `src/catalog` und
  `src/web`, und `LayoutSchema`, `InventorySchema`, `CatalogEntrySchema`, `SetTemplateSchema`
  bleiben unverändert. Wirkungsnachweis: Alle Tests von M1 bis plan-beschriftung-symbole laufen
  unverändert grün; `pnpm typecheck`, `pnpm lint` und `pnpm test` sind grün.
- **REQ-SARCH-2** [Architektur] Die Server-Tests laufen über die HTTP-Schnittstelle (Handler aus
  `HttpApiBuilder` oder echter Port) gegen echtes SQLite (in-memory oder temporäre Datei), ohne
  nachgebautes SQL. `src/server` steht im Mutations-Ratchet (`break=100`, Vorbedingung Admin-PR,
  Entscheidung 10): `pnpm test:mutation` endet ohne überlebenden Mutanten in `src/server`,
  `src/schema`, `src/core`, `src/catalog` und `src/web/editor`; Überlebende werden mit Tests
  getötet, nie ausgeblendet. Als Kanarienvögel prüft die Critic-Station, dass diese Mutationen im
  Stryker-Bericht als getötet (nicht „ohne Abdeckung“, nicht „Laufzeitfehler“) auftauchen oder,
  falls Stryker sie nicht erzeugt, von Hand je einen Test rot machen: Versionsvergleich entfernt;
  Version + 2 statt + 1; 409 durch 200 ersetzt; Schema-Prüfung beim Lesen entfernt;
  Schema-Prüfung beim Schreiben entfernt; `DELETE` ohne Versionsbedingung; Trimmen des
  Pfadnamens eingebaut; Host-Prüfung entfernt; Port beim Host-Vergleich ignoriert.
- **REQ-SARCH-3** [Performance] Für ein Layout mit 1000 Elementen dauern `PUT` plus `GET` über den
  HTTP-Handler gegen eine Datei-Datenbank höchstens 100 ms im Maximum über 20 Durchläufe
  (Vitest, Node 22), `PUT /api/bestand` mit allen Katalogteilen höchstens 50 ms im Maximum; der
  Test gibt Maximum und Median aus. Gemessen auf dem Entwicklungsrechner bzw. in CI, nicht auf dem
  Raspi (Annahme 4).
- **REQ-SARCH-5** [Performance] **Speicher.** Der gestartete Server (übersetzter Stand,
  `pnpm start`, Node 22) belegt nach dem Start und nach 200 Anfragen (100 × `PUT` eines Layouts mit
  1000 Elementen unter wechselnden Namen, 100 × `GET`) höchstens 150 MB Resident Set Size; der
  Test gibt den Höchstwert über die Messpunkte aus. Grund: Auf dem Ziel sind etwa 615 MB frei, die
  Rezepte-App läuft daneben (Annahme 3). (`REQ-SARCH-4` war im Entwurf `0b59a44` Teil B
  zugeordnet und bleibt frei.)

## Entscheidungen

Laut Rückmeldung an die Kette vom 2026-11-25 hat der Mensch die Empfehlungen des Entwurfs
`0b59a44` angenommen, mit den Abweichungen 9 (Host-Prüfung), 10 (Ratchet) und 11 (keine
Übernahme). Die Begründungen bleiben als Spur.

1. **Schnitt: nur Teil A.** 48 Kriterien und fünf abgelöste aus M2/M3a hätten einen Lauf
   überladen; Teil A ist allein über HTTP prüfbar und macht die API stabil, bevor die Anbindung
   abgenommene Tests umbaut.
2. **Auf dem Server liegen nur benannte Layouts und der Bestand.** Arbeitsstand, Modus und
   „Namen“ bleiben je Gerät (Teil B); der Arbeitsstand wird bei jedem Tipp gesichert, auf dem
   Server würden sich zwei Geräte ständig überschreiben.
3. **Konflikt: 409 mit vollem aktuellem Stand; `DELETE` prüft die Version.** Der Stand in der
   Antwort erspart einen zweiten Abruf; ohne Versionsprüfung beim Löschen löschte ein veraltetes
   Gerät still die neue Fassung des anderen.
4. **Ein Bestand für den Haushalt, mit Version.** KONZEPT: „unsere Bahn“, eine Kiste. Ohne Version
   gewänne der letzte Schreiber.
5. **Ein Port für Frontend und API, Vorgabe 8080.** Gleiche Herkunft, keine CORS-Konfiguration,
   ein Container-Port in M4. 8080 ist auf dem Ziel frei, 80 belegt die Rezepte-App.
6. **Start über `tsc` und eigene `tsconfig.server.json`, Skripte per Admin-PR.** Gemessen: Node
   führt die Quellen nicht direkt aus, `tsc` mit eigener tsconfig schon. `build:server` und `start`
   getrennt, damit M4 im Container nicht übersetzen muss.
7. **`HttpApi`-Definition in `src/schema/http-api.ts`, nicht im Barrel.** Constitution: API im
   Datenvertrag; KONZEPT: Effect im Frontend nur als Schema.
8. **Fehler laut statt still:** kaputte Datei → kein Start; kaputte Zeile → 500 mit Grund,
   reparierbar; ungültige Anfrage → 400.
9. **Kein Login, keine CORS-Freigabe, Host-Prüfung mit 421** (Abweichung vom Entwurf, der
   DNS-Rebinding als bekannte Grenze führte). Statuscode **421** statt 403: 421 sagt genau „dieser
   Server antwortet nicht für diese Adresse“; 403 hieße „Ressource bekannt, Zugriff verboten“ und
   klänge nach einem Rechtekonzept, das es nicht gibt, und es ließe sich im Protokoll nicht von
   einem späteren echten 403 unterscheiden. Der Server spricht HTTP/1.1; das Wiederholen einer
   421-Anfrage auf neuer Verbindung, das Browser bei HTTP/2 machen, betrifft ihn nicht (nicht
   gemessen). Erlaubtliste wie vorgegeben (localhost, 127.0.0.1, konfigurierter Host, je mit
   Port), dazu `[::1]` als drittes Loopback; erweiterbar über `CARRERA_ALLOWED_HOSTS`.
10. **`src/server` im Mutations-Ratchet** (Abweichung vom Entwurf, der Handproben vorschlug). Die
    Änderung an `stryker.config.json`, `vitest.mutation.config.ts` und `package.json` macht der
    Mensch per Admin-PR; die Kette fasst den geschützten Satz nicht an.
11. **Keine Übernahme-Funktion für lokale Daten** (Abweichung vom Entwurf). Siehe Nicht-Ziele.
12. **Layoutnamen bis 200 Zeichen** (bestätigt).

## Annahmen zum Zielbetrieb

Teil A wird nicht ausgeliefert; diese Punkte prüft M4. Sie stehen hier, weil die Spec sonst
stillschweigend etwas über die Laufzeit annähme.

1. **Node-Version.** `.nvmrc` und `engines` sagen 22; gemessen habe ich nur mit Node 26.13.1.
   Annahme: CI und der M4-Container laufen mit Node 22; REQ-SARCH-3 und -5 gelten für Node 22.
   Auf dem Raspi ist Node nicht installiert, also kein Widerspruch dort; die Version legt das
   Container-Image in M4 fest.
2. **Prozessorarchitektur — offener Punkt mit Risiko.** `aarch64` ist die Kernel-Architektur.
   Raspberry Pi OS liefert auf dem 3B auch einen 64-Bit-Kernel mit 32-Bit-Userland aus; dann zieht
   Docker `linux/arm/v7`-Images, und für `linux-arm` hat `better-sqlite3` 13.2.0 **keine**
   fertige Binärdatei. Es müsste im Image übersetzt werden (Compiler im Build-Schritt, und
   `pnpm-workspace.yaml` müsste den Build von `better-sqlite3` freigeben, geschützter Satz).
   Vor M4 auf dem Raspi prüfen: `docker info --format '{{.Architecture}}'` und
   `dpkg --print-architecture` (erwartet `aarch64`/`arm64`), oder die Architektur des
   Rezepte-Images (`docker image inspect … --format '{{.Architecture}}'`).
3. **Speicher.** Etwa 615 MB frei neben der Rezepte-App. Annahme: unter 150 MB für den Server
   (REQ-SARCH-5, gemessen auf dem Entwicklungsrechner). Auf dem Raspi selbst erst in M4.
4. **Rechenzeit.** Die Grenzen aus REQ-SARCH-3 gelten auf dem Entwicklungsrechner und in CI. Ein
   Pi 3B ist deutlich langsamer (nicht gemessen); ob die Antwortzeiten dort im Alltag reichen,
   misst M4.
5. **Übersetzen nicht auf dem Raspi.** `tsc` braucht viel Speicher; Annahme: das Image wird
   außerhalb gebaut oder übersetzt im Build-Schritt, und auf dem Raspi läuft nur `pnpm start`
   (Grund für die getrennten Skripte, Entscheidung 6).
6. **Port.** 8080 ist frei (gemessen); der Container bindet `0.0.0.0` (Vorgabe `CARRERA_HOST`).
   Für Zugriffe über `rezepte.local:8080` oder die LAN-IP muss `CARRERA_ALLOWED_HOSTS` gesetzt
   sein, sonst antwortet der Server dort mit 421 (REQ-SRV-7). Das ist Absicht und gehört in die
   M4-Konfiguration.

## Folgespec Teil B (nicht Gegenstand)

Die Anbindung des Browsers ist eine eigene, spätere Spec mit eigenen Kriterien. Diese Spec
erzeugt dafür keine Kriterien und keine Tests. Festgehalten, weil die API darauf zugeschnitten ist:

- **Server führend.** Benannte Layouts und Bestand kommen vom Server; Arbeitsstand, Modus und der
  Schalter „Namen“ bleiben lokal.
- **Ohne Server nur lesen.** Der Editor arbeitet lokal weiter (Arbeitsstand, Export); Speichern,
  Laden und Löschen auf dem Server werden mit Meldung abgewiesen; keine Warteschlange für später.
- **Bestand aus dem Cache mit „Stand vom …“.** Ohne Server zeigt die Seite den zuletzt geholten
  Bestand, schreibgeschützt und mit Zeitangabe; Bestandsmodus und Einkaufsliste rechnen damit.
- **Konflikt-Dialog mit vier Wegen** bei 409 auf einem Layout: unter neuem Namen speichern
  (vorbelegt „<Name> (2)“), Server-Stand laden (rückgängig machbar), trotzdem überschreiben (nach
  zweiter Bestätigung), abbrechen. Beim Bestand: neu laden, eigene Änderung nicht automatisch
  nachspielen.
- Teil B löst abgenommene Kriterien aus M2/M3a ab (Sichern des Bestands im `localStorage`,
  Tab-Abgleich, „nichts aus dem Netz“); die betroffenen Tests liegen in
  `src/web/editor/planner-session.test.ts` und `src/web/editor/tab-sync.test.ts`.

## Nicht-Ziele (M3b Teil A)

- Jede Änderung der Oberfläche: Speichern/Laden und Bestand im Browser laufen weiter über
  `localStorage` (Teil B).
- **Keine Übernahme lokaler Daten durch die Anwendung.** Lokal gespeicherte Layouts kommen per
  Export und Import (danach Speichern) auf den Server, der Bestand über die Set-Vorlagen
  (Entscheidung 11).
- Deploy auf den Raspi, Dockerfile, Datensicherung der Datenbankdatei (M4).
- Live-Mitbearbeitung, Benachrichtigung über fremde Änderungen, Polling (KONZEPT).
- Login, Benutzer, Rechte, HTTPS (Constitution; Heimnetz und VPN).
- Umbenennen von Layouts, Verlauf alter Versionen, Papierkorb.
- Server-seitige Prüfung gegen den Katalog (unbekannte Teile, Geschlossenheit): der Server prüft
  nur das Schema.
- Änderungen an `src/core`, `src/catalog`, `src/web`, `LayoutSchema`, `InventorySchema`.

## Bekannte Grenzen

- **Peer-Versionen.** `@effect/sql-sqlite-node` 0.54.1 verlangt `@effect/platform ^0.97.3` und
  `@effect/sql ^0.52.2`, installiert sind 0.97.2 und 0.52.1. Die Probe lief; ein Anheben ist ein
  Admin-PR am Lockfile.
- **Gleicher Inhalt, anderer Name** wird nicht als Dublette erkannt (der Name ist die Identität).
- **Zeitstempel kommen von der Server-Uhr.** Geht sie falsch, sind die Zeiten falsch; die
  Versionsprüfung hängt nicht daran.
- **Host-Prüfung ersetzt keinen Login.** Jedes Gerät im Heimnetz oder VPN, das eine erlaubte
  Adresse anspricht, darf lesen und schreiben (Constitution).
- **IP-Adressen nur per Liste.** Anders als Vite erlaubt der Server nicht automatisch jede
  IP-Adresse; die LAN-IP muss in `CARRERA_ALLOWED_HOSTS` stehen (sicherer, aber ein
  Konfigurationsschritt mehr; siehe „Zur Abnahme“).

## Zur Abnahme

Der Mensch entscheidet (Empfehlung jeweils in Klammern):

1. Statuscode 421 statt 403 für fremden Host (Entscheidung 9)? (421)
2. `[::1]:<P>` zusätzlich in der Vorgabe-Liste (dritte Loopback-Form; nicht in der Vorgabe des
   Menschen)? (ja)
3. Jede IP-Adresse als `Host` automatisch erlauben wie Vite? DNS-Rebinding braucht einen
   Hostnamen, eine IP-Adresse als `Host` kann es nicht vortäuschen. Spart das Eintragen der
   LAN-IP. (nein, Liste reicht; ja wäre vertretbar)
4. Zwei Skripte `build:server` und `start` im Admin-PR statt eines einzigen `start`, das auch
   übersetzt (Annahme 5)? (zwei)
5. Admin-PR ändert neben `stryker.config.json` auch `vitest.mutation.config.ts`; ohne das läuft
   unter Stryker kein Server-Test. (ja, nötig)
6. Speicher-Kriterium REQ-SARCH-5 mit 150 MB (neu, aus dem gemessenen Zielbetrieb)? (ja)
7. Architektur auf dem Raspi vor M4 prüfen (Annahme 2)? (ja; bei 32-Bit-Userland wird M4
   deutlich teurer)

## Smoke

**Aufrufer des geänderten Pfads.** Nachgesehen am Basisstand `9ffe100`:

- `src/server/index.ts:1-2` ist ein Platzhalter (`export {};`). Heute ruft **niemand** den Server:
  keine Oberfläche, kein MCP, kein anderer Dienst. Nach Teil A rufen ihn nur HTTP-Clients (im Smoke
  `curl`) und der Browser, der die ausgelieferten Frontend-Dateien lädt.
- Die Oberfläche spricht in Teil A **nicht** mit der API: sie speichert weiter über
  `localStorage` (`mount` in `src/web/ui/app.tsx:559-564` mit `browserStorage()` aus
  `src/web/ui/browser.ts:13`; Layouts über `src/web/ui/dialog.tsx:41`, `:46`, `:102`, `:118`;
  Bestand über `src/web/ui/inventory-dialog.tsx:122`, `:151`, `:162`, `:170`, `:186`). Diese
  Stellen ändert erst Teil B.

Start (nach dem Admin-PR):

```
pnpm build
pnpm build:server
CARRERA_DB=/tmp/carrera-smoke.sqlite pnpm start
```

`B=http://localhost:8080`. Vor dem Admin-PR statt der beiden Skripte:
`pnpm exec tsc -p tsconfig.server.json` und `node dist-server/server/main.js`.

1. **Start.** Neue Datei: Ausgabe nennt Pfad, „neu angelegt“ und die Erlaubtliste;
   `curl $B/api/status` → `{"status":"ok"}`, `curl $B/api/layouts` → `[]`,
   `curl $B/api/bestand` → Version 0, leer.
2. **Anlegen, ändern, Konflikt.** `PUT $B/api/layouts/Oval` mit `expectedVersion` 0 und dem Oval
   (REQ-CORE-13 (c)) → 201, Version 1. Noch einmal mit 0 → 409, `aktuell.version` 1. Mit 1 → 200,
   Version 2. Mit 1 → 409; `GET` zeigt weiter Version 2.
3. **Name mit Sonderzeichen.** `Acht / groß` kodiert anlegen → in der Liste genau so, `GET`
   liefert ihn; `%20Oval` → 400.
4. **Löschen.** `DELETE …/Oval?version=1` → 409; `?version=2` → 204; `GET` → 404.
5. **Bestand.** `PUT $B/api/bestand` mit 0 und `{"kurve-1-90":8,"gibt-es-nicht":3}` → 200,
   Version 1; `GET` liefert beide Einträge. Mit 0 erneut → 409.
6. **Neustart.** Server mit Strg+C beenden (Exit 0), neu starten → dieselben Layouts, Versionen
   und derselbe Bestand.
7. **Frontend.** Im Browser `http://localhost:8080/` → der Planer erscheint wie mit `pnpm dev`
   (speichert weiter lokal; Teil B).
8. **Heimnetz.** Server mit `CARRERA_ALLOWED_HOSTS=<LAN-IP des Rechners>` neu starten; vom Handy
   `http://<LAN-IP>:8080/` → der Planer erscheint. Ohne die Variable → 421.
9. **Dev-Proxy.** `pnpm dev`, dann `curl http://localhost:5173/api/status` → `{"status":"ok"}`.

Gegenfälle, die geschlossen bleiben müssen:

10. **Fremder Host** (Layout „Oval“ und Bestand vorher anlegen):
    `curl -i -H 'Host: evil.example:8080' $B/api/layouts`, `…/api/layouts/Oval`, `…/api/bestand`,
    `$B/` → je 421, Körper ohne `Oval`, ohne Teilenamen, ohne HTML. `PUT` und `DELETE` mit
    `Host: evil.example:8080` → 421; danach mit richtigem Host `GET` → alles unverändert.
    `Host: localhost` (ohne Port) → 421; `curl --http1.0 -H 'Host:' $B/api/status` → 421.
11. Ungültig: Körper `kaputt`, `schemaVersion` 2, Zusatzfeld, doppelte Element-ID,
    `expectedVersion` −1, `Content-Type: text/plain`, 2 MB Körper → 400/415/413, `GET` danach
    unverändert.
12. `curl -i -X OPTIONS -H 'Origin: http://fremd.example' -H 'Access-Control-Request-Method: PUT'
    $B/api/bestand` → keine `Access-Control-Allow-Origin`-Kopfzeile.
13. `curl --path-as-is $B/../package.json` und `$B/%2e%2e/package.json` → 404.
14. Kaputte Datei: Server stoppen, `printf kaputt > /tmp/kaputt.sqlite`, mit
    `CARRERA_DB=/tmp/kaputt.sqlite` starten → Exit ≠ 0, Meldung mit Pfad;
    `cat /tmp/kaputt.sqlite` → weiterhin `kaputt`.
15. Kaputte Zeile: bei gestopptem Server den Inhalt von `Oval` per `sqlite3` auf `{"x":1}`
    setzen, starten → `GET …/Oval` 500 `GespeichertUngueltig` mit Grund, Liste zeigt `defekt`;
    `PUT` mit der Version aus der Antwort repariert.
16. `$B/api/gibtsnicht` → 404 als JSON, nicht die Startseite.
17. `CARRERA_ALLOWED_HOSTS='http://x'` bzw. `CARRERA_PORT=70000` → Start bricht mit Meldung ab.

### Nach dem Deploy

Teil A wird nicht ausgeliefert (Deploy ist M4). Erst dort nachweisbar:

- Architektur des Raspi-Userlands und damit, ob die fertige `better-sqlite3`-Binärdatei passt
  (Annahme 2).
- Speicher und Antwortzeiten auf dem Pi 3B neben der Rezepte-App (Annahmen 3 und 4).
- `SIGTERM` beim Stoppen des Containers beendet sauber, die Datei auf dem Volume übersteht den
  Neustart (REQ-SRV-5).
- Mit gesetztem `CARRERA_ALLOWED_HOSTS` erreichen Laptop, Tablet und Handy den Server über
  `rezepte.local:8080` bzw. die LAN-IP, per VPN ebenso; ein anderer Name auf dieselbe IP bekommt
  421.
