# Recherche: Carrera GO!!! Geometrie und Bestand

Stand 2026-11-23. Quellen: carrera-toys.com/en-eu/products/2006xxxx (CT), offizielle
Bauanleitung Mach 8 (20062492, V04-01, 11.2022, als PDF bei CT), Händlerseiten.

## Geometrie

Carrera nennt Außenmaße, aber **keine Radien**. Die Radien sind abgeleitet; vier unabhängige
Maße passen auf < 1 mm, zwei auf 2–3 mm. **R1 am 2026-11-23 bestätigt:** zwei 1/90° als
Halbkreis, Mitte zu Mitte passt exakt eine 342-mm-Gerade → R1 = 171 mm. R2/R3 weiter abgeleitet.

- Schienenbreite: 114 mm (CT)
- Mittellinien-Radien: R1 = 171 mm, R2 = 285 mm, R3 = 399 mm (Innen/Außen jeweils ±57 mm)
- Kurvenwinkel bei GO!!!: **90° und 45°**. Eine 1/30-Kurve gibt es nicht (das ist Evolution/D132).
- Zwei 1/90° ergeben 180° mit 342 mm Mittellinien-Abstand, also genau eine lange Gerade.

Folge für den Rechenkern:

- Alle Maße außer der 100-mm-Geraden sind Vielfache von 57 mm
  (114 = 2·57, 171 = 3·57, 228 = 4·57, 342 = 6·57, R2 = 5·57, R3 = 7·57).
- Nur 90°-Kurven: alle Anschlusspunkte liegen exakt auf einem 57-mm-Raster.
- 45°-Kurven bringen √2 hinein und brechen das Raster. Exakt bleibt es mit Koordinaten der Form
  `a + b·√2` (a, b rational) — „geschlossen" ist dann ein exakter Vergleich, keine Toleranz.
- Toleranz der Steckverbindungen: keine Quelle gefunden, auch nicht auf go143.de. Eigene Messungen
  stehen in #27.
- Raster 57 mm = halbe Schienenbreite. Passt auch zu einspurigen Streckenelementen, die es laut
  Nutzer gibt (nicht im Bestand, Teile noch nicht identifiziert).

## Teile

Alle GO!!!-Strecken- und Zubehörartikel von carrera-toys.com (154 Seiten, Stand 2026-11-23, mit Widersprüchen der Herstellerseiten) stehen in [`carrera-go-katalog.md`](carrera-go-katalog.md).

