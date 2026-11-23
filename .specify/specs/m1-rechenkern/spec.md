# Spec: M1 — Geometrischer Rechenkern + Teilekatalog

Status: Entwurf, Überarbeitung 2 (Kreuzung als Acht, Antworten auf die offenen Fragen), wartet auf
Spec-Review (harter Stopp).
Grundlage: [KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23, Abschnitte „Kreuzung (Acht)“
und „Raster“ nachgetragen 2026-11-23),
[docs/recherche.md](../../../docs/recherche.md), [constitution.md](../../constitution.md).

**Tier: T3** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` aus den geplanten
Pfaden `src/core/**`, `src/catalog/**`, `src/schema/**`, `.specify/specs/**` gegen
`.devloop/tier-map.json` (bei Überarbeitung 2 neu abgeleitet, unverändert T3). T3 kommt allein
aus `src/schema/**` (ohne Schema wäre es T2). Das autoritative Tier rechnet CI aus dem
tatsächlichen Diff.

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
  28,5 mm (= 57/2) sind. Jeder Endpunkt, den die Katalogteile von M1 erreichen, liegt darauf,
  ebenso jeder Queranschluss. (Das Konzept-Raster ist 57 mm = halbe Schienenbreite; 28,5 mm
  entsteht erst durch 45°-Kurven im a-Anteil, z. B. 171/2·√2.)
- **Layout:** geordnete Folge von Elementen. Jedes Element hat eine im Layout eindeutige
  **Element-ID** und ist eins von zwei Arten:
  - **Teil-Element:** verweist auf einen Katalogeintrag und trägt bei Kurven die Richtung
    links/rechts.
  - **Querung:** verweist per Element-ID auf ein früheres Teil-Element derselben Kette, das eine
    Kreuzung ist. Sie ist der zweite Durchgang durch diese Kreuzung (quer) und hat keine eigene
    Teil-ID.

  Der Ausgang eines Elements ist der Eingang des nächsten. Die Startpose gehört nicht zum Layout;
  der Kern bekommt sie als Argument. „Position“ eines Elements heißt seine Stelle in der Folge.
- **Platzierbar:** Katalogeintrag mit bekannter Geometrie, der allein im Layout stehen darf.
- **Kreuzung, Längsweg und Querweg:** Ein Teil-Element „Kreuzung“ mit Eingangspose (p, k) wird
  **längs** durchfahren wie eine Gerade 342. Seine zwei **Queranschlüsse** liegen 171 mm hinter
  dem Eingang, 57 mm links bzw. rechts der Mittellinie. Ein Queranschluss ist eine Pose: Position
  plus die Richtung, die von dort **in die Kreuzung hinein** zeigt (senkrecht zur Längsachse):
  - linker Queranschluss: p + 171·e(k) + 57·e(k+2), Richtung k+6 (nach rechts, hinein);
  - rechter Queranschluss: p + 171·e(k) + 57·e(k+6), Richtung k+2 (nach links, hinein);

  mit e(j) = Einheitsvektor der Richtung j, Stufen modulo 8. Beispiel Eingang (0, 0, k = 0):
  links (171, 57, k = 6), rechts (171, −57, k = 2). Der Querweg zwischen beiden ist 114 mm lang.
- **Geometrie der Teile (Mittellinie):** Gerade der Länge L verschiebt um L in Fahrtrichtung.
  Kurve mit Radius R und Winkel 45°·n dreht um n Stufen nach links/rechts auf einem Kreisbogen
  mit Radius R um einen Mittelpunkt, der R seitlich (in Drehrichtung) neben der Eingangsposition
  liegt.

## Katalog M1

Maßgeblich für die Kriterien REQ-CAT-*. Werte aus `docs/recherche.md`; „abgeleitet“ heißt aus
Carrera-Außenmaßen geschlossen, nicht nachgemessen.

| Eintrag | Art.-Nr. | Geometrie (Mittellinie) | platzierbar | Sicherheit | Quelle |
|---|---|---|---|---|---|
| Gerade 342 | 20061602 | Gerade 342 mm | ja | hoch | CT |
| Gerade 171 | 20061656 | Gerade 171 mm | ja | hoch | CT |
| Gerade 114 | 20061658 | Gerade 114 mm | ja | hoch (nachgemessen, Mach 8) | CT, Karton Mach 8 |
| Kurve 1/90° | 20061603 | Kurve R 171, 90° | ja | hoch (nachgemessen) | Messung 2026-11-23: zwei 1/90° als Halbkreis = 342 mm |
| Kurve 1/45° | 20061611 | Kurve R 171, 45° | ja | hoch (abgeleitet) | CT „Länge 161“ = 228·sin 45° (Außenkante R1) |
| Kurve 2/45° | 20061617 | Kurve R 285, 45° | ja | mittel (abgeleitet, ~2 mm Abweichung) | CT 242 × 179 |
| Kurve 3/45° | 20061645 | Kurve R 399, 45° | ja | mittel (abgeleitet, ~3 mm Abweichung) | CT 323 × 211 |
| Spurwechselkurve | 20061655 | Kurve R 171, 90° | ja | hoch (deckungsgleich mit Kurve 1/90°, Nutzer bestätigt) | CT, Nutzer |
| Spurwechsel gerade | 20061609 | Gerade 228 mm, keine Einbaurichtung | ja | hoch (Nutzer bestätigt) | CT (Kopierfehler „161 mm“ nicht übernommen), Nutzer |
| Engstelle | 20061610 | Gerade 228 mm | ja | hoch | CT |
| Kreuzung | 20061616 | Kreuzung: längs 342 mm, Querweg 114 mm mittig und senkrecht (Acht) | ja | hoch (nachgemessen) | CT, Messung 2026-11-23 |
| Anschlussstück | 20061530, 20061666 | Gerade 114 mm | ja | hoch (20061666 nachgemessen) | CT, Messung |
| Rundenzähler | 20088107 | Gerade 114 mm | ja | hoch (nachgemessen) | CT, Messung |
| Wireless-Anschluss | 20061673 | Maße fehlen | nein | niedrig | CT Einzelartikel 20061673 „GO!!! Wireless Anschluss-Schiene“; 1 × enthalten im Wireless Upgrade Kit 20061676 (Set-Vorlage erst M3) |
| Steilkurve 1/45° | 20061612 | Maße fehlen (Radius unbekannt) | nein | mittel (Außenmaß), Radius unbekannt | CT |
| Looping-Teil (L) | keine eigene | Maße fehlen, nur in Baugruppe | nein | niedrig | Karton Mach 8 |
| Steilkehre-Teil (K) | keine eigene | Maße fehlen, nur in Baugruppe | nein | niedrig | Karton Mach 8 |
| Looping (Baugruppe) | 20061613 | Maße fehlen; Bestandteile 8 × L | nein | niedrig | Karton Mach 8 |
| Steilkehre (Baugruppe) | keine eigene | Maße fehlen; Bestandteile 4 × K + 2 × Kurve 1/90° | nein | niedrig | Karton Mach 8 |

Nicht im M1-Katalog: siehe Nicht-Ziele.

## Akzeptanzkriterien

### Kern: Lage berechnen (`src/core`)

- **REQ-CORE-1** [When] Wenn der Kern ein Layout aus platzierbaren Teilen (und gültigen
  Querungen, REQ-CORE-24) mit einer Startpose verfolgt, liefert er die Pose nach jedem Element
  und die Endpose, alle Koordinaten exakt in der
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
- **REQ-CORE-7** [When] Wenn in einem Layout ohne Querung eine Gerade 342 durch die Folge
  Gerade 114, Anschlussstück, Rundenzähler (3 × 114 = 342) oder durch eine Kreuzung (deren
  Längsweg, ohne Querung) ersetzt wird, bleibt die Endpose exakt gleich.
- **REQ-CORE-8** [When] Wenn ein Layout aus einer anderen Startpose verfolgt wird (Verschiebung
  um beliebige Koordinaten des darstellbaren Rasters, Drehung um beliebige Vielfache von 45°),
  dann ist jede Pose der Spur genau die gleich verschobene und gedrehte Pose der ursprünglichen
  Spur. Das gilt auch für Layouts mit Tausenden Elementen und große Verschiebungen (kein
  Genauigkeitsverlust) und für Layouts mit Querungen (die Queranschlüsse wandern mit; eine
  gültige Querung bleibt gültig).
- **REQ-CORE-9** [When] Wenn in einem Layout jede Kurve ihre Richtung tauscht (links ↔ rechts),
  dann ist die Spur das Spiegelbild an der Startachse. Das gilt auch mit Querungen: Ankunft am
  linken Queranschluss wird zur Ankunft am rechten und umgekehrt.

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
  Ergebnis nie geschlossen: Bei Layouts ohne Querung ist es offen; bei Layouts mit Querung ist es
  offen oder meldet einen Fehler nach REQ-CORE-25 bis REQ-CORE-27 (z. B. Ankunft verschoben,
  Kreuzung entfernt).
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
- **REQ-CORE-18** [If/Then] Fehlt bei einer Kurve die Richtung, meldet die Verfolgung einen
  Fehler „Richtung fehlt“; trägt ein Nicht-Kurven-Teil eine Richtung, meldet sie einen Fehler
  „Richtung überzählig“. Das sind zwei unterscheidbare Fehlerarten, jeweils mit Index und
  Teil-ID.
- **REQ-CORE-19** [Contract] Fehler sind Rückgabewerte des Kerns (unterscheidbares Ergebnis), keine
  geworfenen Ausnahmen. Es werden alle fehlerhaften Elemente gemeldet, nicht nur das erste; für
  Ankunftsfehler an Querungen gilt die Einschränkung aus REQ-CORE-28.

### Kern: Kreuzung und Querung

- **REQ-CORE-23** [When] Wenn eine Kreuzung aus einer Eingangspose (p, k) verfolgt wird, ist ihre
  Ausgangspose die einer Gerade 342 aus derselben Pose (Längsweg), und der Kern liefert zu diesem
  Element die beiden Queranschlüsse wie unter „Begriffe“ definiert. Beispiel: Eingang (0, 0, k = 0)
  ergibt Ausgang (342, 0, k = 0), linken Queranschluss (171, 57, k = 6), rechten
  (171, −57, k = 2); Eingang (0, 0, k = 1) ergibt Queranschlüsse
  (57·√2, 114·√2, k = 7) links und (114·√2, 57·√2, k = 3) rechts.
- **REQ-CORE-24** [When] Wenn eine Querung verfolgt wird, deren Ankunftspose (Ausgang des
  vorigen Elements) exakt — Position und Richtung — gleich einem Queranschluss der verwiesenen
  Kreuzung ist, dann ist ihre Ausgangspose der gegenüberliegende Queranschluss als Position mit
  unveränderter Richtung (also 114 mm in Fahrtrichtung verschoben). Beispiel zur Kreuzung mit
  Eingang (0, 0, k = 0): Ankunft (171, −57, k = 2) ergibt Ausgang (171, 57, k = 2); Ankunft
  (171, 57, k = 6) ergibt (171, −57, k = 6).
- **REQ-CORE-25** [If/Then] Verweist eine Querung auf eine Element-ID, die es im Layout nicht
  gibt, auf ein Element, das keine Kreuzung ist (anderer Katalogeintrag oder selbst eine Querung),
  oder auf ein Element an gleicher oder späterer Position, meldet die Verfolgung einen Fehler
  „ungültiger Verweis“ mit Position der Querung, Element-ID der Querung und verwiesener ID.
- **REQ-CORE-26** [If/Then] Verweisen zwei oder mehr Querungen auf dieselbe Kreuzung, bleibt die
  erste (früheste Position) gültig, und jede weitere meldet einen Fehler „Kreuzung bereits
  gequert“ mit ihrer Position, ihrer Element-ID und der verwiesenen ID — und nur diesen: Eine
  weitere Querung wird nicht auf ihre Ankunft geprüft, auch wenn die Ankunft zufällig an einem
  Queranschluss läge oder nicht.
- **REQ-CORE-27** [If/Then] Ist die Ankunftspose einer Querung mit gültigem Verweis nicht exakt
  gleich einem der beiden Queranschlüsse, meldet die Verfolgung einen Fehler „Ankunft nicht am
  Queranschluss“ mit Position, Element-ID, verwiesener ID und der tatsächlichen Ankunftspose. Das
  gilt ohne Toleranz und auch, wenn nur die Richtung abweicht (z. B. Ankunft an der Position des
  rechten Queranschlusses mit Richtung k+6, also aus der Kreuzung heraus, oder längs).
- **REQ-CORE-28** [Contract] Fehler nach REQ-CORE-16, -17, -18, -25, -26 und -29 werden für alle
  betroffenen Elemente gemeldet, unabhängig voneinander. Ein Element mit einem dieser Fehler ist
  **fehlerhaft**. Ein Ankunftsfehler (REQ-CORE-27) wird für eine Querung genau dann beurteilt,
  wenn sie selbst nicht fehlerhaft ist und alle Elemente vor ihr fehlerfrei verfolgt sind; sonst
  ist ihre Ankunftspose unbestimmt und wird weder als richtig noch als falsch gemeldet. Eine
  fehlerhafte Querung meldet also nie zusätzlich einen Ankunftsfehler, und ab dem ersten
  fehlerhaften Element (auch einem mit doppelter Element-ID) wird keine Ankunft mehr beurteilt.
  Daher gibt es höchstens einen Ankunftsfehler je Verfolgung.
- **REQ-CORE-29** [If/Then] Tragen zwei oder mehr Elemente dieselbe Element-ID, meldet die
  Verfolgung einen Fehler „doppelte Element-ID“ mit der ID und allen Positionen, an denen sie
  vorkommt. Alle Elemente mit dieser ID sind fehlerhaft im Sinne von REQ-CORE-28; ab dem ersten
  von ihnen wird keine Ankunft mehr beurteilt. (Das Schema weist solche Layouts schon beim
  Dekodieren ab, REQ-SCHEMA-5; der Kern meldet es trotzdem selbst, damit er für jede Eingabe
  definiert ist.)
- **REQ-CORE-30** [When] Abnahmefall Acht aus dem Bestand. Das Layout aus der Tabelle „Acht“ unten
  (Kreuzung, 3 × Kurve 1/90° rechts, Gerade 114, Querung, Anschlussstück, 3 × Kurve 1/90° links)
  ist geschlossen, aus beliebiger Startpose und auch gespiegelt (alle Kurvenrichtungen getauscht).
  Jede Zwischenpose stimmt mit der Tabelle überein (Startpose (0, 0, k = 0)). Sein Verbrauch ist
  Kreuzung = 1, Kurve 1/90° = 6, Gerade 114 = 1, Anschlussstück = 1, sonst 0.
- **REQ-CORE-31** [If/Then] Gegenfälle zur Acht, jeweils nie geschlossen:
  (a) Gerade 114 (Nr. 5) durch Gerade 171 ersetzt: Fehler „Ankunft nicht am Queranschluss“ an
  Nr. 6 mit Ankunftspose (171, 0, k = 2);
  (b) Querung (Nr. 6) entfernt: offen, Versatz Ende → Start (0, 114), Winkel 0;
  (c) Querung verweist auf Nr. 2 (Kurve): Fehler „ungültiger Verweis“;
  (d) eine zweite Querung auf dieselbe Kreuzung direkt hinter Nr. 6 eingefügt: genau ein Fehler,
  „Kreuzung bereits gequert“ an der zweiten Querung, kein Ankunftsfehler;
  (e) Querung an Position 1 vor die Kreuzung verschoben (Verweis auf die nun spätere Kreuzung):
  Fehler „ungültiger Verweis“.

#### Acht (Abnahmefall zu REQ-CORE-30)

Startpose (0, 0, k = 0). Element-IDs frei wählbar, hier e1 … e10. Pose = Ausgang nach dem Element.
Kurven R 171, 90°; „rechts“ = Mittelpunkt 171 rechts der Eingangsposition.

| Nr. | ID | Element | Mittelpunkt / Rechnung | Pose danach (x, y, k) |
|---|---|---|---|---|
| – | – | Start | – | (0, 0, 0) |
| 1 | e1 | Kreuzung (längs) | +342 in k = 0; Queranschlüsse links (171, 57, k = 6), rechts (171, −57, k = 2) | (342, 0, 0) |
| 2 | e2 | Kurve 1/90° rechts | M (342, −171) | (513, −171, 6) |
| 3 | e3 | Kurve 1/90° rechts | M (342, −171) | (342, −342, 4) |
| 4 | e4 | Kurve 1/90° rechts | M (342, −171) | (171, −171, 2) |
| 5 | e5 | Gerade 114 | +114 in k = 2 | (171, −57, 2) = rechter Queranschluss von e1 |
| 6 | e6 | Querung → e1 | gegenüberliegender Anschluss, Richtung bleibt | (171, 57, 2) |
| 7 | e7 | Anschlussstück | +114 in k = 2 | (171, 171, 2) |
| 8 | e8 | Kurve 1/90° links | M (0, 171) | (0, 342, 4) |
| 9 | e9 | Kurve 1/90° links | M (0, 171) | (−171, 171, 6) |
| 10 | e10 | Kurve 1/90° links | M (0, 171) | (0, 0, 0) = Start, geschlossen |

Gespiegelt (Kurven links ↔ rechts): Posen nach Nr. 1 … 10 sind (342, 0, 0), (513, 171, 2),
(342, 342, 4), (171, 171, 6), (171, 57, 6) = linker Queranschluss, (171, −57, 6), (171, −171, 6),
(0, −342, 4), (−171, −171, 2), (0, 0, 0).

Gesamtdrehung: −270° + 270° = 0. Teile aus dem Bestand: 1 von 1 Kreuzung, 6 von 8 Kurven 1/90°,
1 von 1 Gerade 114, 1 von 1 Anschlussstück. Gerade 114 und Anschlussstück sind gegeneinander
oder gegen den Rundenzähler tauschbar (alle drei Gerade 114). Die Rechnung ist zusätzlich per
Skript nachvollzogen; das Skript ist nicht Teil des Repos und kein Test. Ob die Acht ohne
Überschneidung baubar ist, prüft M1 nicht (Entscheidung 1); nach Lage der Bänder (114 mm breit)
berühren sich die beiden Schleifen nur an der Kreuzung.

### Teileverbrauch

- **REQ-CORE-20** [When] Wenn der Verbrauch eines Layouts berechnet wird, liefert der Kern je
  Katalogeintrag die Anzahl der verbrauchten Teile. Baugruppen werden in ihre Bestandteile
  aufgelöst und selbst nicht gezählt. Beispiel: 1 × Steilkehre + 1 × Kurve 1/90° ergibt
  Kurve 1/90° = 3, Steilkehre-Teil (K) = 4; 1 × Looping ergibt Looping-Teil (L) = 8. Eine
  Querung verbraucht nichts; die Kreuzung zählt einmal, egal ob sie gequert wird.
- **REQ-CORE-21** [If/Then] Der Verbrauch braucht keine Geometrie: er ist auch für Layouts mit
  nicht platzierbaren Einträgen definiert. Unbekannte Teil-IDs ergeben einen Fehler wie in
  REQ-CORE-16. Der Verbrauch zählt nur Teile: Richtungen (fehlend oder überzählig,
  REQ-CORE-18) werden nicht geprüft und erzeugen keinen Fehler. Querungen tragen nichts bei; ihre
  Verweise und Element-IDs werden für den Verbrauch nicht geprüft.
- **REQ-CORE-22** [Contract] Der Verbrauch ist unabhängig von Reihenfolge, Kurvenrichtung und
  Element-IDs, und der Verbrauch zweier hintereinandergehängter Layouts ist die Summe der
  Einzelverbräuche.

### Katalog (`src/catalog`)

- **REQ-CAT-1** [Where] Der Katalog enthält genau die Einträge der Tabelle „Katalog M1“ mit den
  dort genannten Geometrien, Platzierbarkeiten und Bestandteilen.
- **REQ-CAT-2** [Contract] Jeder Katalogeintrag hat eine stabile, eindeutige ID, einen Namen,
  Art.-Nr. (eine oder mehrere, oder ausdrücklich „keine eigene“), Quelle und Sicherheit
  (hoch/mittel/niedrig). Art.-Nr. ist immer die volle Nummer des Einzelartikels, wie sie auf dem
  Karton und auf carrera-toys.com steht: genau 8 Ziffern, als Zeichenkette (z. B. „20061602“).
  Nie ein Verweis auf ein Set, in dem das Teil steckt, nie eine Kurzform (nicht „61602“).
- **REQ-CAT-3** [Contract] Jeder Katalogeintrag besteht die Prüfung gegen das Katalog-Schema
  (REQ-SCHEMA-1).
- **REQ-CAT-4** [Contract] Bestandteile einer Baugruppe verweisen nur auf vorhandene
  Katalogeinträge, mit Anzahl ≥ 1; eine Baugruppe enthält keine Baugruppe.
- **REQ-CAT-5** [Contract] Jede Geometrie eines platzierbaren Eintrags führt nur auf Endpunkte im
  darstellbaren Raster: Geradenlängen, Radien sowie Längs- und Querweg der Kreuzung sind
  Vielfache von 57 mm, Winkel 45° oder 90°; der Querweg ist höchstens so lang wie der Längsweg,
  und die halbe Längs- und halbe Querweglänge liegen auf dem darstellbaren Raster.

### Datenvertrag (`src/schema`, Effect Schema)

- **REQ-SCHEMA-1** [Contract] Es gibt ein Schema für Katalogeinträge, das die Felder aus
  REQ-CAT-2 und die Geometriearten Gerade (Länge), Kurve (Radius, Winkel 45° oder 90°),
  Kreuzung (Längslänge, Querweglänge; Queranschlüsse mittig, senkrecht), „Maße fehlen“ und
  Baugruppe (Bestandteile, Maße fehlen) beschreibt. Ein Eintrag ohne Quelle, ohne
  Sicherheit, mit einem anderen Kurvenwinkel oder mit einer Art.-Nr., die nicht aus genau
  8 Ziffern besteht, wird abgewiesen.
- **REQ-SCHEMA-2** [Contract] Es gibt ein Schema für Layouts: Schema-Version und geordnete Liste
  von Elementen. Jedes Element hat eine Element-ID (nicht leere Zeichenkette) und ist entweder
  ein Teil-Element (Teil-ID, bei Kurven Richtung links/rechts) oder eine Querung (Verweis auf eine
  Element-ID, sonst nichts).
- **REQ-SCHEMA-3** [If/Then] Ein Layout mit fehlender oder fremder Schema-Version, mit
  unbekannten Zusatzfeldern oder mit falsch getypten Feldern wird beim Dekodieren mit Fehler
  abgewiesen, nicht still bereinigt („alte Layouts scheitern laut“).
- **REQ-SCHEMA-4** [Contract] Kodieren und anschließendes Dekodieren eines gültigen Layouts und
  eines gültigen Katalogeintrags ergibt denselben Wert.
- **REQ-SCHEMA-5** [If/Then] Ein Layout mit doppelter oder leerer Element-ID, mit einer Querung,
  die zusätzlich Teil-ID oder Richtung trägt, oder mit einem Teil-Element, das zusätzlich einen
  Verweis trägt, wird beim Dekodieren mit Fehler abgewiesen. Ob ein Verweis auf eine frühere
  Kreuzung zeigt und ob die Ankunft passt, prüft nicht das Schema, sondern der Kern
  (REQ-CORE-25 bis REQ-CORE-27).

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
   Für die spätere Überschneidungs-Spec festgehalten (Konzept): Die Kreuzung ist die einzige
   erlaubte unmarkierte Überschneidung — Längs- und Querweg derselben Kreuzung schneiden sich
   gewollt.
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
4. **Querung verweist per Element-ID, nicht per Index.** Jedes Element bekommt eine im Layout
   eindeutige ID. Grund: Der Editor (M2) fügt ein, löscht und ersetzt mitten in der Kette; die
   Folgeteile rücken nach. Ein Index-Verweis müsste bei jeder solchen Änderung umgerechnet werden,
   und ein vergessenes Umrechnen zeigt still auf ein anderes Element — mit zwei Kreuzungen sogar
   auf eine andere gültige Kreuzung, ohne Fehler. Mit einer ID bleibt der Verweis beim Verschieben
   richtig, und das Löschen der Kreuzung meldet sich laut (REQ-CORE-25). Preis: jedes Element
   trägt ein zusätzliches Feld, das Schema muss Eindeutigkeit prüfen (REQ-SCHEMA-5), und der
   Editor muss IDs vergeben. Das Layout-Format später auf IDs umzustellen hieße eine neue
   Schema-Version, an der alle alten Layouts laut scheitern; deshalb jetzt.
5. **Interne Rasterung bleibt offen bis #1.** Das Konzept-Raster ist 57 mm = halbe Schienenbreite
   (passt auch zu einspurigen Elementen). Ob gemessene Blackbox-Werte für Looping und Steilkehre
   darauf liegen, zeigt erst die Vermessung (#1); erst dann wird entschieden, ob die interne
   Einheit bleibt oder feiner wird. Die Spec bleibt deshalb darstellungsunabhängig: nach außen
   rationale mm in der Form a + b·√2, geprüft wird die Wirkung. Ein späterer Wechsel der internen
   Einheit bricht so keinen Test. Gerundet wird nie (keine Toleranz durch die Hintertür).

## Nicht-Ziele (M1)

- Keine UI, kein Server, keine Persistenz, kein Deploy.
- Keine Überschneidungserkennung und keine Höhenmarkierung im Layout (siehe Entscheidung 1).
- Keine Bestandsverwaltung, kein Restzähler, keine Einkaufsliste, keine Set-Vorlagen (M3).
- Keine Gesamtlänge der Strecke. Bogenlängen enthalten π und passen nicht in a + b·√2. Sie kommt
  in M2 als gerundete Anzeige; Gleitkomma nur dort in der Anzeige, nie im Kern.
- Keine Blackbox-Geometrie für Looping/Steilkehre (Versatz + Drehung), solange #1 nicht vermessen
  ist (siehe Entscheidung 5).
- Keine Spurlängen je Spur und keine Einbaurichtung für Spurwechsel oder Kreuzung (der gerade
  Spurwechsel hat keine; Fairness ist „später“).
- Keine Querung durch andere Teile als die Kreuzung, keine Verzweigungen.
- Nicht im Katalog: Gerade 100 mm (bricht das 57-mm-Raster, nicht im Bestand),
  Steilkurve 2/45°, Mech. Spurwechsel, Schikane, Brücke, Sprungschanze, Stützen (nicht im
  Bestand, Geometrie unklar oder ohne Maße).
- Keine Performance-Zusage; die schnelle „schließt?“-Prüfung für die Zufallsstrecke ist „später“.
- Keine Darstellung in Dezimal-mm (Anzeige ist M2).

## Offene Fragen an den Menschen

Keine, die M1 blockiert. Zur Abnahme vorgelegt, weil neu entschieden statt vom Menschen
vorgegeben:

1. **Element-IDs für alle Elemente** (Entscheidung 4) statt Index-Verweis. Alternative wäre eine
   ID nur an Kreuzungen; das spart Felder, macht aber das Layout-Schema uneinheitlich.
2. **Richtung am Queranschluss zeigt hinein.** Eine Ankunft an der richtigen Position, aber aus
   der Kreuzung heraus oder längs gerichtet, ist ein Fehler (REQ-CORE-27). Das folgt aus „verlässt
   die Kreuzung am gegenüberliegenden Anschluss mit gleicher Richtung“, steht so aber nicht
   wörtlich im Konzept.

Außerhalb von M1, aber vermerkt: welcher Spurwechsel in Ausbauset 1 liegt (vermutlich der gerade
20061609, Kartonprüfung #2). Beide stehen im Katalog; es zählt erst für Bestand und Set-Vorlagen in
M3.

## Smoke

Aufrufer des geänderten Pfads: **keiner.** Nachgesehen am Basisstand `a0eb290` und erneut am
Branch-Stand `65ec16a` (unverändert): alle
`src/*/index.ts` sind Platzhalter (`src/web/index.ts:2`, `src/server/index.ts:2`,
`src/core/index.ts:2`, `src/catalog/index.ts:2`, `src/schema/index.ts:2`, jeweils `export {};`),
und kein Quelltext unter `src/` importiert etwas. Oberfläche (M2) und Backend (M3) gibt es noch
nicht; MCP oder andere Dienste rufen nichts auf.

Abnahme aus Nutzersicht ist deshalb der Mensch am Testlauf und am Katalog:

1. Der Mensch legt die Abnahmefälle REQ-CORE-13 (a)–(d) und die Acht (REQ-CORE-30) gedanklich
   bzw. auf dem Boden nach und findet sie in den Testnamen wieder; `pnpm test` ist grün, die
   Tests nennen die REQ-IDs. Die Acht auf dem Boden: Kreuzung, drei Kurven rechts, Gerade 114,
   quer durch die Kreuzung, Anschlussstück, drei Kurven links — sie muss ohne Spannung schließen.
2. Der Mensch vergleicht die Katalogtabelle mit dem Katalog im Code: jede Zeile mit Art.-Nr.,
   Maß, Quelle, Sicherheit vorhanden; Looping, Steilkehre, Steilkurve 1/45°, Wireless-Anschluss,
   K- und L-Teile sind als nicht platzierbar markiert.
3. Gegenfälle, die geschlossen bleiben müssen: Ein Layout mit Looping, Steilkehre oder
   Steilkurve 1/45° lässt sich nicht verfolgen (Fehler „nicht platzierbar“), sein Verbrauch aber
   berechnen. Ein Layout mit unbekanntem Feld oder fremder Version wird beim Dekodieren
   abgewiesen. Ein Layout, das um ein Teil verlängert wird, ist nicht mehr geschlossen. In der
   Acht: kürzere oder längere Gerade vor der Querung ergibt „Ankunft nicht am Queranschluss“,
   eine zweite Querung „Kreuzung bereits gequert“, ein Verweis auf eine Kurve „ungültiger
   Verweis“ (REQ-CORE-31).
4. Mutationsprobe (Konzept „Prüfen“): Radius der Kurve 1/90° auf 170 oder Winkel 45° auf 90°
   verfälschen, Queranschluss-Abstand 57 auf 114 oder 171 auf 114 setzen, Seiten der
   Queranschlüsse vertauschen — mindestens ein Test wird rot. `pnpm test:mutation` ohne überlebende Mutanten.

### Nach dem Deploy

Entfällt. M1 wird nicht ausgeliefert. Der erste in Produktion nachweisbare Fall ist mit M2/M4
fällig: das Oval und die Acht aus dem Bestand im Editor bauen, auf dem Boden nachstecken und
prüfen, dass „geschlossen“ im Editor mit dem echten Schluss übereinstimmt.
