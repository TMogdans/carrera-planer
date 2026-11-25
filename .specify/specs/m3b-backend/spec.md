# Spec: M3b — Backend, Layouts und Bestand geräteübergreifend

Status: **Entwurf zur Abnahme** per Review des Spec-PR. Nichts davon ist abgenommen. Die
Kriterien verweisen mit „(Frage n)“ auf den Abschnitt „Empfehlungen zu den Entscheidungsfragen“;
was der Mensch entscheiden muss, steht gesammelt unter „Zur Abnahme“.
Grundlage: [KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23; Abschnitte „Ziel“,
„Architektur“ mit „Gleichzeitiges Bearbeiten“, „Meilensteine“),
[constitution.md](../../constitution.md), die umgesetzten Specs [M2](../m2-editor/spec.md),
[M3a](../m3a-bestand/spec.md) und [plan-beschriftung-symbole](../plan-beschriftung-symbole/spec.md).
Basisstand: `origin/main` = `9ffe100`.

**Teilungsvorschlag (Frage 1).** M3b ist für einen Lauf zu groß: 48 Kriterien, davon 31 für den
Server und 17 für die Anbindung im Browser, und die Anbindung löst fünf abgenommene Kriterien aus
M2/M3a ab (Abschnitt „Verhältnis zu M2 und M3a“). Vorschlag wie damals M3 → M3a/M3b:

- **Teil A — Server** (`src/schema`, `src/server`, `vite.config.ts`): API, Datenbank, Betrieb.
  Prüfbar allein über HTTP; die Oberfläche ändert sich nicht. Ein eigener devloop-Lauf.
- **Teil B — Anbindung** (`src/web/**`): Speichern/Laden und Bestand über den Server,
  Konflikthinweis, Verhalten ohne Server, Übernahme lokaler Daten. Ein zweiter Lauf, der gegen den
  gemergten Teil A arbeitet.

Beide Teile stehen hier, damit die Entscheidungen, die die API formen (Konfliktantwort mit
aktuellem Stand, Bestand mit Version, Übernahme ohne Summieren), zusammen abgenommen werden. Wird
die Teilung angenommen, wandert Teil B mit unveränderten REQ-IDs in eine eigene Spec
`m3b-anbindung`; wird sie abgelehnt, bleibt diese Datei ein Lauf.