| Teil | Art.-Nr. | Maße | Sicherheit |
|---|---|---|---|
| Gerade lang | 61602 | 342 × 114 | hoch |
| Gerade halb | 61656 | 171 × 114 | hoch |
| Gerade mittel | – (nur in Packung 20061658) | 114 × 114 | hoch |
| Gerade kurz | – (nur in Packung 20061658) | 100 × 114 | hoch |
| Kurve 1/90° | 61603 | 228 × 228 außen, R 171 | hoch (nachgemessen) |
| Kurve 1/45° | 61611 | Länge 161 | hoch |
| Kurve 2/45° | 61617 | 242 × 179 | hoch |
| Kurve 3/45° | 61645 | 323 × 211 | hoch |
| Steilkurve 1/45° | 61612 | 155 × 155, R 171, 45° wie Kurve 1/45° | hoch (nachgemessen 2026-11-28: vier Steilkurven zu 180° = 342 mm Mittenabstand, #1) |
| Steilkurve 2/45° | 61646 | 226 × 166, Radius unbekannt | mittel |
| Spurwechselkurve | 61655 | 228 × 228, deckungsgleich mit Kurve 1/90° | hoch (Nutzer bestätigt) |
| Spurwechsel gerade | 61609 | 228 × 114 (⅔ Standardgerade), keine Einbaurichtung | hoch (Nutzer bestätigt) |
| Mech. Spurwechsel | 61618 | 342 × 215 | mittel |
| Engstelle | 61610 | 228 × 114 | hoch |
| Schikane | 61647 | 2 Teile, zusammen 458 × 225 | hoch |
| Kreuzung | 61616 | 342 × 114, Querweg 114 mittig (Acht) | hoch (nachgemessen) |
| Anschlussstück | 61530 / 61666 | 114 × 114 | hoch (61666 nachgemessen) |
| Zeitnahme / Rundenzähler | 88107 | 114 × 114 | hoch (nachgemessen) |
| Wireless-Anschluss | aus 61676 | 114 × 114, Gerade 114 wie Anschlussstück | hoch (nachgemessen 2026-11-28, #1) |
| Looping | 61613 | 8 Teile, Maße unbekannt | niedrig |
| Brücke, Sprungschanze, Stützen | 61604, 61641, 61642 | ohne Maße | niedrig |

Kopierfehler auf CT, nicht übernehmen: 61645 nennt „30°" (gemeint 45°), 61609 nennt „4 Teile,
161 mm" (gemeint 2 × 228 mm), 61617 nennt „Gefälle 45°" (gemeint Kurvenwinkel).

## Fanseite go143.de

Geprüft 2026-11-25: „Joe's Carrera GO!!! Fanpage“, Maße auf
<https://www.go143.de/technische-daten-der-go/>. Die Seite sagt nicht, ob sie selbst gemessen
oder von Carrera übernommen hat. Sicherheit deshalb mittel, außer wo eigene Messungen dazu passen.

**Bestätigt unsere Werte:**

- Spurabstand 60 mm (schließt die Lücke „Spurabstand unbekannt“).
- Kurve 1/90°: Durchmesser innen 228, außen 456 mm → Mittellinie R1 = 171 mm.
  Kurve 2/45°: innen 456, außen 684 mm → R2 = 285 mm.
- Slotlängen passen zu Bögen mit Spuren bei R ± 30 mm (Abweichung höchstens 3,4 mm):

  | Kurve | Slot außen / innen (Seite) | gerechnet |
  |---|---|---|
  | 1/90° | 314 / 224 | 315,7 / 221,5 |
  | 1/45° | 157 / 112 | 157,9 / 110,7 |
  | 2/45° | 244 / 198 | 247,4 / 200,3 |

- Längen: Gerade 342, ⅓-Gerade 114 (auch Anschluss und Rundenzähler), Spurwechsel und
  Engstelle 228, Kreuzung 342 × 114.
- Die 100-mm-Gerade heißt dort „Ausgleichsgerade“, gebraucht „beim Verbauen von diagonalen
  Streckenführungen“.

**Neu:**

- Looping: ein Teil 284 mm, gesamt 1136 mm (= 4 × 284, also je Spur). Ob Bogenlänge oder Sehne,
  sagt die Seite nicht; daraus folgt ein Looping-Radius von etwa 181 mm (Bogen) oder 201 mm (Sehne).
  Nicht nachgemessen (#1).
- Flyover: 190 mm je Teil (nicht im Bestand).
- Steilkurven: „entsprechen weitgehend denen der entsprechenden Normalkurven“, keine Zahlen.
  Spricht für R1 bei der Steilkurve 1/45°, ersetzt keine Messung. Bestätigt durch Messung
  2026-11-28 (#1): vier Steilkurven 1/45° zu 180° ergeben 342 mm Mittenabstand wie zwei
  Kurven 1/90°, also R 171.
- Weiche: Slots innen 342 und 298 mm, außen 342 und 344 mm.

**Nicht auf der Seite:** Steckverbindungs-Toleranz, Steilkehre, achtstellige Artikelnummern
(nur die alten Set-Nummern 60100–60300), die 171-mm-Gerade, ein Streckenplaner.

## Bestand (Mach 8 + Ausbauset 1 + Ausbauset 3)

| Teil | Mach 8 | AS 1 | AS 3 | Summe |
|---|---|---|---|---|
| Gerade 342 | 4 | 2 | 8 | 14 |
| Gerade 114 | 1 | – | – | 1 |
| Kurve 1/90° | 6 | 2 | – | 8 |
| Kurve 1/45° | – | – | 4 | 4 |
| Steilkurve 1/45° | – | – | 4 | 4 |
| Spurwechsel | – | 2 | – | 2 |
| Engstelle | 1 | – | – | 1 |
| Kreuzung | 1 | – | – | 1 |
| Anschluss / Zeitnahme | 1 / 1 | – | – | 1 / 1 |
| Looping-Teile (L) | 8 | – | – | 8 (2 Spuren × 4) |
| Steilkehre-Teile (K) | 4 | – | – | 4 |

Belege: Mach 8 aus der Zeichnung der Anleitung, am Karton bestätigt (2026-11-23): genau eine
kurze Gerade, und die ist 114 mm. Sie gehört zu Art.-Nr. 20061658 (Packung mit 3 × 100 und
3 × 114 mm); dem Mach 8 liegt davon nur ein 114er bei, keine 100-mm-Gerade. Kurze Gerade + Zeitnahme + Anschluss = 3 × 114 = 342 mm, eine lange Gerade.
Damit liegt der ganze Bestand auf dem 57-mm-Raster; nur die 45°-Kurven brauchen √2. Die Gerade 100
liegt nicht darauf; der Kern rechnet in Viertel-Millimetern und braucht das Raster nicht
(Katalog: Packung 20061658 als Set-Vorlage, beide Geraden ohne eigene Nummer, siehe #34).
Ausbauset 1 nur über Händler, Ausbauset 3 von CT (dort als „Digital 143" gelabelt, Teile
kompatibel). Wireless Upgrade Kit: Wireless-Anschlussschiene (CT-Einzelartikel 20061673, nicht das normale Anschlussstück) + 2 Regler, keine weiteren Schienen.

**Teile K und L am Karton geklärt (2026-11-23):** L sind die 8 Looping-Teile, 2 Spuren zu je 4.
K sind 4 kürzere gebogene Teile, etwa halb so lang wie ein Looping-Teil. Mit ihnen werden oben
zwei normale 1/90°-Kurven als hohe, steile 180°-Kehre angesteckt. Die Kehre verbraucht also
zwei Kurven aus dem Bestand.

**Kreuzung und Spurwechsel (2026-11-23):** Die Kreuzung ist für eine Acht gedacht; das
Mach-8-Layout ist laut Anleitung vereinfacht eine Acht. Querarme mittig oben und unten,
Schienenbreite nachgemessen genau 114 mm, also Querweg 114 mm. Der Spurwechsel in Ausbauset 1 ist
vermutlich der gerade 61609 (228 mm, ohne Einbaurichtung).

**Looping (2026-11-23, Angabe Tobias):** 8 Viertelkreis-Teile, jedes eine Spur breit; je 4 bilden
einen einspurigen Looping, zwei nebeneinander den zweispurigen. Im Mach-8-Aufbau ist der Ausgang
114 mm seitlich zum Eingang versetzt, damit davor und danach Standardstücke passen. Abstand nach
vorn noch offen (#1). Einspurige Teile gibt es auch als Set 20061657 (8× einspurige Kurve 45°,
4× einspurige Gerade 342), nicht im Bestand (#7).

**Noch an der echten Packung prüfen:** Inhalt Ausbauset 1 (Spurwechsel gerade oder Kurve).

## Vorhandene Planer

- **Autorennbahnplaner** (slotcar-union.com): kennt GO!!!, Bestandsliste mit benutzt/übrig,
  Höhen, 3D. Desktop (PC/Mac), kostenpflichtig, ca. 25 € (ungeprüft), Demo verfügbar.
- RailModeller (Mac): soll GO!!! kennen, nicht geprüft.
- Race Track Lab (Browser, kostenlos): 1:43 laut Artikel vom April 2026 noch nicht unterstützt.

Kein kostenloser Browser-Editor speziell für GO!!! gefunden.

## Offene Lücken

1. R2/R3 nur abgeleitet (nicht im Bestand, daher unkritisch).
2. Spurabstand 60 mm laut go143.de, nicht nachgemessen.
3. ~~Radius der Steilkurven unbekannt~~ Erledigt für die Steilkurve 1/45°: R 171, nachgemessen
   2026-11-28 (#1). Steilkurve 2/45° weiter ohne Radius (nicht im Bestand).
4. Maße von Loop, Steilkehre (Lage des Ausgangs relativ zum Eingang), Brücke, Sprungschanze
   fehlen.
5. Streckenlänge Mach 8 (5,3 m laut CT) nicht nachgerechnet.
