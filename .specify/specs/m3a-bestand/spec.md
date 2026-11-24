# Spec: M3a — Bestand, Bestandsmodus, Einkaufsliste, Prägung (im Browser, ohne Server)

Status: Entwurf, wartet auf Spec-Review (harter Stopp). Die offenen Fragen am Ende sind vor der
Abnahme zu beantworten; die Kriterien verweisen mit „(Frage n)“ auf sie und sind nach den
Empfehlungen formuliert.
Grundlage: [KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23; Abschnitte „Modi“,
„Geometrie“ → „Baugruppen“, „Architektur“, „Meilensteine“, „Offen“),
[docs/recherche.md](../../../docs/recherche.md) (Tabelle „Bestand“),
[docs/carrera-go-katalog.md](../../../docs/carrera-go-katalog.md) (Set-Artikelnummern),
[constitution.md](../../constitution.md), die umgesetzten Specs [M1](../m1-rechenkern/spec.md)
und [M2](../m2-editor/spec.md) und Issue #28 (Prägung). Basisstand: `origin/main` = `5317c77`.

**Schnitt (vom Menschen vorgegeben).** KONZEPT-M3 („Backend, Bestand, Bestandsmodus,
Einkaufsliste“) wird geteilt: **M3a** ist alles im Browser ohne Server, **M3b** bringt Backend,
SQLite und geräteübergreifende Speicherung. Die Meilenstein-Tabelle im KONZEPT kennt diese
Teilung noch nicht (Frage 15).

