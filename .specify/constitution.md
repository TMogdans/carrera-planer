# carrera-planer Constitution

> Invariante Regeln, abgeleitet aus [KONZEPT.md](../KONZEPT.md). Änderungen nur mit
> CODEOWNERS-Approval. Widerspricht diese Datei dem Konzept, gilt das Konzept.

## Geometrie
- Richtungen sind Vielfache von 45°. Koordinaten werden **exakt** als ganze Zahlen dargestellt
  (`a + b·√2`, fester Nenner in Einheiten von 57 mm). Keine Gleitkomma-Geometrie im Kern.
- „Geschlossen" ist ein **exakter Vergleich** (Endpunkt = Startpunkt, Endrichtung = Startrichtung).
  Es gibt **keine Toleranz** und keinen Epsilon-Vergleich.
- Geschlossen ist nicht gleich baubar: Überschneidung und Lücke werden getrennt gemeldet.
- Teile mit unbekannten Maßen sind im Katalog als „Maße fehlen" gekennzeichnet und nicht
  verwendbar. Maße werden nicht geschätzt.

## Architektur
- Der Geometriekern (`src/core`) ist reines TypeScript: **kein I/O, keine UI, keine
  Effect-Laufzeit**. Effect darf nur im Schema, im Server und an den Rändern vorkommen.
- Der Datenvertrag (`src/schema`, Effect Schema) ist die einzige Quelle für Katalog, Layout,
  Bestand und API. Alte Layouts scheitern laut, nicht still.
- Jeder Katalogwert trägt Quelle und Sicherheit.
- Effect-Zielversion: `effect@3.x` (exakte Version aus `pnpm-lock.yaml`). Keine v4-APIs.

## Verifikation
- Der Kern wird mit Eigenschaftstests (fast-check) geprüft; Generatoren leiten sich aus dem
  Schema ab.
- Der Mutations-Ratchet (`break=100`) gilt für `src/core`, `src/catalog`, `src/schema`: Jeder
  überlebende Mutant lässt CI scheitern. Mutanten werden getötet, nie ausgeblendet.
- CI-Konfiguration, Schwellen und diese Datei sind geschützt (CODEOWNERS). Tests in
  `src/{core,catalog,schema,server}` schreibt nur die devloop-Station spec-to-tests
  (`.devloop/managed-tests.json`); implement ändert sie nicht. Kein
  `.skip`/`.only`/`.todo` außer dem REQ-getaggten devloop-Platzhalter.
- Jedes EARS-Kriterium trägt eine ID `REQ-<CTX>-<nr>` und wird von mindestens einem Test
  referenziert.
- Das Risiko-Tier folgt deterministisch aus den berührten Pfaden (`.devloop/tier-map.json`),
  nie aus einer Selbsteinschätzung.

## Sicherheit
- Kein Login, nur Heimnetz und VPN (Konzept). Der Agent hält keine Secrets und merged nicht selbst.
