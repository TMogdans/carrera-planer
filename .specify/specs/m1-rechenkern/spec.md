# Spec: M1 — Geometrischer Rechenkern + Teilekatalog

Status: Entwurf, wartet auf Spec-Review (harter Stopp).
Grundlage: [KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23),
[docs/recherche.md](../../../docs/recherche.md), [constitution.md](../../constitution.md).

**Tier: T3** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` aus den geplanten
Pfaden `src/core/**`, `src/catalog/**`, `src/schema/**`, `.specify/specs/**` gegen
`.devloop/tier-map.json`. T3 kommt allein aus `src/schema/**` (ohne Schema wäre es T2). Das
autoritative Tier rechnet CI aus dem tatsächlichen Diff.

## User Story

Als Bahnbauer, der mit seiner Familie Carrera-GO!!!-Strecken plant, möchte ich einen Rechenkern,
der für eine Folge von Schienenteilen exakt sagt, wo die Strecke endet, ob sie sich schließt und
wie viele Teile welcher Sorte sie verbraucht, damit der Editor (M2) und der Bestandsmodus (M3)
auf Zahlen bauen, die mit der echten Bahn auf dem Boden übereinstimmen und nie wegen
Rundungsfehlern „fast geschlossen“ melden.

## Begriffe und Konventionen

Diese Festlegungen machen die Kriterien prüfbar. Sie sind Konvention, keine Domänenwahrheit.

- **Pose:** Position (x, y) plus Richtung. Richtung ist eine von 8 Stufen k ∈ {0..7}, Winkel
  k·45°. k = 0 zeigt in +x, k = 2 in +y. **Links** heißt gegen den Uhrzeigersinn (k steigt),
  **rechts** im Uhrzeigersinn.
- **Exakte Koordinate:** jede Koordinate in mm hat die Form a + b·√2 mit rationalen a, b. Nach
  außen liefert der Kern a und b als exakte rationale Zahlen (ganzzahliger Zähler/Nenner), nie als
  Gleitkommazahl. Die interne Darstellung (laut Konzept ganzzahlig in Einheiten von 57 mm mit
  kleinem festem Nenner) ist Sache der Implementierung; geprüft wird die Wirkung.
- **Darstellbares Raster:** mindestens alle Koordinaten, deren a und b ganzzahlige Vielfache von
  28,5 mm (= 57/2) sind. Jeder Endpunkt, den die Katalogteile von M1 erreichen, liegt darauf.
- **Layout:** geordnete Folge von Elementen. Ein Element verweist auf einen Katalogeintrag und
  trägt bei Kurven die Richtung links/rechts. Der Ausgang eines Elements ist der Eingang des
  nächsten. Die Startpose gehört nicht zum Layout; der Kern bekommt sie als Argument.
- **Platzierbar:** Katalogeintrag mit bekannter Geometrie, der allein im Layout stehen darf.
- **Geometrie der Teile (Mittellinie):** Gerade der Länge L verschiebt um L in Fahrtrichtung.
  Kurve mit Radius R und Winkel 45°·n dreht um n Stufen nach links/rechts auf einem Kreisbogen
  mit Radius R um einen Mittelpunkt, der R seitlich (in Drehrichtung) neben der Eingangsposition
  liegt.

## Katalog M1

Maßgeblich für die Kriterien REQ-CAT-*. Werte aus `docs/recherche.md`; „abgeleitet“ heißt aus
Carrera-Außenmaßen geschlossen, nicht nachgemessen.

| Eintrag | Art.-Nr. | Geometrie (Mittellinie) | platzierbar | Sicherheit | Quelle |
|---|---|---|---|---|---|
| Gerade 342 | 61602 | Gerade 342 mm | ja | hoch | CT |
| Gerade 171 | 61656 | Gerade 171 mm | ja | hoch | CT |
| Gerade 114 | 61658 | Gerade 114 mm | ja | hoch (nachgemessen, Mach 8) | CT, Karton Mach 8 |
| Kurve 1/90° | 61603 | Kurve R 171, 90° | ja | hoch (nachgemessen) | Messung 2026-11-23: zwei 1/90° als Halbkreis = 342 mm |
| Kurve 1/45° | 61611 | Kurve R 171, 45° | ja | hoch (abgeleitet) | CT „Länge 161“ = 228·sin 45° (Außenkante R1) |
| Kurve 2/45° | 61617 | Kurve R 285, 45° | ja | mittel (abgeleitet, ~2 mm Abweichung) | CT 242 × 179 |
| Kurve 3/45° | 61645 | Kurve R 399, 45° | ja | mittel (abgeleitet, ~3 mm Abweichung) | CT 323 × 211 |
| Spurwechselkurve | 61655 | Kurve R 171, 90° | ja | mittel (Außenmaß 228 × 228 = Kurve 1/90°) | CT |
| Spurwechsel gerade | 61609 | Gerade 228 mm | ja | mittel | CT (Kopierfehler „161 mm“ nicht übernommen) |
| Engstelle | 61610 | Gerade 228 mm | ja | hoch | CT |
| Kreuzung | 61616 | Gerade 342 mm (Spurtausch im Teil) | ja | hoch | CT |
| Anschlussstück | 61530, 61666 | Gerade 114 mm | ja | hoch (61666 nachgemessen) | CT, Messung |
| Rundenzähler | 88107 | Gerade 114 mm | ja | hoch (nachgemessen) | CT, Messung |
| Wireless-Anschluss | aus 61676 | Maße fehlen | nein | niedrig | Händler |
| Steilkurve 1/45° | 61612 | Maße fehlen (Radius unbekannt) | nein | mittel (Außenmaß), Radius unbekannt | CT |
| Looping-Teil (L) | keine eigene | Maße fehlen, nur in Baugruppe | nein | niedrig | Karton Mach 8 |
| Steilkehre-Teil (K) | keine eigene | Maße fehlen, nur in Baugruppe | nein | niedrig | Karton Mach 8 |
| Looping (Baugruppe) | 61613 | Maße fehlen; Bestandteile 8 × L | nein | niedrig | Karton Mach 8 |
| Steilkehre (Baugruppe) | keine eigene | Maße fehlen; Bestandteile 4 × K + 2 × Kurve 1/90° | nein | niedrig | Karton Mach 8 |

Nicht im M1-Katalog: siehe Nicht-Ziele.

## Akzeptanzkriterien

### Kern: Lage berechnen (`src/core`)

- **REQ-CORE-1** [When] Wenn der Kern ein Layout aus platzierbaren Teilen mit einer Startpose
  verfolgt, liefert er die Pose nach jedem Element und die Endpose, alle Koordinaten exakt in der
  Form a + b·√2 mm.
- **REQ-CORE-2** [When] Wenn eine Gerade der Länge L aus einer Pose mit Richtung k verfolgt wird,
  dann ist die Endpose um L in Richtung k verschoben und die Richtung unverändert. Beispiel:
  Gerade 342 aus (0, 0, k = 1) endet bei (171·√2, 171·√2, k = 1).
- **REQ-CORE-3** [When] Wenn eine Kurve 1/90° links aus (0, 0, k = 0) verfolgt wird, endet sie
  bei (171, 171, k = 2); rechts bei (171, −171, k = 6).
- **REQ-CORE-4** [When] Wenn eine Kurve 1/45° links aus (0, 0, k = 0) verfolgt wird, endet sie
  bei (171/2·√2, 171 − 171/2·√2, k = 1). Kurve 2/45° und 3/45° entsprechend mit R = 285 bzw. 399.
- **REQ-CORE-5** [When] (nachgemessene Wahrheit) Wenn zwei Kurven 1/90° gleicher Richtung
  hintereinander aus (0, 0, k = 0) verfolgt werden, endet die Folge bei (0, 342) (links) bzw.
  (0, −342) (rechts) mit Richtung k = 4: Halbkreis mit 342 mm Mittellinien-Abstand, also genau eine Gerade 342 breit.
- **REQ-CORE-6** [When] Wenn zwei Kurven 1/45° gleicher Richtung verfolgt werden, ist die
  Endpose identisch mit der einer Kurve 1/90° derselben Richtung, aus jeder Startpose.
- **REQ-CORE-7** [When] Wenn in einem Layout eine Gerade 342 durch die Folge Gerade 114,
  Anschlussstück, Rundenzähler (3 × 114 = 342) oder durch eine Kreuzung ersetzt wird, bleibt die
  Endpose exakt gleich.
- **REQ-CORE-8** [When] Wenn ein Layout aus einer anderen Startpose verfolgt wird (Verschiebung
  um beliebige Koordinaten des darstellbaren Rasters, Drehung um beliebige Vielfache von 45°),
  dann ist jede Pose der Spur genau die gleich verschobene und gedrehte Pose der ursprünglichen
  Spur. Das gilt auch für Layouts mit Tausenden Elementen und große Verschiebungen (kein
  Genauigkeitsverlust).
- **REQ-CORE-9** [When] Wenn in einem Layout jede Kurve ihre Richtung tauscht (links ↔ rechts),
  dann ist die Spur das Spiegelbild an der Startachse.

### Kern: Geschlossen und offen

- **REQ-CORE-10** [If/Then] Ein Layout gilt genau dann als **geschlossen**, wenn es mindestens ein
  Element hat und Endposition und Endrichtung exakt gleich Startposition und Startrichtung sind.
  Es gibt keine Toleranz: weichen Position oder Richtung um irgendeinen Betrag ab, ist es offen.
  Gleiche Position mit anderer Richtung ist offen.
- **REQ-CORE-11** [If/Then] Ist ein Layout offen, liefert der Kern den Versatz vom Ende zum Start
  als exakten Vektor (dx, dy) in mm (a + b·√2) und den Winkel Start − Ende als Vielfaches von 45°
  im Bereich (−180°, 180°]. Ist es geschlossen, sind Versatz und Winkel null. (Umrechnung in
  Dezimal-mm für die Anzeige ist Sache von M2.)
- **REQ-CORE-12** [If/Then] Ein leeres Layout ist weder geschlossen noch offen, sondern hat den
  eigenen Status „leer“.
- **REQ-CORE-13** [When] Abnahmefälle, jeweils aus beliebiger Startpose und für beide
  Kurvenrichtungen geschlossen:
  (a) 4 × Kurve 1/90° gleicher Richtung;
  (b) 8 × Kurve 1/45° gleicher Richtung;
  (c) Oval aus dem Bestand: Kurve 1/90°, Kurve 1/90°, Gerade 342, Kurve 1/90°, Kurve 1/90°,
  Gerade 342 (alle Kurven gleiche Richtung);
  (d) Oval wie (c), eine Gerade 342 ersetzt durch Gerade 114, Anschlussstück, Rundenzähler;
  (e) 8 × Kurve 2/45° gleicher Richtung, ebenso 8 × Kurve 3/45°.
- **REQ-CORE-14** [When] Wenn in ein geschlossenes Layout an beliebiger Stelle (vorn, mitten,
  hinten) genau ein platzierbares Teil eingefügt oder genau ein Element entfernt wird, ist das
  Ergebnis offen.
- **REQ-CORE-15** [If/Then] Ist die Gesamtdrehung eines Layouts (Summe der Kurvenstufen, links
  positiv, rechts negativ) kein Vielfaches von 360°, ist es offen und der gemeldete Winkel ist
  ungleich null.

### Kern: Fehler

- **REQ-CORE-16** [If/Then] Verweist ein Element auf einen unbekannten Katalogeintrag, meldet die
  Verfolgung einen Fehler mit Index des Elements und der Teil-ID; sie liefert dann kein
  Teilergebnis als „gültig“.
- **REQ-CORE-17** [If/Then] Verweist ein Element auf einen nicht platzierbaren Eintrag („Maße
  fehlen“, Baugruppe ohne Maße, „nur in Baugruppe“), meldet die Verfolgung einen Fehler „nicht
  platzierbar“ mit Index und Teil-ID. Maße werden nie geschätzt.
- **REQ-CORE-18** [If/Then] Fehlt bei einer Kurve die Richtung oder trägt ein Nicht-Kurven-Teil
  eine Richtung, meldet die Verfolgung einen Fehler mit Index und Teil-ID.
- **REQ-CORE-19** [Contract] Fehler sind Rückgabewerte des Kerns (unterscheidbares Ergebnis), keine
  geworfenen Ausnahmen. Es werden alle fehlerhaften Elemente gemeldet, nicht nur das erste.

### Teileverbrauch

- **REQ-CORE-20** [When] Wenn der Verbrauch eines Layouts berechnet wird, liefert der Kern je
  Katalogeintrag die Anzahl der verbrauchten Teile. Baugruppen werden in ihre Bestandteile
  aufgelöst und selbst nicht gezählt. Beispiel: 1 × Steilkehre + 1 × Kurve 1/90° ergibt
  Kurve 1/90° = 3, Steilkehre-Teil (K) = 4; 1 × Looping ergibt Looping-Teil (L) = 8.
- **REQ-CORE-21** [If/Then] Der Verbrauch braucht keine Geometrie: er ist auch für Layouts mit
  nicht platzierbaren Einträgen definiert. Unbekannte Teil-IDs ergeben einen Fehler wie in
  REQ-CORE-16.
- **REQ-CORE-22** [Contract] Der Verbrauch ist unabhängig von Reihenfolge und Kurvenrichtung, und
  der Verbrauch zweier hintereinandergehängter Layouts ist die Summe der Einzelverbräuche.

### Katalog (`src/catalog`)

- **REQ-CAT-1** [Where] Der Katalog enthält genau die Einträge der Tabelle „Katalog M1“ mit den
  dort genannten Geometrien, Platzierbarkeiten und Bestandteilen.
- **REQ-CAT-2** [Contract] Jeder Katalogeintrag hat eine stabile, eindeutige ID, einen Namen,
  Art.-Nr. (eine oder mehrere, oder ausdrücklich „keine eigene“), Quelle und Sicherheit
  (hoch/mittel/niedrig).
- **REQ-CAT-3** [Contract] Jeder Katalogeintrag besteht die Prüfung gegen das Katalog-Schema
  (REQ-SCHEMA-1).
- **REQ-CAT-4** [Contract] Bestandteile einer Baugruppe verweisen nur auf vorhandene
  Katalogeinträge, mit Anzahl ≥ 1; eine Baugruppe enthält keine Baugruppe.
- **REQ-CAT-5** [Contract] Jede Geometrie eines platzierbaren Eintrags führt nur auf Endpunkte im
  darstellbaren Raster: Geradenlängen und Radien sind Vielfache von 57 mm, Winkel 45° oder 90°.

### Datenvertrag (`src/schema`, Effect Schema)

- **REQ-SCHEMA-1** [Contract] Es gibt ein Schema für Katalogeinträge, das die Felder aus
  REQ-CAT-2 und die Geometriearten Gerade (Länge), Kurve (Radius, Winkel 45° oder 90°), „Maße
  fehlen“ und Baugruppe (Bestandteile, Maße fehlen) beschreibt. Ein Eintrag ohne Quelle, ohne
  Sicherheit oder mit einem anderen Kurvenwinkel wird abgewiesen.
- **REQ-SCHEMA-2** [Contract] Es gibt ein Schema für Layouts: Schema-Version und geordnete Liste
  von Elementen (Teil-ID, bei Kurven Richtung links/rechts).
- **REQ-SCHEMA-3** [If/Then] Ein Layout mit fehlender oder fremder Schema-Version, mit
  unbekannten Zusatzfeldern oder mit falsch getypten Feldern wird beim Dekodieren mit Fehler
  abgewiesen, nicht still bereinigt („alte Layouts scheitern laut“).
- **REQ-SCHEMA-4** [Contract] Kodieren und anschließendes Dekodieren eines gültigen Layouts und
  eines gültigen Katalogeintrags ergibt denselben Wert.

### Architektur

- **REQ-ARCH-1** [Architektur] Der Kern (`src/core`) funktioniert ohne Effect-Laufzeit und ohne
  I/O: er lädt und rechnet korrekt, wenn `effect` und Node-I/O-Module (`fs`, `net`, `http`,
  `child_process`) im Testlauf durch Stubs ersetzt sind, die beim Laden einen Fehler werfen.
  Typ-Importe aus dem Schema sind erlaubt.
- **REQ-ARCH-2** [Architektur] Der Kern verwendet für Lage und Geschlossenheit keine
  Gleitkomma-Arithmetik. Wirkungsnachweis über REQ-CORE-8 (große Verschiebungen, lange Layouts)
  und REQ-CORE-10 (exakter Vergleich).

## Entscheidungen zum Umfang

1. **Überschneidung: nicht in M1.** Sie gehört in den Kern, aber in eine eigene Spec vor M2.
   Gründe: (a) Die Spur des Kerns reicht für Lage und Schluss; für Überschneidung braucht es ein
   Flächenmodell der Teile (114 mm breite Bänder, Kreisringsegmente), das noch nicht festgelegt
   ist. (b) Exakt ohne Toleranz ist das für Bögen nicht trivial: Schnitte von Kreisen mit
   Radien 171/285/399 und √2-Koordinaten führen aus der Form a + b·√2 heraus. Ob ein Vergleich
   auf Mittellinien-Abstand, ein Zellraster oder eine echte Flächenprüfung gilt, und ob Berühren
   an der Steckverbindung oder Nebeneinanderliegen zweier paralleler Geraden (Abstand genau
   114 mm) als Überschneidung zählt, ist eine Entscheidung für den Menschen. (c) Die
   Höhenmarkierung (Brücke/Loop), die Überschneidungen erlaubt, bräuchte ein Feld im
   Layout-Schema, ohne dass M1 sie prüfen könnte.
   Preis: Die Überschneidung läuft nicht durch dieselbe Kette. Gegenmaßnahme: sie bekommt eine
   eigene devloop-Spec in `src/core` (Mutationsproben, gleiche Strenge), nicht den freieren
   M2-Modus.
2. **Teileverbrauch: ja, als reine Funktion.** Die Statusleiste in M2 zeigt den Verbrauch, und
   „Steilkehre verbraucht zwei 1/90°-Kurven“ ist Kernwissen über Baugruppen. Der Vergleich gegen
   den Bestand (Restzähler, Sperre, Einkaufsliste) bleibt M3.
3. **Schema: ja, aber nur Katalogeintrag und Layout.** Constitution: „Teilekatalog als Daten,
   gegen das Schema geprüft“ und „Generatoren leiten sich aus dem Schema ab“. Ohne Schema in M1
   wäre der Katalog ungeprüft und die Eigenschaftstests hätten keine Schema-Generatoren. Bestand
   und API-Schemas kommen mit M3. Preis: das hebt die ganze Spec auf T3 (Mensch-Gate); ohne
   Schema wäre sie T2. Alternative wäre, das Schema als eigene kleine Spec abzuspalten (Kern +
   Katalog T2, Schema T3) — dann müsste der Katalog in M1 ohne Schema-Prüfung bleiben, was der
   Constitution widerspricht.

## Nicht-Ziele (M1)

- Keine UI, kein Server, keine Persistenz, kein Deploy.
- Keine Überschneidungserkennung und keine Höhenmarkierung im Layout (siehe Entscheidung 1).
- Keine Bestandsverwaltung, kein Restzähler, keine Einkaufsliste, keine Set-Vorlagen (M3).
- Keine Gesamtlänge der Strecke: Bogenlängen enthalten π und passen nicht in a + b·√2; ob die
  Anzeige in M2 gerundet rechnen darf, ist offen (Frage 4).
- Keine Blackbox-Geometrie für Looping/Steilkehre (Versatz + Drehung), solange #1 nicht vermessen
  ist (siehe Frage 2).
- Nicht im Katalog: Gerade 100 mm (bricht das 57-mm-Raster, nicht im Bestand),
  Steilkurve 2/45°, Mech. Spurwechsel, Schikane, Brücke, Sprungschanze, Stützen (nicht im
  Bestand, Geometrie unklar oder ohne Maße).
- Keine Performance-Zusage; die schnelle „schließt?“-Prüfung für die Zufallsstrecke ist „später“.
- Keine Darstellung in Dezimal-mm (Anzeige ist M2).

## Offene Fragen an den Menschen

1. **Leeres Layout** (REQ-CORE-12): eigener Status „leer“ statt „geschlossen“ — so gewollt?
2. **Einheit der Darstellung.** Das Konzept sagt „Einheiten von 57 mm“. Gemessene Blackbox-Werte
   für Looping und Steilkehre (#1) und die 100-mm-Gerade liegen sehr wahrscheinlich nicht auf
   Vielfachen von 28,5 mm. Dann müssten sie entweder auf das Raster gerundet werden (eine
   Toleranz durch die Hintertür) oder die Darstellung wechselt auf z. B. halbe Millimeter
   (Konzeptänderung). Die Kriterien oben sind darstellungsneutral formuliert (rationale mm nach
   außen), damit der Wechsel später keine Tests bricht. Jetzt entscheiden oder bei #1?
3. **Spurwechsel im Bestand:** Ausbauset 1 nennt „2× Spurwechsel“. Ist das die Spurwechselkurve
   61655 (228 × 228) oder der gerade Spurwechsel 61609 (228 × 114)? Für M1 sind beide im Katalog;
   für den Bestand in M3 zählt, welcher es ist (hängt an #2).
4. **Gesamtlänge** für die Statusleiste: ganz weglassen, gerundet anzeigen (dann Gleitkomma
   außerhalb des Kerns) oder exakt als a + b·√2 + c·π?
5. **Spurwechselkurve = Kurve R 171, 90°** ist aus dem gleichen Außenmaß geschlossen. Kurz
   nachprüfen: liegt sie deckungsgleich auf einer Kurve 1/90°?
6. **Richtung bei Spurwechsel/Kreuzung:** Haben diese Teile eine Einbaurichtung, die für den
   Spurtausch zählt? Für die Geometrie egal; für spätere Spurlängen (Fairness) nicht.

## Smoke

Aufrufer des geänderten Pfads: **keiner.** Nachgesehen am Basisstand `a0eb290`: alle
`src/*/index.ts` sind Platzhalter (`src/web/index.ts:2`, `src/server/index.ts:2`,
`src/core/index.ts:2`, `src/catalog/index.ts:2`, `src/schema/index.ts:2`, jeweils `export {};`),
und kein Quelltext unter `src/` importiert etwas. Oberfläche (M2) und Backend (M3) gibt es noch
nicht; MCP oder andere Dienste rufen nichts auf.

Abnahme aus Nutzersicht ist deshalb der Mensch am Testlauf und am Katalog:

1. Der Mensch legt die Abnahmefälle REQ-CORE-13 (a)–(d) gedanklich bzw. auf dem Boden nach und
   findet sie in den Testnamen wieder; `pnpm test` ist grün, die Tests nennen die REQ-IDs.
2. Der Mensch vergleicht die Katalogtabelle mit dem Katalog im Code: jede Zeile mit Art.-Nr.,
   Maß, Quelle, Sicherheit vorhanden; Looping, Steilkehre, Steilkurve 1/45°, Wireless-Anschluss,
   K- und L-Teile sind als nicht platzierbar markiert.
3. Gegenfälle, die geschlossen bleiben müssen: Ein Layout mit Looping, Steilkehre oder
   Steilkurve 1/45° lässt sich nicht verfolgen (Fehler „nicht platzierbar“), sein Verbrauch aber
   berechnen. Ein Layout mit unbekanntem Feld oder fremder Version wird beim Dekodieren
   abgewiesen. Ein Layout, das um ein Teil verlängert wird, ist nicht mehr geschlossen.
4. Mutationsprobe (Konzept „Prüfen“): Radius der Kurve 1/90° auf 170 oder Winkel 45° auf 90°
   verfälschen — mindestens ein Test wird rot. `pnpm test:mutation` ohne überlebende Mutanten.

### Nach dem Deploy

Entfällt. M1 wird nicht ausgeliefert. Der erste in Produktion nachweisbare Fall ist mit M2/M4
fällig: das Oval aus dem Bestand im Editor bauen, auf dem Boden nachstecken und prüfen, dass
„geschlossen“ im Editor mit dem echten Schluss übereinstimmt.