**Tier: T3** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` gegen
`.devloop/tier-map.json` aus den geplanten Pfaden `.specify/specs/m3a-bestand/spec.md`,
`src/schema/schema.ts` (+ Test), `src/catalog/catalog.ts`, `src/catalog/sets.ts` (+ Test),
`src/web/editor/*` (Logik + Tests) und `src/web/ui/*` → `{"tier":"T3"}`. T3 kommt allein aus
`src/schema/**`: Bestands- und Set-Vorlagen-Schema sowie das Prägungsfeld gehören laut
Constitution in den Datenvertrag. Gegenproben: ohne `src/schema` (nur Katalog + Web) → T2; nur
`src/web/**` → T1. Das autoritative Tier rechnet CI aus dem tatsächlichen Diff.
Folge: `.devloop/config.json` schaltet die Smoke-Station nur für T1 ein; der Abschnitt „Smoke“
ist hier deshalb die Abnahmeliste für den Menschen, nicht für eine automatische Station.

**Voraussetzung (Admin-PR am geschützten Satz, kein Agent dieser Kette fasst die Dateien an):**
Die Vertragstypen und Testhilfen der Editor-Logik liegen in `src/web/test-support/**`, das im
geschützten Satz steht (`.devloop/protected-globs.json`). Braucht spec-to-tests dort neue Typen
oder Fixtures für Bestand und Einkaufsliste, ist deren Merge eine Änderung am geschützten Satz und
geht nur per Admin-Override (Frage 14). `stryker.config.json` muss nicht geändert werden: der
Ratchet erfasst `src/web/editor`, `src/catalog` und `src/schema` schon.

## User Story

Als Bahnbauer, der mit seiner Familie Carrera-GO!!!-Strecken plant, möchte ich im Browser
festhalten, welche Teile wir besitzen, Strecken wahlweise nur aus diesen Teilen bauen und für einen
freien Entwurf sehen, welche Teile mir fehlen und unter welcher Nummer ich sie finde — damit ich
weiß, ob eine geplante Strecke mit unserer Kiste baubar ist, und gezielt nachkaufen kann.

## Begriffe und Konventionen

Konvention zur Prüfbarkeit, keine Domänenwahrheit. Alles aus M1 und M2 (Layout, Element-ID,
platzierbar, Befehl, wirksam, Verlauf, Arbeitsstand, Leisten-Einteilung REQ-EDIT-21) gilt weiter.

- **Bestandsfähig:** Katalogeintrag, dessen Geometrie keine `baugruppe` ist. Das sind heute alle
  Einträge außer Looping (Baugruppe) und Steilkehre (Baugruppe), also auch nicht platzierbare
  wie Steilkurve 1/45°, Wireless-Anschluss, Looping-Teil (L) und Steilkehre-Teil (K). Aus dem
  Katalog abgeleitet, kein neues Feld. Grund: Baugruppen verbrauchen laut KONZEPT „alle ihre
  Teile“; gezählt wird je physischem Teil.
- **Bestand:** Abbildung Teil-ID → Anzahl (ganze Zahl ≥ 0). Eine fehlende Teil-ID heißt Anzahl 0.
- **Verbrauch(p):** Anzahl von Teil p laut `consumption` des Kerns für die Elementfolge
  (Baugruppen aufgelöst, Querungen verbrauchen nichts). Meldet der Kern „Teil unbekannt“, ist der
  Verbrauch **nicht bestimmbar**.
- **Rest(p)** = Bestand(p) − Verbrauch(p); darf negativ sein.
- **Fehlmenge(p)** = max(0, Verbrauch(p) − Bestand(p)).
- **Überzogen:** mindestens ein Teil hat Fehlmenge ≥ 1.
- **Modus:** „Sandbox“ oder „Bestand“. Der Modus gehört weder zum Layout noch zum Verlauf
  (KONZEPT: „Ein Layout wird nicht an einen Modus gebunden“).
- **Set-Vorlage:** benannte Packung mit fester Teileliste, deren Inhalt auf den Bestand addiert
  wird (KONZEPT „Bestand pflegen“).
- **Prägung:** auf dem Teil eingeprägte Form- oder Teilenummer (z. B. `141903-1B`), keine
  Carrera-Artikelnummer (Issue #28).
- **Suchbegriff:** was die Einkaufsliste je Zeile zum Finden des Teils anbietet (Artikelnummer,
  Prägung oder Bezugshinweis).

## Aufteilung: Logik und Darstellung

Wie in M2 (Entscheidung 5 dort): Alles Zählbare steht in der DOM-freien Logik und wird mit
Unit-, Eigenschafts- und Mutationstests geprüft; die Oberfläche wird per Browser-Smoke abgenommen.

| Schicht | Inhalt | Ort | Nachweis |
|---|---|---|---|
| Datenvertrag | `InventorySchema`, `SetTemplateSchema`, Feld `praegung` am `CatalogEntrySchema` | `src/schema` | Tests von spec-to-tests, Ratchet |
| Daten | Prägungen im Katalog, Set-Vorlagen | `src/catalog` | Tests von spec-to-tests, Ratchet |
| Logik | Bestand ändern/speichern/laden, Set addieren, Modus, Bestandsprüfung der Befehle, Leiste mit Restzähler, Einkaufsliste | `src/web/editor` | Unit- und Eigenschaftstests (Node, ohne DOM), Ratchet |
| Darstellung | Bestandsdialog, Modus-Schalter, Restzähler in der Leiste, Einkaufsliste, Meldungen | `src/web/ui` | Browser-Smoke |

## Set-Vorlagen M3a

Maßgeblich für REQ-SET-2. Inhalte aus `docs/recherche.md` („Bestand“) und
`docs/carrera-go-katalog.md`; Stützen und Regler sind keine Katalogteile und fehlen deshalb.

| Vorlage | Art.-Nr. | Inhalt (Teil-ID × Anzahl) | Summe | Sicherheit | Quelle |
|---|---|---|---|---|---|
| Mach 8 | 20062492 | gerade-342 × 4, gerade-114 × 1, kurve-1-90 × 6, engstelle × 1, kreuzung × 1, anschlussstueck × 1, rundenzaehler × 1, looping-teil × 8, steilkehre-teil × 4 | 27 | hoch | Zeichnung der Anleitung, am Karton bestätigt 2026-11-23 |
| Ausbauset 1 | 20061600 | kurve-1-90 × 2, spurwechsel-gerade × 2, gerade-342 × 2 | 6 | niedrig | Händlerangabe; welcher Spurwechsel, ungeprüft (#2, Frage 2) |
| Ausbauset 3 | 20061614 | gerade-342 × 8, kurve-1-45 × 4, steilkurve-1-45 × 4 | 16 | mittel | CT-Seite 20061614; nicht am Karton geprüft |
| Wireless Upgrade Kit | 20061676 | wireless-anschluss × 1 | 1 | hoch | CT-Seite 20061676 („1x Wireless Anschlussschiene, 2x Wireless Handregler“) |

Mach 8 + Ausbauset 1 + Ausbauset 3 ergeben genau die Spalte „Summe“ der Recherche-Tabelle:
gerade-342 14, gerade-114 1, kurve-1-90 8, kurve-1-45 4, steilkurve-1-45 4, spurwechsel-gerade 2,
engstelle 1, kreuzung 1, anschlussstueck 1, rundenzaehler 1, looping-teil 8, steilkehre-teil 4
(zusammen 49).

## Prägungen M3a

Maßgeblich für REQ-PRAEG-2. Aus Issue #28; weitere kommen später als Datennachtrag.

| Eintrag | Prägung | Sicherheit | Quelle |
|---|---|---|---|
| steilkehre-teil | `141903-1B` | niedrig | gokarli.de, „Looping Ersatzschiene“ (Shop-Nr. `100.61613-Ersatz`), Shopfoto passt zum K-Teil |
| gerade-342 | `142202-1` | niedrig | Kleinanzeigen |

Kein anderer Eintrag bekommt eine Prägung, auch nicht das Looping-Teil (L): ob K und L baugleich
sind, ist in #28 offen.

## Akzeptanzkriterien

### Datenvertrag und Bestand (`src/schema`, `src/web/editor`)

- **REQ-BEST-1** [Contract] `src/schema` exportiert `InventorySchema`: `schemaVersion` (genau 1)
  und `counts`, eine Abbildung von nicht leerer Teil-ID auf ganze Zahl ≥ 0. Unbekannte
  Zusatzfelder, fehlende oder fremde Schema-Version, negative oder gebrochene Anzahlen, Anzahlen
  als Text und ein leerer Schlüssel werden beim Dekodieren abgewiesen. Kodieren und Dekodieren
  eines gültigen Bestands ergibt denselben Wert (Eigenschaft). Das Schema kennt den Katalog nicht;
  ob eine Teil-ID bekannt und bestandsfähig ist, prüft die Logik (REQ-BEST-7).
- **REQ-BEST-2** [When] Wenn für einen bestandsfähigen Katalogeintrag eine Anzahl gesetzt wird, ist
  sie danach genau dieser Wert; „+1“ erhöht um eins, „−1“ senkt um eins. Eine Eingabe, die keine
  ganze Zahl ≥ 0 ist (negativ, gebrochen, leer, keine Zahl), und jede Teil-ID, die unbekannt
  oder eine Baugruppe ist, wird abgewiesen: der Bestand bleibt unverändert, die Logik liefert eine
  Meldung. „−1“ bei Anzahl 0 ist nicht verfügbar und ändert nichts. Beispiel: leerer Bestand,
  Kurve 1/90° auf 8 setzen, dann „−1“ → 7; Steilkehre (Baugruppe) auf 1 setzen → abgewiesen.
- **REQ-BEST-3** [When] Nach jeder wirksamen Bestandsänderung (REQ-BEST-2, REQ-BEST-9,
  REQ-SET-4) sichert die Logik den Bestand sofort über die eingereichte Speicher-Schnittstelle aus
  M2 (REQ-STORE-1) unter dem festen Schlüssel `carrera-planer:bestand`; der Wert ist genau der
  JSON-Text des mit `InventorySchema` kodierten Bestands. Beim Start lädt sie ihn von dort. Gibt
  es den Schlüssel nicht, ist der Bestand leer (alle Anzahlen 0), ohne Meldung (Frage 1).
- **REQ-BEST-4** [Contract] Sichern und anschließendes Laden (neue Sitzung über denselben
  Speicher) ergibt für beliebige über REQ-BEST-2/-9 und REQ-SET-4 erzeugte Bestände exakt dieselben
  Anzahlen je Teil-ID (Eigenschaft; Anzahl 0 und fehlender Schlüssel gelten als gleich).
- **REQ-BEST-5** [If/Then] Scheitert beim Start das JSON-Parsen oder die
  `InventorySchema`-Dekodierung des gesicherten Bestands, verschiebt die Logik den Rohtext
  unverändert unter `carrera-planer:bestand:defekt:<ISO-8601-UTC mit Millisekunden>` (Uhr wie
  REQ-STORE-9 in M2), bei belegtem Schlüssel mit `-2`, `-3`, … bis einer frei ist. Erst nach
  gelungenem Schreiben dort darf `carrera-planer:bestand` überschrieben werden. Die Logik startet
  mit leerem Bestand und liefert eine Meldung mit Ausweichschlüssel und Grund (Text der
  Schema-Prüfung). Scheitert das Verschieben, bleibt der kaputte Wert unter
  `carrera-planer:bestand` und wird in dieser Sitzung nicht überschrieben; Änderungen leben dann
  nur im Speicher der Seite, und die Meldung sagt das. Defekte Bestandssicherungen lassen sich
  auflisten, als Rohtext exportieren und nach Bestätigung löschen, nicht laden (Frage 13).
- **REQ-BEST-6** [If/Then] Wirft der Speicher beim Lesen oder Schreiben des Bestands (nicht
  verfügbar, voll, gesperrt), liefert die Logik eine Meldung; der Bestand im Speicher der Seite
  bleibt erhalten, und die Anwendung bleibt bedienbar (keine unbehandelte Ausnahme).
- **REQ-BEST-7** [If/Then] Enthält ein schema-gültiger gespeicherter Bestand Teil-IDs, die der
  Katalog nicht kennt oder die eine Baugruppe bezeichnen, wird er geladen; diese Einträge zählen
  für Rest, Sperre und Einkaufsliste nicht, die Logik meldet sie mit ihren Teil-IDs, und beim
  nächsten Sichern werden sie unverändert mitgeschrieben, nicht still entfernt (Frage 12).
  Beispiel: `{"schemaVersion":1,"counts":{"kurve-1-90":8,"gibt-es-nicht":3}}` → Kurve 1/90° 8,
  Meldung nennt `gibt-es-nicht`; nach „+1“ auf Gerade 342 steht im Speicher weiterhin
  `"gibt-es-nicht":3`.
- **REQ-BEST-8** [Contract] Bestand und Layouts berühren sich im Speicher nicht: Eine
  Bestandsänderung schreibt nur `carrera-planer:bestand` bzw. dessen Ausweichschlüssel und ändert
  weder Elementfolge noch Verlauf, aktuellen Namen oder Arbeitsstand-Schlüssel; die Liste der
  gespeicherten Layouts und die Liste der defekten Layout-Sicherungen aus M2 enthalten keine
  Bestandsschlüssel, die Liste defekter Bestandssicherungen keine Layout-Schlüssel; eine
  Folgeänderung schreibt den Bestand nicht. Wirkungsnachweis: Speicher-Attrappe, die jeden
  Schreib- und Löschzugriff mit Schlüssel protokolliert.
- **REQ-BEST-9** [When] „Bestand leeren“ setzt nach ausdrücklicher Bestätigung den ganzen
  Bestand auf leer, einschließlich der Einträge aus REQ-BEST-7; ohne Bestätigung ändert es nichts.

### Set-Vorlagen (`src/schema`, `src/catalog`, `src/web/editor`)

- **REQ-SET-1** [Contract] `src/schema` exportiert `SetTemplateSchema`: `id` und `name` (nicht
  leer), `articleNumber` (genau 8 Ziffern als Zeichenkette, wie REQ-CAT-2), `source` (nicht leer),
  `certainty` (hoch/mittel/niedrig), `contents` (nicht leere Liste aus `part`, nicht leer, und
  `count`, ganze Zahl ≥ 1). Unbekannte Zusatzfelder, fehlende Quelle oder Sicherheit, eine
  Artikelnummer mit anderer Länge und `count` 0 werden abgewiesen. Kodieren und Dekodieren ergibt
  denselben Wert.
- **REQ-SET-2** [Where] `src/catalog` exportiert die Set-Vorlagen genau nach der Tabelle
  „Set-Vorlagen M3a“ (IDs frei wählbar, aber stabil; Reihenfolge wie in der Tabelle).
- **REQ-SET-3** [Contract] Jede Set-Vorlage besteht `SetTemplateSchema`; ihre Inhalte verweisen
  nur auf bestandsfähige Katalogeinträge, jede Teil-ID höchstens einmal je Vorlage; Vorlagen-IDs
  und Artikelnummern sind eindeutig. Wirkungsnachweis mit verändertem Katalog: Entfällt
  `kurve-1-45` aus dem Katalog oder wird `looping` (Baugruppe) Inhalt einer Vorlage, schlägt die
  Prüfung fehl.
- **REQ-SET-4** [When] Wenn eine Set-Vorlage gewählt und bestätigt wird (Frage 3), erhöht die
  Logik für jeden Inhaltseintrag den Bestand dieses Teils um `count` und sichert (REQ-BEST-3).
  Andere Anzahlen und Einträge nach REQ-BEST-7 bleiben unverändert. Abbrechen ändert nichts.
  Beispiel: leerer Bestand + Mach 8 + Ausbauset 1 + Ausbauset 3 → genau die Summenzeile unter
  „Set-Vorlagen M3a“ (49 Teile); danach noch einmal Mach 8 → gerade-342 18, looping-teil 16.
- **REQ-SET-5** [Contract] Eigenschaft (beliebige Folgen von Vorlagen über beliebigen
  Startbeständen): Das Ergebnis hängt nicht von der Reihenfolge ab, und die Summe aller Anzahlen
  steigt genau um die Summe der Inhalte.

### Bestandsmodus (`src/web/editor`)

- **REQ-MODUS-1** [When] Wenn der Modus zwischen „Sandbox“ und „Bestand“ umgeschaltet wird,
  bleiben Elementfolge, Verlauf, Auswahl, Aktion und aktueller Name unverändert; es entsteht kein
  Verlaufseintrag und kein Schreiben des Arbeitsstands. Start und Speicherung des Modus nach
  Frage 6 (Empfehlung: zuletzt gewählter Modus unter `carrera-planer:modus`; fehlt oder ist der
  Wert ungültig, „Sandbox“ und bei ungültigem Wert eine Meldung).
- **REQ-MODUS-2** [Contract] Im Modus „Sandbox“ beeinflusst der Bestand keinen Befehl: Für
  beliebige Bestände und Befehlsfolgen ergibt die Sandbox dieselben Zustände wie der M2-Editor
  ohne Bestand (Eigenschaft). Die M2-Tests in `src/web/editor` laufen unverändert grün.
- **REQ-MODUS-3** [If/Then] Im Modus „Bestand“ weist die Logik einen Befehl ab (Folge
  unverändert, kein Verlaufseintrag, Meldung mit dem Namen des betroffenen Teils), wenn nach dem
  Befehl für mindestens ein Teil p gilt: Verbrauch(p) ist gestiegen und Verbrauch(p) > Bestand(p).
  Ist der Verbrauch nach dem Befehl nicht bestimmbar, wird jeder Befehl abgewiesen, der ein
  Teil-Element hinzufügt oder ersetzt. Alle anderen Befehle wirken wie in der Sandbox (Frage 4).
  Beispiele mit Bestand = Mach 8: aus der leeren Folge fünfmal Gerade 342 → vier angehängt, der
  fünfte abgewiesen; siebenmal Kurve 1/90° → sechs angehängt. Im Oval (REQ-CORE-13 (c)) eine
  Gerade 342 durch Engstelle ersetzen → wirkt; danach die andere Gerade 342 durch Engstelle
  ersetzen → abgewiesen. Eine Kurve 1/90° durch Kurve 1/45° ersetzen → abgewiesen (Bestand 0).
  „Richtung umschalten“, „Querung anhängen“ und „Löschen“ werden nie abgewiesen.
- **REQ-MODUS-4** [If/Then] Laden, Import, Neu, Rückgängig, Wiederholen und der Moduswechsel
  werden im Modus „Bestand“ nie wegen des Bestands abgewiesen (Frage 4). Entsteht dadurch ein
  überzogenes Layout, gilt REQ-MODUS-3 weiter je Teil: Beispiel Bestand = Ausbauset 3, Oval
  geladen (Kurve 1/90° überzogen um 4) → eine weitere Kurve 1/90° anhängen wird abgewiesen, eine
  Gerade 342 anhängen wirkt (3 ≤ 8), eine Kurve löschen wirkt.
- **REQ-MODUS-5** [When] Die Leisten-Einteilung im Modus „Bestand“ ist eine reine Funktion von
  Katalog, Bestand und Elementfolge. Sie liefert in Katalogreihenfolge die Einträge der
  M2-Einteilung (REQ-EDIT-21), dabei entfallen bestandsfähige Einträge mit Bestand 0 und
  Baugruppen, bei denen ein Bestandteil weniger Bestand hat als die Baugruppe braucht (Frage 5).
  Jeder bestandsfähige Eintrag trägt Bestand und Rest; ein platzierbarer Eintrag mit Rest ≤ 0 ist
  „gesperrt“. Ist der Verbrauch nicht bestimmbar, sind alle platzierbaren Einträge gesperrt und
  der Rest ist unbestimmt. Beispiel: Bestand Mach 8, Folge Oval → Gerade 342 Rest 2, Gerade 114
  Rest 1, Kurve 1/90° Rest 2, Engstelle, Kreuzung, Anschlussstück, Rundenzähler Rest 1, alle
  platzierbar und nicht gesperrt; Gerade 171, Kurven 1/45°, 2/45°, 3/45°, Spurwechsel,
  Wireless-Anschluss und Steilkurve entfallen; Looping (Baugruppe, 8 L vorhanden) und Steilkehre
  (Baugruppe, 4 K und 6 ≥ 2 Kurven vorhanden) bleiben als „Maße fehlen“; L und K bleiben
  ausgeblendet wie in M2. Mit Bestand Ausbauset 3 entfallen beide Baugruppen.
- **REQ-MODUS-6** [Contract] Eigenschaft: Jede im Modus „Bestand“ aus einer nicht überzogenen
  Folge durch beliebige Befehle (ohne Laden und Import) entstehende Folge ist nicht überzogen.
  Gegenprobe: In der Sandbox gilt das für denselben Generator nicht (es gibt ein Gegenbeispiel).

### Einkaufsliste (`src/web/editor`)

- **REQ-EINK-1** [When] Die Einkaufsliste ist eine reine Funktion von Katalog, Bestand und
  Elementfolge. Sie enthält je Katalogeintrag mit Fehlmenge ≥ 1, in Katalogreihenfolge, eine Zeile
  mit Teil-ID, Name, benötigt (= Verbrauch), vorhanden (= Bestand) und fehlt (= Fehlmenge), dazu
  die Summe der Fehlmengen. Ohne Zeilen meldet sie „alles vorhanden“. Baugruppen erscheinen nie
  als Zeile, nur ihre Bestandteile. Beispiele: Oval, leerer Bestand → Kurve 1/90° fehlt 4,
  Gerade 342 fehlt 2, zusammen 6. Acht, leerer Bestand → Gerade 114 1, Kurve 1/90° 6, Kreuzung 1,
  Anschlussstück 1, zusammen 9. Oval oder Acht mit Bestand Mach 8 → „alles vorhanden“. Neun
  Kurven 1/90° mit Bestand Mach 8 + Ausbauset 1 + Ausbauset 3 → Kurve 1/90° benötigt 9,
  vorhanden 8, fehlt 1.
- **REQ-EINK-2** [If/Then] Ist der Verbrauch nicht bestimmbar (Kern meldet „Teil unbekannt“),
  liefert die Einkaufsliste „Einkaufsliste nicht bestimmbar“ und keine Zeilen. Andere
  Kern-Fehler (z. B. „Maße fehlen“, offene Strecke, ungültiger Verweis) verhindern sie nicht,
  wie beim Verbrauch in M2 (REQ-STAT-4).
- **REQ-EINK-3** [When] Suchbegriffe je Zeile:
  - Hat der Eintrag Artikelnummern, alle in Katalogreihenfolge; hat er zusätzlich Prägungen, auch
    diese, als „Prägung“ gekennzeichnet (Frage 8).
  - Hat er keine eigene Artikelnummer (`"keineEigene"`), aber Prägungen: die Prägungen als
    Suchbegriff, gekennzeichnet als „Prägung“.
  - Hat er weder Artikelnummer noch Prägung: den Hinweis „keine Artikelnummer, keine Prägung
    bekannt“ und für jede Baugruppe des Katalogs, die ihn enthält und Artikelnummern hat,
    „enthalten in <Name der Baugruppe>, Art.-Nr. <Nummern>“ (Frage 10).

  Beispiele mit leerem Bestand (Layouts nur per Laden/Import, weil Baugruppen nicht platzierbar
  sind; der Kern meldet „Maße fehlen“, der Verbrauch zählt trotzdem):
  `[steilkehre]` → Steilkehre-Teil (K) fehlt 4, „Prägung 141903-1B“; Kurve 1/90° fehlt 2,
  „20061603“. `[looping]` → Looping-Teil (L) fehlt 8, „keine Artikelnummer, keine Prägung
  bekannt“, „enthalten in Looping (Baugruppe), Art.-Nr. 20061613“. Ein Anschlussstück →
  „20061530“, „20061666“. Eine Gerade 342 → „20061602“ und „Prägung 142202-1“.
- **REQ-EINK-4** [Contract] Eigenschaft (beliebige Folgen aus dem Katalog, beliebige Bestände
  einschließlich unbekannter Teil-IDs): fehlt(p) = max(0, Verbrauch(p) − Bestand(p)) für jedes
  Teil; die Liste ist genau dann leer, wenn kein Teil überzogen ist; addiert man die Fehlmengen
  auf den Bestand, ist die Liste danach leer; Einträge nach REQ-BEST-7 ändern nichts am Ergebnis.
- **REQ-EINK-5** [Where] Die Einkaufsliste und ihre Kurzform in der Statusleiste („Bestand
  reicht“ bzw. „fehlen n Teile“) gibt es in beiden Modi (Frage 7). Im Modus „Bestand“ ist sie nur
  nach Laden, Import oder einer Bestandsänderung nicht leer.

### Prägung (`src/schema`, `src/catalog`)

- **REQ-PRAEG-1** [Contract] `CatalogEntrySchema` bekommt das **optionale** Feld `praegung`: eine
  nicht leere Liste von Einträgen mit `value`, `source` (nicht leer) und `certainty`
  (hoch/mittel/niedrig) (Frage 9). `value` ist nicht leer, hat keinen Leerraum am Rand und besteht
  nicht aus genau 8 Ziffern (sonst wäre es eine Artikelnummer; die beiden Nummernarten werden
  nicht vermischt). Ein Eintrag ohne `praegung` bleibt gültig; eine leere Liste, ein
  Zusatzfeld im Prägungseintrag und ein fehlendes `source` werden abgewiesen. `articleNumbers`
  bleibt unverändert (genau 8 Ziffern oder `"keineEigene"`): `["141903-1B"]` als `articleNumbers`
  wird weiter abgewiesen. Kodieren und Dekodieren eines Eintrags mit Prägung ergibt denselben
  Wert. Die M1-Tests in `src/schema` und `src/catalog` laufen unverändert grün.
- **REQ-PRAEG-2** [Where] Der Katalog trägt genau die Prägungen der Tabelle „Prägungen M3a“;
  alle anderen Einträge haben kein Feld `praegung`.
- **REQ-PRAEG-3** [Contract] Prägungswerte sind über den ganzen Katalog eindeutig (eine Prägung
  benennt höchstens einen Eintrag). Wirkungsnachweis mit verändertem Katalog: Bekommt das
  Looping-Teil (L) ebenfalls `141903-1B`, schlägt die Prüfung fehl.

### Darstellung und Bedienung (`src/web/ui`, Browser-Smoke)

- **REQ-BUI-1** [Where] Ein Bestandsdialog zeigt je bestandsfähigem Katalogeintrag in
  Katalogreihenfolge Name, Artikelnummer(n) bzw. Prägung, die Anzahl mit „−“, „+“ und einem
  Zahlenfeld; dazu die Set-Vorlagen als Knöpfe mit Name, Artikelnummer und Sicherheit (bei
  „niedrig“ und „mittel“ sichtbar „Inhalt ungeprüft“), „Bestand leeren“ und die Liste defekter
  Bestandssicherungen (Rohtext herunterladen, löschen). Bedienbar auf Laptop, Tablet und Handy
  wie REQ-UI-1 (kein waagerechtes Scrollen der Seite, Tippziele ≥ 44 × 44 CSS-Pixel).
- **REQ-BUI-2** [When] Vor dem Addieren einer Set-Vorlage zeigt eine Rückfrage deren Inhalt
  (Teilname × Anzahl, Summe); erst „Hinzufügen“ ändert den Bestand (Frage 3).
- **REQ-BUI-3** [Where] Ein Modus-Schalter „Sandbox / Bestand“ ist immer sichtbar und zeigt den
  aktuellen Modus. Im Modus „Bestand“ zeigt die Leiste die Einteilung aus REQ-MODUS-5 mit
  Restzähler je Eintrag; gesperrte Einträge sind ausgegraut, mit Rest (auch negativ) beschriftet
  und reagieren nicht auf Antippen. Ein abgewiesener Befehl (REQ-MODUS-3) zeigt seine Meldung.
- **REQ-BUI-4** [Where] Die Statusleiste zeigt die Kurzform aus REQ-EINK-5; Antippen öffnet die
  Einkaufsliste mit Name, benötigt, vorhanden, fehlt und Suchbegriffen je Zeile sowie der Summe.
  Artikelnummern und Prägungen sind als Text markierbar und kopierbar.
- **REQ-BUI-5** [If/Then] Meldungen aus REQ-BEST-2, -5, -6, -7, REQ-MODUS-1 und -3 erscheinen
  sichtbar auf der Seite und bleiben stehen, bis der Mensch sie schließt (wie REQ-UI-9); ein
  Eintrag nur in der Konsole reicht nicht.
- **REQ-BUI-6** [Architektur] Die Anwendung lädt weiterhin nichts aus dem Netz außer ihren eigenen
  Dateien (REQ-UI-10 gilt unverändert).

### Architektur

- **REQ-BARCH-1** [Architektur] Die Logik für Bestand, Set-Vorlagen, Modus und Einkaufsliste liegt
  in `src/web/editor`, nutzt weder Preact noch DOM-Globale und rechnet korrekt im Vitest-Lauf in
  der Node-Umgebung mit werfendem `preact`-Stub (wie REQ-WARCH-1).
- **REQ-BARCH-2** [Architektur] M3a ändert keine Datei unter `src/core` und `src/server`.
  Verbrauch kommt ausschließlich aus `consumption` des Kerns. Wirkungsnachweis: Mit einem im Test
  verfälschten Katalog (Steilkehre aus 4 K + 3 Kurve 1/90°) zeigt die Einkaufsliste für
  `[steilkehre]` Kurve 1/90° fehlt 3, und die Leisten-Einteilung im Bestandsmodus mit Bestand
  Mach 8 zeigt für dieselbe Folge Kurve 1/90° Rest 3 (mit dem echten Katalog 4).
- **REQ-BARCH-3** [Architektur] Der Mutations-Ratchet (`break=100`) endet ohne überlebenden
  Mutanten in `src/schema`, `src/catalog` und `src/web/editor`; Überlebende werden mit Tests
  getötet, nie ausgeblendet. `stryker.config.json` bleibt unverändert.
- **REQ-BARCH-4** [Performance] Für eine fehlerfreie Folge mit 1000 Elementen und einen Bestand,
  der sie deckt, dauert ein Befehl im Modus „Bestand“ (Anhängen am Ende) samt Bestandsprüfung,
  Leisten-Einteilung mit Rest und Einkaufsliste im Vitest-Lauf (Node 22) höchstens 250 ms im
  Maximum über 20 Durchläufe; der Test gibt Maximum und Median aus.

## Entscheidungen zum Umfang

1. **Bestand je Teil, nicht je Baugruppe.** KONZEPT: eine Baugruppe „verbraucht alle ihre
   Teile“. Ein Bestand „Steilkehre 1“ wäre doppeldeutig (zieht er zwei Kurven ab?). Deshalb nur
   bestandsfähige Einträge; die Steilkehre aus dem Mach 8 steckt als 4 K plus Kurven im Bestand.
2. **Bestandsprüfung je Teil und nur bei steigendem Verbrauch** (REQ-MODUS-3). So bleibt ein
   überzogenes Layout reparierbar (Löschen, Ersetzen durch vorhandene Teile), und „Ein Layout wird
   nicht an einen Modus gebunden“ hält: Laden eines Sandbox-Entwurfs im Bestandsmodus ist genau
   das „gegen den Bestand prüfen“ aus dem KONZEPT.
3. **Kein Ersatz gleicher Geometrie.** Eine fehlende Kurve 1/90° wird nicht durch eine
   vorhandene Spurwechselkurve gedeckt, obwohl sie deckungsgleich ist (Frage 16).
4. **Einzelteile, keine Packungen.** Die Einkaufsliste nennt Einzelteile; „Einkaufsliste in
   kaufbaren Packungen“ steht im KONZEPT unter „später“. Für L-Teile ohne Einzelartikel gibt es
   deshalb nur den Hinweis auf die Baugruppe Looping (20061613).
5. **Bestand nur lokal.** `localStorage` gilt je Gerät und Adresse; den Abgleich bringt M3b. Die
   Set-Vorlagen machen das Erfassen auf einem zweiten Gerät zu drei Klicks (Frage 11).

## Nicht-Ziele (M3a)

- Backend, SQLite, Versionsnummer je Layout, geräteübergreifender Bestand (M3b). Deploy (M4).
- Toleranz beim Schließen (#27), Vermessung von Looping, Steilkehre, Steilkurve (#1), Drag & Drop
  (#4), Zufallsstrecke (#3), einspurige Teile (#7).
- Restzähler für Baugruppen: kommt, wenn sie platzierbar werden (#1).
- Set-Vorlagen abziehen, eigene Set-Vorlagen anlegen, Einkaufsliste in Packungen, Preise,
  Händlerlinks.
- Bestands-Verlauf (Rückgängig für Bestandsänderungen).
- Änderungen an `src/core` oder an `articleNumbers`.

## Offene Fragen an den Menschen

Je Frage eine Empfehlung; die Kriterien sind nach ihr formuliert und werden bei abweichender
Antwort angepasst.

1. **Vorbelegung des Bestands.** Empfehlung: **leer starten**, Erfassen per Set-Vorlagen (Mach 8,
   Ausbauset 1, Ausbauset 3 = drei Klicks). Grund: Eine feste Vorbelegung wäre unser Bestand im
   Code, für andere Nutzer falsch, und sie trüge die ungeprüften Inhalte von AS 1 und AS 3 still
   hinein. Alternative: beim allerersten Start (kein Schlüssel) mit Mach 8 + AS 1 + AS 3 belegen.
2. **Spurwechsel in Ausbauset 1.** Empfehlung: `spurwechsel-gerade` (laut Recherche
   „vermutlich“), Sicherheit „niedrig“, bis #2 am Karton geklärt ist. Ist es die Spurwechselkurve,
   ändert sich nur die Vorlage.
3. **Set-Vorlage versehentlich doppelt.** Empfehlung: Rückfrage mit Inhaltsliste vor dem Addieren
   (REQ-BUI-2), kein Bestands-Rückgängig; Korrektur über die Zähler oder „Bestand leeren“.
   Alternative: „Set abziehen“ als Gegenstück (abziehen unter 0 müsste dann geregelt werden).
4. **Was ist im Bestandsmodus gesperrt?** KONZEPT sagt nur „Ist ein Teil aufgebraucht, ist es
   gesperrt“. Empfehlung: REQ-MODUS-3/-4 — gesperrt wird nur ein Befehl, der den Verbrauch eines
   Teils über den Bestand hebt; Laden, Import, Rückgängig, Wiederholen und Moduswechsel nie,
   ein Überzug wird angezeigt. Alternative: Laden eines überzogenen Layouts im Bestandsmodus
   verweigern; Preis: dann lässt sich ein Sandbox-Entwurf dort nicht „prüfen“.
5. **Leiste im Bestandsmodus: was nicht vorhanden ist.** Empfehlung: Teile mit Bestand 0
   ausblenden (KONZEPT: „bietet nur, was wir besitzen“), aufgebrauchte (Rest ≤ 0) gesperrt
   sichtbar lassen. Alternative: alle Teile zeigen, Bestand 0 ebenfalls gesperrt.
6. **Modus merken.** Empfehlung: zuletzt gewählten Modus unter `carrera-planer:modus` speichern;
   fehlend → „Sandbox“, ungültig → „Sandbox“ mit Meldung, der Wert wird beim nächsten Wechsel
   überschrieben (er ist ein einzelnes Wort, ein Ausweichschlüssel lohnt nicht). Alternative:
   nicht speichern, immer in „Sandbox“ starten.
7. **Einkaufsliste in beiden Modi.** KONZEPT ordnet sie der Sandbox zu. Empfehlung: in beiden
   Modi zeigen; im Bestandsmodus ist sie fast immer „Bestand reicht“, zeigt aber den Überzug
   eines geladenen Entwurfs.
8. **Prägung auch bei Teilen mit Artikelnummer zeigen?** #28 verlangt sie nur für
   „keineEigene“. Empfehlung: zusätzlich zeigen (Gerade 342 → „20061602“ und „Prägung
   142202-1“), weil Kleinanzeigen gebrauchte Teile eher über die Prägung finden.
9. **Form des Prägungsfelds.** #28 schlägt `praegung: ["141903-1B"]` vor. Die Constitution
   verlangt Quelle und Sicherheit für jeden Katalogwert, und die beiden Fundstellen sind
   unterschiedlich gut. Empfehlung: Liste von `{ value, source, certainty }`; `value` ohne festes
   Muster (nur zwei Beispiele bekannt), aber nicht genau 8 Ziffern. Alternative: reine
   Zeichenketten, Quelle im Freitext `source` des Eintrags. Dazu: Feldname `praegung` wie in #28
   (Mischung mit englischen Feldnamen wie `articleNumbers` ist bewusst hingenommen).
10. **Teile ohne Artikelnummer und ohne Prägung** (heute L). Empfehlung: Hinweis „keine
    Artikelnummer, keine Prägung bekannt“ plus „enthalten in <Baugruppe>, Art.-Nr. …“, aus dem
    Katalog abgeleitet. Alternative: nur der Hinweis.
11. **Bestand zwischen Geräten übertragen.** Empfehlung: kein Export/Import für den Bestand in
    M3a (Set-Vorlagen machen das Erfassen billig, M3b gleicht ab). Alternative: Export/Import wie
    bei Layouts (REQ-STORE-9 bis -11).
12. **Unbekannte Teil-IDs im gespeicherten Bestand.** Empfehlung: laden, nicht zählen, melden,
    unverändert mitspeichern (REQ-BEST-7), nie still entfernen; nur „Bestand leeren“ entfernt
    sie. Alternative: den ganzen Bestand als kaputt behandeln (REQ-BEST-5).
13. **Kaputter Bestand: eigene Liste?** Empfehlung: eigener Ausweichschlüssel
    `carrera-planer:bestand:defekt:…` und eigene Liste im Bestandsdialog, damit die
    Layout-Defektliste aus M2 unverändert bleibt. Alternative: gemeinsame Liste.
14. **Testhilfen im geschützten Satz.** Wie in M2 (#20) wird spec-to-tests neue Vertragstypen und
    Fixtures unter `src/web/test-support/` brauchen; das ist geschützt und nur per Admin-Override
    zu mergen. Empfehlung: spec-to-tests legt eine **neue** Datei
    `src/web/test-support/bestand-fixtures.ts` an (statt `editor-fixtures.ts` zu ändern), der
    Mensch merged sie per Admin-Override.
15. **KONZEPT nachziehen.** Die Meilenstein-Tabelle kennt M3 als Ganzes, und das Prägungsfeld
    steht nicht im KONZEPT. Empfehlung: KONZEPT-Nachtrag (M3 → M3a/M3b, Prägung als
    Katalogfeld) als eigener kleiner PR, zusammen mit dieser Spec abgenommen.
16. **Ersatz durch deckungsgleiche Teile.** Empfehlung: kein Ersatz (Entscheidung 3); die
    Spurwechselkurve deckt keine fehlende Kurve 1/90°, weil sie sich im Fahren anders verhält.

## Smoke

**Aufrufer des geänderten Pfads: die Browser-Oberfläche, sonst niemand.** Nachgesehen am
Basisstand `5317c77`:

- Einstieg `src/web/index.ts:6-7` → `mount` in `src/web/ui/app.tsx:458-461`, das die Sitzung mit
  `createSession` (`src/web/editor/session.ts:101`) über `browserStorage()` und `browserClock`
  (`src/web/ui/browser.ts:13`, `:43`) baut.
- Den Katalog bezieht nur die Oberfläche: `src/web/ui/app.tsx:8` (`CATALOG`), `:36`; daraus die
  Leiste `:201` (`paletteEntries`) und `:344-380` (`<nav class="palette">`), der Verbrauch `:86`
  (`consumptionView`, `src/web/editor/status.ts:70`) und die Statusleiste `:389-411`.
- `CatalogEntrySchema` wird außerhalb der Tests nur als Typ benutzt (`src/catalog/catalog.ts:8`,
  `src/core/types.ts:5`); dekodiert wird zur Laufzeit nur `LayoutSchema`
  (`src/web/editor/session.ts:14`).
- `src/server/index.ts:2` ist ein Platzhalter (`export {};`); MCP oder andere Dienste rufen
  nichts auf. Mit M3a kommt kein weiterer Aufrufer hinzu.

Start für die Abnahme wie in M2: `pnpm dev --host`, Laptop (Chrome oder Firefox), Tablet und Handy
im Heimnetz. Vor dem ersten Fall den Bestand über „Bestand leeren“ leeren.

1. **Bestand aus Packungen.** Bestandsdialog öffnen, „Mach 8“ wählen → Rückfrage zeigt 27 Teile,
   „Hinzufügen“. Dann „Ausbauset 1“ (Hinweis „Inhalt ungeprüft“ sichtbar) und „Ausbauset 3“.
   Sichtbar: Gerade 342 14, Gerade 114 1, Kurve 1/90° 8, Kurve 1/45° 4, Steilkurve 1/45° 4,
   Spurwechsel gerade 2, Engstelle 1, Kreuzung 1, Anschlussstück 1, Rundenzähler 1, Looping-Teil
   (L) 8, Steilkehre-Teil (K) 4. Seite neu laden → derselbe Bestand.
2. **Zähler.** Kurve 1/90° per „−“ auf 7, per Zahlenfeld auf 8 zurück. „−1“ bei Gerade 171
   (Bestand 0) ist ausgegraut. „-3“ oder „2,5“ ins Zahlenfeld → Meldung, Anzahl bleibt.
3. **Bestandsmodus.** Bestand nur Mach 8 (leeren, Mach 8 hinzufügen). Modus „Bestand“. In der
   Leiste fehlen Gerade 171, die 45°-Kurven, Spurwechsel und Steilkurve; Gerade 342 zeigt Rest 4.
   Fünfmal Gerade 342 tippen → nach dem vierten steht Rest 0, der Eintrag ist ausgegraut, der
   fünfte Tipp ändert nichts. Neu, dann das Oval bauen → Rest Kurve 1/90° 2. Eine Gerade 342
   durch Engstelle ersetzen → wirkt; die andere Gerade 342 durch Engstelle ersetzen → Engstelle
   ist gesperrt, nichts passiert. Rückgängig/Wiederholen funktionieren wie in M2.
4. **Sandbox-Entwurf gegen den Bestand prüfen.** Modus „Sandbox“, Bestand Mach 8, Neu, neun
   Kurven 1/90° in einer Richtung. Statusleiste „fehlen 3 Teile“; Einkaufsliste: Kurve 1/90°
   benötigt 9, vorhanden 6, fehlt 3, „20061603“. Modus „Bestand“ → die Folge bleibt, die Leiste
   zeigt Kurve 1/90° gesperrt mit Rest −3; eine Kurve löschen wirkt, eine anhängen nicht.
5. **Einkaufsliste mit Suchbegriffen.** Bestand leeren, Sandbox, die Acht bauen → Gerade 114
   „20061658“, Kurve 1/90° 6 „20061603“, Kreuzung „20061616“, Anschlussstück „20061530“ und
   „20061666“, zusammen 9. Mit Bestand Mach 8 → „Bestand reicht“.
6. **Prägung und Teile ohne Nummer.** Bestand leeren, per „Importieren“ eine Datei mit
   `{"schemaVersion":1,"elements":[{"id":"a","part":"steilkehre"},{"id":"b","part":"looping"}]}`
   laden. Status „Maße fehlen, nicht platzierbar“ (wie M2), Einkaufsliste trotzdem: Kurve 1/90°
   fehlt 2 „20061603“; Looping-Teil (L) fehlt 8 „keine Artikelnummer, keine Prägung bekannt“,
   „enthalten in Looping (Baugruppe), Art.-Nr. 20061613“; Steilkehre-Teil (K) fehlt 4 „Prägung
   141903-1B“. Eine Gerade 342 anhängen (Sandbox) → Zeile mit „20061602“ und „Prägung 142202-1“.
   Die Nummern lassen sich markieren und kopieren.
7. **Modus bleibt beim Neuladen** (nach Frage 6): Modus „Bestand“, Seite neu laden → „Bestand“.
8. **Bedienung auf dem Handy** (360 × 740 hoch): Bestandsdialog ohne waagerechtes Scrollen,
   „−“, „+“, Set-Knöpfe und Modus-Schalter mit dem Daumen treffbar (≥ 44 × 44 CSS-Pixel in den
   Entwicklerwerkzeugen).

Gegenfälle, die geschlossen bleiben müssen:

9. Kaputter Bestand (Entwicklerwerkzeuge, `carrera-planer:bestand` von Hand ändern): kein JSON;
   `schemaVersion` 2; Anzahl −1; Zusatzfeld. Jedes Mal nach Neuladen: leerer Bestand, sichtbare
   Meldung mit Ausweichschlüssel, der Rohtext liegt unverändert unter
   `carrera-planer:bestand:defekt:<Zeitstempel>`; ein zweiter Fund legt einen zweiten Schlüssel an.
   Beide stehen im Bestandsdialog und lassen sich herunterladen und löschen. Die Layout-Liste und
   die Layout-Defektliste aus M2 zeigen keinen dieser Schlüssel.
10. Unbekannte Teil-ID: `{"schemaVersion":1,"counts":{"kurve-1-90":8,"gibt-es-nicht":3}}` →
    Kurve 1/90° 8, Meldung nennt `gibt-es-nicht`; nach „+“ an Gerade 342 steht
    `"gibt-es-nicht":3` noch im Speicher.
11. Speicher gesperrt (Website-Einstellungen): Bestandsänderung zeigt eine Meldung, der Zähler
    auf dem Bildschirm ändert sich trotzdem, die Seite bleibt bedienbar.
12. Bestandsänderungen ändern die Strecke nicht und legen keinen Verlaufseintrag an: Oval bauen,
    Bestand ändern, Rückgängig → nimmt das letzte Streckenteil zurück, nicht die Bestandsänderung.
13. Sandbox mit leerem Bestand: jedes platzierbare Teil bleibt antippbar wie in M2, kein Teil ist
    gesperrt.
14. Steilkehre und Looping bleiben in beiden Modi nicht platzierbar („Maße fehlen“); L und K
    tauchen in der Leiste nicht auf.
15. Netzwerk-Reiter: keine Anfragen an fremde Adressen (REQ-BUI-6).

### Nach dem Deploy

M3a wird nicht ausgeliefert (Deploy ist M4); erst dort nachweisbar:

- Der Bestand hängt wie die Layouts an der Adresse: was am Dev-Server erfasst wurde, fehlt unter
  der Raspi-Adresse. Erwartet; vor M4 dem Menschen sagen. Ohne Bestand-Export (Frage 11) heißt
  das: auf dem Raspi die drei Set-Vorlagen einmal neu anklicken.
- Jedes Gerät hat bis M3b seinen eigenen Bestand; zwei Personen können verschiedene Zahlen sehen.

Schon mit M3a, aber nur in der echten Welt prüfbar:

- Die Prägungen am echten Teil ablesen: K-Teil aus dem Mach 8 (erwartet `141903-1B`) und eine
  Gerade 342 (`142202-1`). Stimmt es, steigt die Sicherheit auf „hoch“ (Datennachtrag); weicht es
  ab, ist der Katalogwert falsch. Dabei ein L-Teil ansehen (#28: baugleich mit K?).
- Ausbauset 1 und 3 am Karton gegen die Vorlagen prüfen (#2).
- Eine Strecke im Bestandsmodus planen und mit der echten Kiste nachbauen: Es darf kein Teil
  fehlen, und nach dem Aufbau stimmt der Rest in der Leiste mit den übrigen Teilen in der Kiste.
- Einen Suchbegriff aus der Einkaufsliste bei einem Händler oder auf Kleinanzeigen eingeben: Er
  findet das richtige Teil.