**Tier: T3** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` gegen
`.devloop/tier-map.json`:

| Geplante Pfade | Ergebnis |
|---|---|
| ganzer Umfang (`src/schema/api.ts`, `src/schema/http-api.ts` + Tests, `src/server/**` inkl. `src/server/migrations/**` + Tests, `src/web/editor/**`, `src/web/ui/**`, `vite.config.ts`, diese Spec) | T3 |
| nur Teil A ohne `src/schema` (`src/server/main.ts`, `src/server/migrations/0001_init.ts`, `src/web/editor/remote.ts`) | T3 |
| Server ohne Migrationsordner (`src/server/main.ts` + Test, `src/web/**`, `vite.config.ts`) | T2 |
| nur Teil B (`src/web/editor/remote.ts`, `src/web/ui/app.tsx`) | T1 |
| nur `src/schema/api.ts` | T3 |

T3 kommt aus **zwei** Quellen: `src/schema/**` (die Constitution verlangt das API-Schema dort:
„einzige Quelle für Katalog, Layout, Bestand und API“) und `**/migrations/**` (Tabellenanlage der
Datenbank). Das Schema-Teil lässt sich als eigener kleiner PR abtrennen, aber **der Server bleibt
trotzdem T3**, solange die Tabellen über einen Migrationsordner angelegt werden. Den Ordner
umzubenennen, damit das Tier sinkt, wäre Umgehung des Gates: genau Datenbank-Schema ist, was die
Tier-Map schützen will. Teil B allein ist T1. Das autoritative Tier rechnet CI aus dem Diff.

Smoke: `.devloop/config.json` schaltet die Smoke-Station für T1 und T3 ein (`smoke.tiers`), also
für beide Teile. `smoke.setup` ist `null`; der Smoke startet den Server nach Abschnitt „Smoke“
selbst.

**Gemessen (2026-11-25, Worktree auf `9ffe100`, `pnpm install --frozen-lockfile --offline`):**

- Installiert: `effect` 3.22.5, `@effect/platform` 0.97.2, `@effect/platform-node` 0.108.4,
  `@effect/sql` 0.52.1, `@effect/sql-sqlite-node` 0.54.1, darunter `better-sqlite3` 13.2.0 und
  (transitiv) `@effect/experimental` 0.61.3. Neue Abhängigkeiten braucht keiner der beiden Teile.
- `better-sqlite3` bringt fertige N-API-Binärdateien mit (`prebuilds/`: darwin-arm64/x64,
  linux-arm64/x64, linuxmusl-arm64/x64, win32); es gibt kein Build-Skript, das `allowBuilds` in
  `pnpm-workspace.yaml` freigeben müsste. Probe mit `SqliteClient.layer` (in-memory und Datei):
  Tabelle anlegen, einfügen, `UPDATE … WHERE id = ? AND v = ? RETURNING v` liefert beim ersten
  Mal `[{"v":2}]`, mit der veralteten Version `[]`, SQLite 3.54.1. Das ist der Baustein für die
  Versionsprüfung. Gemessen nur mit Node **26.13.1** (auf dieser Maschine ist kein Node 22
  installiert); `.nvmrc` sagt 22. N-API ist über Node-Versionen stabil, Node 22 prüft CI.
- Peer-Abweichung: `@effect/sql-sqlite-node` 0.54.1 verlangt `@effect/platform ^0.97.3` und
  `@effect/sql ^0.52.2`, installiert sind 0.97.2 und 0.52.1. Die Probe lief trotzdem. Ein Anheben
  wäre eine Änderung am Lockfile (geschützter Satz), siehe „Bekannte Grenzen“.
- **Node kann die Quellen nicht direkt ausführen:** `node -e 'import("./src/schema/index.ts")'`
  scheitert mit `ERR_MODULE_NOT_FOUND` (die Importe nennen `./schema.js`, Node sucht keine
  `.ts`-Datei dazu). Ein Übersetzungsschritt ist nötig. Probe: eine eigene tsconfig, die
  `tsconfig.json` erweitert und nur `noEmit: false` und `outDir` setzt, übersetzt `src/schema`
  und `src/catalog` fehlerfrei, und `node` lädt das Ergebnis (`CATALOG` vorhanden). `tsconfig.json`
  selbst bleibt unberührt.
- In `@effect/platform` 0.97.2 gibt es `HttpApi`, `HttpApiBuilder`, `HttpApiEndpoint`,
  `HttpApiGroup`, `HttpApiSchema`, `HttpApiError`, `HttpApiClient`; in `@effect/sql-sqlite-node`
  `SqliteClient` und `SqliteMigrator`.
- **Das KONZEPT nennt paperless-mcp als Muster für den Server; das trägt nur halb.** paperless-mcp
  benutzt `@effect/platform` ausschließlich als **HTTP-Client** (`src/paperless/client.ts:2-6`,
  `src/index.ts:2` `NodeHttpClient`), keinen `HttpApi`-Server und kein SQL. Übertragbar sind die
  getaggten Fehler und der Layer-Aufbau, nicht die Server-Seite.

## User Story

Als Bahnbauer, der mit seiner Familie auf Laptop, Tablet und Handy Carrera-GO!!!-Strecken plant,
möchte ich, dass unsere gespeicherten Strecken und unser Teilebestand an **einer** Stelle im
Heimnetz liegen und auf jedem Gerät gleich aussehen — und wenn zwei von uns dieselbe Strecke
geändert haben, will ich das gesagt bekommen, statt dass eine Fassung still verschwindet.

## Begriffe und Konventionen

Konvention zur Prüfbarkeit, keine Domänenwahrheit. Alles aus M1, M2, M3a gilt weiter, soweit
„Verhältnis zu M2 und M3a“ nichts anderes sagt.

- **Server:** ein Node-Prozess aus `src/server`, der die API unter `/api/…` und die gebauten
  Frontend-Dateien auf **einem** Port ausliefert (Frage 7).
- **Layoutname:** Zeichenkette ohne Leerraum am Rand, nicht leer, höchstens 200 Zeichen (Länge der
  JavaScript-Zeichenkette). Jedes andere Zeichen ist erlaubt, auch `/`, `:`, `%` und Umlaute. Der
  Name ist die Identität eines Layouts auf dem Server (wie der Schlüssel in M2); Umbenennen gibt
  es nicht.
- **Version:** ganze Zahl. Ein Layout entsteht mit Version 1, jede gelungene Änderung erhöht um
  genau 1. Der Bestand hat Version 0, solange er nie gespeichert wurde.
- **Erwartete Version:** die Version, die der Client zuletzt gesehen hat und mit jeder Änderung
  mitschickt. 0 heißt „ich lege neu an“.
- **Stand:** Name (bei Layouts), Version, Änderungszeit (`updatedAt`, ISO 8601 UTC mit
  Millisekunden, vom Server gesetzt) und Inhalt.
- **Konflikt:** erwartete Version ≠ Version auf dem Server (einschließlich: neu anlegen, obwohl es
  den Namen gibt; ändern oder löschen, obwohl es ihn nicht mehr gibt).
- **Basis:** Name und Version des Layouts, aus dem die aktuelle Strecke im Browser geladen oder
  unter dem sie zuletzt gespeichert wurde (Teil B).
- **Server nicht erreichbar:** Netzfehler, keine Antwort binnen 5 s oder eine Antwort mit Status
  ≥ 500, deren Körper kein Fehler der API ist (Teil B).

## Aufteilung

| Schicht | Inhalt | Ort | Nachweis |
|---|---|---|---|
| Datenvertrag | Layoutname, Stände, Anfragen, Fehler (`api.ts`); `HttpApi`-Definition (`http-api.ts`) | `src/schema` | Tests von spec-to-tests, Ratchet |
| Server | Endpunkte, SQLite, Migrationen, Start, statische Dateien | `src/server` | HTTP-Tests gegen echtes SQLite (spec-to-tests), Mutationsproben (REQ-SARCH-2) |
| Abgleich | Server-Port, Basis, Konfliktentscheidung, Bestand-Abgleich, Cache, Übernahme | `src/web/editor` | Unit- und Eigenschaftstests mit Attrappe des Ports, Ratchet (Teil B) |
| Darstellung | Dialoge, Konflikthinweis, Server-Status | `src/web/ui` | Browser-Smoke (Teil B) |

## API M3b

Maßgeblich für REQ-API-5 bis -17. Alle Körper sind JSON (`Content-Type: application/json`); `{name}`
steht prozentkodiert im Pfad (`encodeURIComponent`). Fehlerkörper tragen `_tag`.

| Methode und Pfad | Anfrage | Erfolg | Fehler |
|---|---|---|---|
| `GET /api/status` | – | 200 `{ "status": "ok" }` | – |
| `GET /api/layouts` | – | 200 Liste aus `{ name, version, updatedAt }`, bei defektem Eintrag zusätzlich `defekt` (Grund) | – |
| `GET /api/layouts/{name}` | – | 200 Stand `{ name, version, updatedAt, layout }` | 404 `NichtGefunden`, 500 `GespeichertUngueltig` |
| `PUT /api/layouts/{name}` | `{ expectedVersion, layout }` | 201 (neu) oder 200 (geändert), Körper `{ name, version, updatedAt }` | 400 `UngueltigeAnfrage`, 409 `VersionKonflikt`, 413 `ZuGross`, 415 |
| `DELETE /api/layouts/{name}?version=n` | – | 204 | 400, 404 `NichtGefunden`, 409 `VersionKonflikt` |
| `GET /api/bestand` | – | 200 `{ version, updatedAt, inventory }` | 500 `GespeichertUngueltig` |
| `PUT /api/bestand` | `{ expectedVersion, inventory }` | 200 `{ version, updatedAt }` | 400, 409 `VersionKonflikt`, 413, 415 |

`layout` ist genau ein mit `LayoutSchema` kodiertes Layout, `inventory` genau ein mit
`InventorySchema` kodierter Bestand (beide unverändert aus M1/M3a). `VersionKonflikt` trägt
`expectedVersion` und `aktuell`: den vollständigen Stand auf dem Server oder `null`, wenn es das
Layout nicht (mehr) gibt (Frage 5).

## Akzeptanzkriterien — Teil A: Server

### Datenvertrag (`src/schema`)

- **REQ-API-1** [Contract] `src/schema` exportiert ein Schema für den Layoutnamen nach
  „Begriffe“. Abgewiesen werden: leer, nur Leerraum, Leerraum am Anfang oder Ende, mehr als 200
  Zeichen, kein String. Angenommen werden u. a. `Oval`, `Acht / groß`, `a:b`, `100%`, ein Name
  mit genau 200 Zeichen.
- **REQ-API-2** [Contract] `src/schema` exportiert Schemas für Layout-Übersicht
  (`name`, `version` ≥ 1, `updatedAt`), Layout-Stand (dazu `layout` nach `LayoutSchema`),
  Bestands-Stand (`version` ≥ 0, `updatedAt` als Zeichenkette oder `null`, `inventory` nach
  `InventorySchema`) und die Anfragen `{ expectedVersion, layout }` und
  `{ expectedVersion, inventory }` (`expectedVersion` ganze Zahl ≥ 0). `updatedAt` ist ISO 8601 in
  UTC mit Millisekunden und `Z`. Unbekannte Zusatzfelder, negative oder gebrochene Versionen,
  Versionen als Text und ein fehlendes Feld werden abgewiesen; Kodieren und Dekodieren eines
  gültigen Werts ergibt denselben Wert (Eigenschaft). `LayoutSchema` und `InventorySchema` ändern
  sich nicht; die M1- und M3a-Tests in `src/schema` laufen unverändert grün.
- **REQ-API-3** [Contract] `src/schema` exportiert die Fehlerformen `UngueltigeAnfrage`
  (`reason`), `NichtGefunden` (`name`), `VersionKonflikt` (`expectedVersion`, `aktuell`: Layout-
  bzw. Bestands-Stand oder `null`), `GespeichertUngueltig` (`ziel`: Layoutname oder `"bestand"`,
  `version`, `reason`), `ZuGross` und `ServerFehler` (`text`), jede mit `_tag`. Zusatzfelder werden
  abgewiesen.
- **REQ-API-4** [Architektur] Die `HttpApi`-Definition (Gruppen, Endpunkte, Pfade, Statuscodes,
  Schemas der Tabelle „API M3b“) liegt in `src/schema/http-api.ts` und wird **nicht** über
  `src/schema/index.ts` exportiert; die Datenschemas aus REQ-API-1 bis -3 schon (Frage 9). Grund:
  das Frontend nutzt Effect nur als Schema (KONZEPT „Architektur“). Wirkungsnachweis: Ein
  Vitest-Lauf, in dem `@effect/platform` durch einen Stub ersetzt ist, der beim Laden wirft, lädt
  `src/schema/index.ts` und dekodiert einen Layout-Stand (Muster wie REQ-WARCH-1); derselbe Lauf
  mit `src/schema/http-api.ts` scheitert.

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
  sich die Datenbank (Frage 5).
- **REQ-API-11** [When] `GET /api/bestand` liefert 200 mit dem Bestands-Stand. Wurde nie ein
  Bestand gespeichert: `{ "version": 0, "updatedAt": null, "inventory": { "schemaVersion": 1,
  "counts": {} } }` (Frage 6: ein Bestand für den Haushalt).
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
  `Origin: http://fremd.example` und `Access-Control-Request-Method: PUT` bekommt keine
  `Access-Control-Allow-Origin`-Kopfzeile. Zusammen mit REQ-API-13 (`PUT` nur mit JSON) kann eine
  fremde Webseite im Browser eines Heimnetz-Geräts damit nichts schreiben (Frage 11).

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
  nie eine neue leere Datenbank über eine vorhandene Datei.
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

- **REQ-SRV-1** [Where] Der Server startet aus dem Repo ohne Änderung an `package.json`:
  `pnpm build` (Frontend nach `dist/`), `pnpm exec tsc -p tsconfig.server.json` (Server nach
  `dist-server/`, neue Datei `tsconfig.server.json`, die `tsconfig.json` erweitert), dann
  `node dist-server/server/main.js`. Einstellungen über Umgebungsvariablen mit Vorgabe:
  `CARRERA_HOST` (`0.0.0.0`), `CARRERA_PORT` (`8080`), `CARRERA_DB`
  (`data/carrera-planer.sqlite`), `CARRERA_STATIC` (`dist`). Nach dem Start steht auf der
  Standardausgabe eine Zeile mit Adresse und Datenbankpfad. Ein ungültiger Port (kein ganzzahliger
  Wert 1–65535) bricht mit Exit-Code ≠ 0 und Meldung ab. `.gitignore` bekommt `dist-server/`,
  `data/`, `*.sqlite-wal` und `*.sqlite-shm` (Frage 8).
- **REQ-SRV-2** [When] Der Server liefert unter `/` die `index.html` aus `CARRERA_STATIC` und alle
  gebauten Dateien mit passendem `Content-Type`, auf demselben Port wie die API (Frage 7). Ein
  Pfad außerhalb von `CARRERA_STATIC` ist nicht erreichbar (`/../package.json`,
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
  zeigt alle vorher bestätigten Änderungen (Grundlage für Docker in M4).
- **REQ-SRV-6** [Where] Für die Entwicklung leitet `pnpm dev` (Vite) Anfragen unter `/api` an
  `http://localhost:<CARRERA_PORT, sonst 8080>` weiter (`server.proxy` in `vite.config.ts`, nicht
  geschützt). So erreicht auch die alte Adresse `http://<Rechner>:5173`, unter der die lokalen
  Daten aus M2/M3a liegen, den Server (Frage 4).

### Architektur Teil A

- **REQ-SARCH-1** [Architektur] Teil A ändert keine Datei unter `src/core`, `src/catalog` und
  `src/web`, und `LayoutSchema`, `InventorySchema`, `CatalogEntrySchema`, `SetTemplateSchema`
  bleiben unverändert. Wirkungsnachweis: Alle Tests von M1 bis plan-beschriftung-symbole laufen
  unverändert grün; `pnpm typecheck`, `pnpm lint` und `pnpm test` sind grün.
- **REQ-SARCH-2** [Architektur] Die Server-Tests laufen über die HTTP-Schnittstelle (Handler aus
  `HttpApiBuilder` oder echter Port) gegen echtes SQLite (in-memory oder temporäre Datei), ohne
  nachgebautes SQL. `src/server` liegt nicht im Stryker-Ratchet (`stryker.config.json` bleibt
  unverändert, Frage 12); stattdessen fährt die Critic-Station mindestens diese Mutationen von Hand
  und zeigt je Mutation einen roten Test: Versionsvergleich entfernt; Version + 2 statt + 1;
  409 durch 200 ersetzt; Schema-Prüfung beim Lesen entfernt; Schema-Prüfung beim Schreiben
  entfernt; `DELETE` ohne Versionsbedingung; Trimmen des Pfadnamens eingebaut.
- **REQ-SARCH-3** [Performance] Für ein Layout mit 1000 Elementen dauern `PUT` plus `GET` über den
  HTTP-Handler gegen eine Datei-Datenbank höchstens 100 ms im Maximum über 20 Durchläufe
  (Vitest, Node 22), `PUT /api/bestand` mit allen Katalogteilen höchstens 50 ms im Maximum; der
  Test gibt Maximum und Median aus.

## Akzeptanzkriterien — Teil B: Anbindung

### Layouts über den Server (`src/web/editor`, `src/web/ui`)

- **REQ-SYNC-1** [When] Der Speichern/Laden-Dialog holt beim Öffnen `GET /api/layouts` und zeigt
  die Server-Layouts mit Name und Änderungszeit (lokale Zeit des Geräts); defekte Einträge
  (REQ-DB-4) mit Grund, ohne „Laden“, mit „Löschen“.
- **REQ-SYNC-2** [When] „Laden“ eines Server-Layouts ersetzt die Folge (ein Befehl, rückgängig
  machbar, wie REQ-STORE-3), setzt den aktuellen Namen und die Basis (Name, Version) und sichert
  die Basis unter `carrera-planer:basis` als JSON `{ "name", "version" }`; nach Neuladen der Seite
  gilt sie weiter. „Neu“ und Import löschen die Basis. Besteht das geladene Layout den
  Schema-Check im Browser nicht, gilt REQ-STORE-5 (Meldung, Folge unverändert).
- **REQ-SYNC-3** [When] „Speichern“ unter dem Namen der Basis schickt `PUT` mit der Basisversion;
  bei Erfolg wird die Basis die neue Version, und der Dialog zeigt „gespeichert (Version n)“.
- **REQ-SYNC-4** [When] „Speichern“ unter einem anderen Namen schickt `expectedVersion` 0. Gibt es
  den Namen schon (409 mit Stand), fragt der Dialog wie in M2 nach dem Überschreiben und nennt die
  Änderungszeit des Server-Stands; erst nach Bestätigung schickt er `PUT` mit dessen Version.
- **REQ-SYNC-5** [If/Then] **Konflikthinweis.** Antwortet der Server beim Speichern unter dem
  Basisnamen 409, schreibt die Seite nichts und zeigt: „„<Name>“ wurde inzwischen auf einem anderen
  Gerät geändert (Version m vom <Zeit>; du hattest Version n geladen)“ mit vier Wegen (Frage 5):
  **Unter neuem Namen speichern** (Namensfeld vorbelegt mit dem ersten freien „<Name> (2)“,
  „(3)“, …); **Server-Stand laden** (wie REQ-SYNC-2; die eigene Folge bleibt per Rückgängig
  erreichbar); **Trotzdem überschreiben** (nach zweiter Bestätigung `PUT` mit Version m);
  **Abbrechen** (nichts passiert, Basis bleibt). Ist `aktuell` `null`: „„<Name>“ wurde inzwischen
  gelöscht“ mit **Neu anlegen** (`expectedVersion` 0) und **Abbrechen**. Wirkungsnachweis: zwei
  Sitzungen über eine Attrappe des Servers; A und B laden Version 1, A speichert (→ 2), B
  speichert → Hinweis, im Server steht A's Fassung, kein Weg schreibt ohne Wahl.
- **REQ-SYNC-6** [When] „Löschen“ eines Server-Layouts fragt nach und schickt `DELETE` mit der
  zuletzt gelisteten Version; bei 409 zeigt der Dialog „inzwischen geändert“, löscht nichts und
  lädt die Liste neu.

### Bestand über den Server

- **REQ-SYNC-7** [When] Beim Start, beim Zurückkehren auf die Seite (`visibilitychange` auf
  sichtbar) und beim Öffnen des Bestandsdialogs holt die Seite `GET /api/bestand`, übernimmt den
  Bestand (Meldung für nicht zählende Teil-IDs wie REQ-BEST-7) und legt den Stand samt Abrufzeit
  unter `carrera-planer:server-bestand` ab. Löst ab: REQ-BEST-10 (Abgleich zwischen Tabs über das
  `storage`-Ereignis).
- **REQ-SYNC-8** [When] Jede wirksame Bestandsänderung (Zähler, Set-Vorlage, Leeren) zeigt die Seite
  sofort an und schickt `PUT /api/bestand` mit der zuletzt bestätigten Version. Änderungen laufen
  der Reihe nach (die nächste erst nach Antwort auf die vorige, mit deren Version), keine geht
  verloren und keine wird doppelt gezählt. Bei 409 übernimmt die Seite den Bestand aus `aktuell`
  und meldet „Der Bestand wurde auf einem anderen Gerät geändert und neu geladen; deine Änderung
  (<was>) ist nicht übernommen.“ Bei „Server nicht erreichbar“ zeigt sie wieder den zuletzt
  bestätigten Bestand und meldet das (Frage 3). Löst ab: REQ-BEST-3/-4 (Sichern unter
  `carrera-planer:bestand`). Wirkungsnachweis: Attrappe, die Antworten verzögert und Konflikte
  einstreut; nach fünf schnellen „+1“ ohne Konflikt steht im Server genau +5 und Version + 5.

### Ohne Server

- **REQ-SYNC-9** [If/Then] Ist der Server nicht erreichbar, bleibt der Editor voll bedienbar
  (Arbeitsstand lokal wie REQ-STORE-2). Eine sichtbare Anzeige „Server nicht erreichbar“ mit
  „Erneut versuchen“ bleibt stehen, bis ein Abruf gelingt. Speichern, Laden und Löschen von
  Server-Layouts werden abgewiesen mit einer Meldung, die auf Arbeitsstand und Export hinweist;
  nichts wird für später vorgemerkt. Der Bestand kommt aus `carrera-planer:server-bestand`, ist
  mit „Stand vom <Zeit>, nur lesen“ gekennzeichnet, Bestandsmodus und Einkaufsliste rechnen damit;
  Bestandsänderungen werden mit Meldung abgewiesen. Fehlt der Cache: leerer Bestand mit Meldung
  (Frage 3).
- **REQ-SYNC-10** [If/Then] Besteht eine Server-Antwort ihr Schema aus REQ-API-2/-3 nicht, gilt
  sie als Fehler: Meldung mit Grund, nichts wird übernommen oder geschrieben. 500
  `GespeichertUngueltig` beim Laden nennt Name und Grund (REQ-DB-4).
- **REQ-SYNC-11** [Contract] Lokal bleiben: Arbeitsstand (`carrera-planer:layout:`), Modus,
  Schalter „Namen“, Basis, Bestands-Cache und die Listen defekter lokaler Sicherungen aus M2/M3a.
  Ihre Änderung schickt nichts an den Server; Wirkungsnachweis: Attrappe des Ports protokolliert
  keine Anfrage bei Befehlen, Moduswechsel und Umschalten der Namen (Frage 2).

### Übernahme lokaler Daten

- **REQ-MIG-1** [When] Benannte Layouts aus M2 (`carrera-planer:layout:<Name>`, Name nicht leer)
  stehen im Dialog in einer eigenen Liste „Nur auf diesem Gerät“ mit „Laden“ (wie M2), „Löschen“
  und „Auf den Server übertragen“ (`expectedVersion` 0). Erfolg → der lokale Schlüssel wird
  entfernt. 409 mit **gleichem** Inhalt (tiefe Gleichheit der Elemente) → lokal entfernt, Meldung
  „war schon auf dem Server“. 409 mit anderem Inhalt → lokal bleibt, der Dialog bietet
  „unter anderem Namen übertragen“ (vorbelegt wie REQ-SYNC-5). Nichts wird ohne Klick übertragen
  (Frage 4).
- **REQ-MIG-2** [When] Liegt unter `carrera-planer:bestand` ein gültiger, nicht leerer lokaler
  Bestand, gilt beim Start: Server-Version 0 → Rückfrage „Lokalen Bestand auf den Server
  übernehmen?“ mit Summe der Teile; Ja → `PUT` mit 0, danach lokal entfernt. Server-Version ≥ 1 und
  gleiche Anzahlen (0 = fehlend) → lokal still entfernt. Sonst Rückfrage mit beiden Summen:
  „Server behalten“ (lokal entfernt) oder „Lokalen übernehmen“ (`PUT` mit Server-Version). Nie
  summieren. Ohne Entscheidung bleibt alles, und die Rückfrage kommt beim nächsten Start wieder.
  Ein kaputter lokaler Bestand läuft wie bisher über REQ-BEST-5 in die Defektliste.

### Darstellung und Architektur Teil B

- **REQ-SUI-1** [Where] Konflikthinweis, Übernahme-Rückfragen und Server-Anzeige sind auf Laptop,
  Tablet und Handy bedienbar wie REQ-UI-1 (kein waagerechtes Scrollen, Tippziele ≥ 44 × 44
  CSS-Pixel).
- **REQ-SUI-2** [Where] Meldungen aus REQ-SYNC-5 bis -10 und REQ-MIG-1/-2 erscheinen sichtbar und
  bleiben stehen, bis der Mensch sie schließt (wie REQ-UI-9).
- **REQ-SUI-3** [Architektur] Die Anwendung spricht zur Laufzeit nur mit ihrer eigenen Herkunft
  (Dateien und `/api/…`), keine fremden Adressen. Ändert REQ-UI-10 und REQ-BUI-6 entsprechend.
- **REQ-SARCH-4** [Architektur] Der Abgleich (Basis, Konfliktentscheidung, Bestand-Warteschlange,
  Cache, Übernahme) liegt DOM-frei in `src/web/editor` und bekommt einen Server-Port und die Uhr
  eingereicht; `fetch` steht nur in `src/web/ui/browser.ts`. Er läuft im Vitest-Lauf mit
  werfendem `preact`-Stub (wie REQ-WARCH-1) und liegt im Ratchet (`break=100`); Effect im Browser
  nur als Schema, kein `HttpApiClient` (Frage 9).

## Verhältnis zu M2 und M3a

Teil A ändert nichts an M2/M3a. Teil B löst ab: **REQ-BEST-3, -4** (Bestand sichern unter
`carrera-planer:bestand`) durch REQ-SYNC-8; **REQ-BEST-10** (Tab-Abgleich) durch REQ-SYNC-7;
**REQ-UI-10** und **REQ-BUI-6** durch REQ-SUI-3; **REQ-UI-9** wird um die Server-Liste erweitert.
REQ-STORE-1/-3/-4/-5 gelten für die Liste „Nur auf diesem Gerät“ unverändert weiter; die
Namensregel aus REQ-STORE-3 gilt für Server-Namen zusätzlich mit der Längengrenze aus REQ-API-1.
REQ-BEST-5/-6 gelten nur noch für den lokalen Altbestand (REQ-MIG-2). Betroffene Testdateien,
gemessen per Suche nach den REQ-IDs: `src/web/editor/planner-session.test.ts` (REQ-BEST-3/-4/-5/-6)
und `src/web/editor/tab-sync.test.ts` (REQ-BEST-5/-6/-10); spec-to-tests muss sie anpassen, nicht
implement.

## Empfehlungen zu den Entscheidungsfragen

1. **Teilen in A (Server) und B (Anbindung).** 48 Kriterien und fünf abgelöste in einem Lauf sind
   mehr als M3a (39); A ist allein über HTTP prüfbar und stabilisiert die API, bevor B die
   abgenommenen M2/M3a-Tests umbaut.
2. **Was liegt auf dem Server: benannte Layouts und der Bestand, sonst nichts.** Arbeitsstand,
   Modus und „Namen“ bleiben je Gerät. Grund: Der Arbeitsstand wird bei jedem Tipp gesichert; auf
   dem Server würden zwei Geräte ständig gegenseitig ihre Strecke überschreiben, und das KONZEPT
   will ausdrücklich keine Live-Mitbearbeitung. Modus und Namen sind Ansichtswahl einer Person.
3. **Server führend; ohne Server nur lesen.** Der Server ist die einzige Quelle für Layouts und
   Bestand. Fällt er aus, arbeitet der Editor lokal weiter (nichts geht verloren: Arbeitsstand und
   Export), der Bestand ist ein schreibgeschützter Cache. Keine Offline-Warteschlange: sie
   bräuchte eine Zusammenführung zweier Bestände, und genau die Frage „wer gewinnt“ soll der
   Mensch entscheiden, nicht ein Nachsende-Mechanismus. Gegenposition: Wer per VPN ohne Server
   den Bestand ändert, muss es später wiederholen. Bei einem Raspi im Heimnetz selten.
4. **Übernahme lokaler Daten: ausdrücklich, je Eintrag, nie summiert.** Lokale Layouts bleiben in
   „Nur auf diesem Gerät“ sichtbar und werden per Klick übertragen; Namensgleichheit mit anderem
   Inhalt wird nie still überschrieben, gleicher Inhalt nicht doppelt angelegt. Den Bestand nie
   addieren: es ist dieselbe Kiste, zwei Geräte hätten sonst den doppelten Bestand. **Wichtig:**
   `localStorage` hängt an der Herkunft (Schema, Rechner, Port). Die Altdaten liegen unter der
   Vite-Adresse `:5173`, nicht unter dem Server-Port `:8080`; darum der Proxy (REQ-SRV-6), über den
   die alte Adresse den Server erreicht. Auf dem Raspi (M4) gibt es keine Altdaten. Billigere
   Alternative zur Abnahme: REQ-MIG-1/-2 streichen und die vorhandenen Wege nutzen (Export →
   Import → Speichern; Bestand per drei Set-Vorlagen). Das hängt daran, wie viele echte Layouts
   heute lokal liegen; das weiß nur der Mensch.
5. **Konflikt: 409 mit vollem aktuellem Stand; vier Wege im Hinweis.** Der Stand in der Antwort
   erspart einen zweiten Abruf und erlaubt „gleicher Inhalt“-Erkennung. Kein Weg schreibt ohne
   Wahl, „Server-Stand laden“ ist rückgängig machbar (Laden ist ein Befehl), „Trotzdem
   überschreiben“ braucht eine zweite Bestätigung. Auch `DELETE` prüft die Version: sonst löscht
   ein veraltetes Gerät still die neue Fassung des anderen.
6. **Ein Bestand für den Haushalt**, mit Version wie die Layouts. KONZEPT: „unsere Bahn“, eine
   Kiste. Ohne Version würde der letzte Schreiber gewinnen, und genau das schließt das KONZEPT
   aus. Bei Konflikt wird neu geladen und die eigene Änderung **nicht** automatisch erneut
   angewandt (Gegenvorschlag zur Abnahme: Zähler-Änderungen als „+1“ automatisch nachspielen;
   bequemer, aber dann wirkt eine Änderung auf einen Stand, den der Mensch nie gesehen hat).
7. **Ein Port für Frontend und API.** Gleiche Herkunft: keine CORS-Konfiguration, ein
   Docker-Port in M4, `localStorage` an einer Adresse. Für die Entwicklung leitet Vite `/api`
   weiter.
8. **Server ohne neues Paket starten:** Übersetzen mit `tsc` über eine eigene
   `tsconfig.server.json` (gemessen: läuft), keine `package.json`-Skripte. Skripte wie
   `pnpm start` wären bequemer, sind aber ein Admin-PR am geschützten Satz; optional nachziehen.
   `tsx` o. ä. wäre eine neue Abhängigkeit.
9. **`HttpApi`-Definition in `src/schema`, aber nicht im Barrel; im Browser `fetch` plus
   Datenschemas.** Die Constitution will die API im Datenvertrag; das KONZEPT will Effect im
   Frontend nur als Schema. `HttpApiClient` würde die Effect-Laufzeit samt `@effect/platform` in den
   Browser holen. Preis: Pfade stehen im Client noch einmal; den Abgleich sichern die
   HTTP-Tests von Teil A und der Smoke.
10. **Fehler laut statt still, getrennt nach Ort.** Kaputte Datei → Server startet nicht (keine
    neue leere Datenbank über alten Daten). Kaputte Zeile → 500 mit Grund, Zeile bleibt,
    Reparatur per `PUT`/`DELETE`. Ungültige Anfrage → 400 mit Schema-Text. Server weg → sichtbare
    Anzeige, kein stilles Weiterarbeiten auf scheinbar gespeicherten Daten.
11. **Kein Login, aber keine CORS-Freigabe.** Kein Login laut Constitution. Ohne
    `Access-Control-Allow-*` und mit JSON-Pflicht für `PUT` blockiert der Browser schreibende
    Anfragen fremder Webseiten (Preflight). Gegen DNS-Rebinding schützt das nicht (bekannte
    Grenze).
12. **Mutationen am Server von Hand statt Ratchet.** `src/server` in `stryker.config.json`
    aufzunehmen wäre ein Admin-PR; Stryker mit SQLite und HTTP ist zudem langsam. Die feste Liste
    in REQ-SARCH-2 macht die Probe prüfbar. Gegenposition: ohne Ratchet überlebt ein später
    eingeschleppter Mutant unbemerkt.

## Nicht-Ziele (M3b)

- Deploy auf den Raspi, Dockerfile, Datensicherung der Datenbankdatei (M4).
- Live-Mitbearbeitung, Benachrichtigung über fremde Änderungen, Polling (KONZEPT).
- Login, Benutzer, Rechte, HTTPS (Constitution; Heimnetz und VPN).
- Umbenennen von Layouts, Verlauf alter Versionen, Papierkorb.
- Offline-Warteschlange und Zusammenführen von Änderungen (Frage 3).
- Server-seitige Prüfung gegen den Katalog (unbekannte Teile, Geschlossenheit): der Server prüft
  nur das Schema; Kern und Katalog bleiben im Browser.
- Änderungen an `src/core`, `src/catalog`, `LayoutSchema`, `InventorySchema`.

## Bekannte Grenzen

- **Peer-Versionen.** `@effect/sql-sqlite-node` 0.54.1 verlangt `@effect/platform ^0.97.3` und
  `@effect/sql ^0.52.2`, installiert sind 0.97.2 und 0.52.1. Die Probe lief; ein Anheben ist ein
  Admin-PR am Lockfile.
- **Node 22 nicht lokal gemessen.** Die SQLite-Probe lief mit Node 26.13.1; CI läuft mit dem
  gepinnten Node 22.
- **Herkunft.** Layouts und Bestand im `localStorage` einer anderen Adresse (anderer Rechnername,
  IP statt Name, anderer Port) sieht die Übernahme nicht; sie müssen unter genau der alten Adresse
  übertragen werden.
- **DNS-Rebinding.** Eine fremde Seite, die einen eigenen Namen auf die Raspi-Adresse umbiegt,
  kann gleiche Herkunft vortäuschen. Im Heimnetz ohne Login hingenommen; eine Prüfung der
  `Host`-Kopfzeile wäre der spätere Riegel.
- **Gleicher Inhalt, anderer Name** wird nicht als Dublette erkannt (der Name ist die Identität).
- **Basis nach Import:** Import löscht die Basis; wer eine exportierte Datei wieder importiert und
  unter dem alten Namen speichert, geht über „existiert, überschreiben?“, nicht über den
  Konflikthinweis.
- **Zeitstempel kommen von der Server-Uhr.** Geht sie falsch, sind die Zeiten im Hinweis falsch;
  die Versionsprüfung hängt nicht daran.
- **Abgelaufener Cache:** Im Nur-lesen-Bestand kann der Bestandsmodus Teile zeigen, die
  inzwischen auf einem anderen Gerät ausgebucht wurden; die Kennzeichnung „Stand vom …“ sagt das.

## Zur Abnahme

Der Mensch entscheidet (Empfehlung jeweils in Klammern):

1. Teilung in Teil A (Server, T3) und Teil B (Anbindung, T1) als zwei Läufe? (ja)
2. Auf dem Server nur benannte Layouts und Bestand; Arbeitsstand, Modus, „Namen“ lokal? (ja)
3. Ohne Server: Editor lokal weiter, Bestand nur lesen, keine Warteschlange? (ja)
4. Übernahme lokaler Daten per Klick (REQ-MIG-1/-2) — oder streichen, weil kaum echte lokale
   Layouts existieren? (übernehmen, wenn es echte Layouts gibt; sonst streichen). **Frage an
   dich: Liegen heute echte Strecken lokal, und unter welcher Adresse?**
5. Konflikthinweis mit vier Wegen, `DELETE` mit Versionsprüfung? (ja)
6. Bestand: bei Konflikt neu laden ohne automatisches Nachspielen? (ja)
7. Ein Port, Vorgabe `8080`, Datenbank unter `data/carrera-planer.sqlite`? (ja; Port nach Wunsch)
8. Start per `tsc -p tsconfig.server.json` ohne `package.json`-Skripte, oder Admin-PR mit
   `start`-Skript? (ohne; Skript optional)
9. `HttpApi`-Definition in `src/schema/http-api.ts` außerhalb des Barrels, Browser mit `fetch`?
   (ja)
10. Längengrenze 200 Zeichen für Layoutnamen? (ja; M2 hatte keine — ein längerer lokaler Name
    müsste bei der Übernahme umbenannt werden)
11. `src/server` nicht in den Ratchet, feste Mutationsliste für die Critic-Station? (ja; sonst
    Admin-PR an `stryker.config.json`)
12. KONZEPT nachziehen: „Muster wie in paperless-mcp“ trifft nur den Client-Teil; Satz
    präzisieren (eigener kleiner PR)? (ja)
13. Teil B löst REQ-BEST-3/-4/-10, REQ-UI-10 und REQ-BUI-6 ab; Anpassung der Tests in
    `planner-session.test.ts` und `tab-sync.test.ts` durch spec-to-tests? (ja)

## Smoke

**Aufrufer des geänderten Pfads.** Nachgesehen am Basisstand `9ffe100`:

- `src/server/index.ts:1-2` ist ein Platzhalter (`export {};`). Heute ruft **niemand** den Server:
  keine Oberfläche, kein MCP, kein anderer Dienst. Nach Teil A rufen ihn nur HTTP-Clients (im Smoke
  `curl`); nach Teil B die Browser-Oberfläche.
- Der Browser speichert heute alles über `localStorage`: `mount` in `src/web/ui/app.tsx:559-564`
  baut die Sitzung mit `browserStorage()` (`src/web/ui/browser.ts:13`). Benannte Layouts über
  `session.saveAs` (`src/web/ui/dialog.tsx:41`, `:46`), `session.load` (`:102`),
  `session.deleteSaved` (`:118`); Schlüssel in `src/web/editor/session.ts:39-45`. Bestand über
  `session.addSet` / `decrement` / `setCount` / `increment` / `clearInventory`
  (`src/web/ui/inventory-dialog.tsx:122`, `:151`, `:162`, `:170`, `:186`); Schlüssel in
  `src/web/editor/planner-session.ts:32-46`. Tab-Abgleich: `src/web/ui/app.tsx:229-236`
  (`onLocalStorageChange` → `session.storageChanged`). Diese Stellen ändert Teil B.

Start für die Abnahme (Teil A und B):

```
pnpm build
pnpm exec tsc -p tsconfig.server.json
CARRERA_DB=/tmp/carrera-smoke.sqlite node dist-server/server/main.js
```

Für Teil B zusätzlich auf einem zweiten Gerät die Adresse `http://<Rechner>:8080` im Heimnetz;
für die Übernahme `pnpm dev --host` (Proxy, REQ-SRV-6) und die alte Adresse `:5173`.

### Teil A (per `curl`, `B=http://localhost:8080`)

1. **Start.** Neue Datei: Ausgabe nennt Pfad und „neu angelegt“, `curl $B/api/status` →
   `{"status":"ok"}`, `curl $B/api/layouts` → `[]`, `curl $B/api/bestand` → Version 0, leer.
2. **Anlegen, ändern, Konflikt.** `PUT $B/api/layouts/Oval` mit `expectedVersion` 0 und dem Oval
   (REQ-CORE-13 (c)) → 201, Version 1. Noch einmal mit 0 → 409, `aktuell.version` 1. Mit 1 → 200,
   Version 2. Mit 1 → 409, Datei unverändert (`GET` zeigt Version 2).
3. **Name mit Sonderzeichen.** `Acht / groß` kodiert anlegen → in der Liste genau so, `GET`
   liefert ihn; `%20Oval` → 400.
4. **Löschen.** `DELETE …/Oval?version=1` → 409; `?version=2` → 204; `GET` → 404.
5. **Bestand.** `PUT $B/api/bestand` mit 0 und `{"kurve-1-90":8,"gibt-es-nicht":3}` → 200,
   Version 1; `GET` liefert beide Einträge. Mit 0 erneut → 409.
6. **Neustart.** Server mit Strg+C beenden (Exit 0), neu starten → dieselben Layouts, Versionen
   und derselbe Bestand.
7. **Frontend.** Im Browser `http://localhost:8080/` → der Planer erscheint wie mit `pnpm dev`.

Gegenfälle, die geschlossen bleiben müssen:

8. Ungültig: Körper `kaputt`, `schemaVersion` 2, Zusatzfeld, doppelte Element-ID,
   `expectedVersion` −1, `Content-Type: text/plain`, 2 MB Körper → 400/415/413, `GET` danach
   unverändert.
9. `curl -i -X OPTIONS -H 'Origin: http://fremd.example' -H 'Access-Control-Request-Method: PUT'
   $B/api/bestand` → keine `Access-Control-Allow-Origin`-Kopfzeile.
10. `curl --path-as-is $B/../package.json` und `$B/%2e%2e/package.json` → 404.
11. Kaputte Datei: Server stoppen, `printf kaputt > /tmp/kaputt.sqlite`, mit
    `CARRERA_DB=/tmp/kaputt.sqlite` starten → Exit ≠ 0, Meldung mit Pfad;
    `cat /tmp/kaputt.sqlite` → weiterhin `kaputt`.
12. Kaputte Zeile: bei gestopptem Server den Inhalt von `Oval` per `sqlite3` auf `{"x":1}`
    setzen, starten → `GET …/Oval` 500 `GespeichertUngueltig` mit Grund, Liste zeigt `defekt`;
    `PUT` mit der Version aus der Antwort repariert.
13. `$B/api/gibtsnicht` → 404 als JSON, nicht die Startseite.

### Teil B (Browser, zwei Geräte)

14. **Geräteübergreifend.** Laptop: Oval bauen, als „Oval“ speichern. Handy: Dialog öffnen →
    „Oval“ mit Zeit; laden → dieselbe Strecke. Bestand am Laptop „Mach 8“ hinzufügen; Handy:
    Seite wieder in den Vordergrund holen → 27 Teile, ohne Neuladen.
15. **Konflikt.** Beide laden „Oval“. Laptop: ein Teil anhängen, speichern (Version 2). Handy:
    anderes Teil anhängen, speichern → Hinweis mit Version 2 und Zeit, vier Wege. Je Weg
    nachprüfen: „Unter neuem Namen“ legt „Oval (2)“ an; „Server-Stand laden“ zeigt die
    Laptop-Strecke, Rückgängig holt die eigene zurück; „Trotzdem überschreiben“ fragt ein zweites
    Mal; „Abbrechen“ ändert nichts.
16. **Bestand gleichzeitig.** Beide öffnen den Bestandsdialog. Laptop: Gerade 342 „+“. Handy ohne
    Neuladen: Kurve 1/90° „+“ → Meldung „auf anderem Gerät geändert“, Zahlen des Laptops sichtbar,
    die Kurve **nicht** erhöht.
17. **Server weg.** Server stoppen. Laptop: Anzeige „Server nicht erreichbar“; Teile anhängen geht;
    Speichern → Meldung mit Hinweis auf Export; Bestand mit „Stand vom …, nur lesen“, „+“ wird
    abgewiesen; Bestandsmodus rechnet weiter. Server starten, „Erneut versuchen“ → Anzeige weg.
18. **Übernahme** (über `pnpm dev --host`, alte Adresse `:5173`, mit lokalen Altdaten): Liste
    „Nur auf diesem Gerät“ zeigt die alten Layouts; eins übertragen → erscheint in der
    Server-Liste, lokal weg. Gleichnamig mit anderem Inhalt → bleibt lokal, Angebot „unter anderem
    Namen“. Lokaler Bestand bei leerem Server → Rückfrage, nach „Ja“ auf dem Server; bei
    abweichendem Server-Bestand → Auswahl, **keine** Summe.
19. Netzwerk-Reiter: nur Anfragen an die eigene Adresse (REQ-SUI-3); Moduswechsel und „Namen“
    lösen keine Anfrage aus.
20. Handy hochkant 360 × 740: Konflikthinweis und Rückfragen ohne waagerechtes Scrollen, Knöpfe
    ≥ 44 × 44.

### Nach dem Deploy

M3b wird nicht ausgeliefert (Deploy ist M4). Erst dort nachweisbar:

- Der Server läuft auf dem Raspi (linux-arm64, Prebuild von `better-sqlite3`) mit Node 22 im
  Container; Datei auf einem Volume übersteht einen Neustart des Containers (`SIGTERM`,
  REQ-SRV-5).
- Zugriff per VPN von unterwegs: Laden, Speichern und der Konflikthinweis über eine langsame
  Leitung (5-s-Grenze aus „Server nicht erreichbar“ passt oder nicht).
- Die echten Geräte der Familie (Laptop, Tablet, Handy) sehen dieselben Layouts und denselben
  Bestand; die Altdaten der Dev-Adresse sind übertragen oder bewusst verworfen.
