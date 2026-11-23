# Recherche: Carrera GO!!! Geometrie und Bestand

Stand 2026-11-23. Quellen: carrera-toys.com/en-eu/products/2006xxxx (CT), offizielle
Bauanleitung Mach 8 (20062492, V04-01, 11.2022, als PDF bei CT), Händlerseiten.

## Geometrie

Carrera nennt Außenmaße, aber **keine Radien**. Die Radien sind abgeleitet; vier unabhängige
Maße passen auf < 1 mm, zwei auf 2–3 mm. **Vor dem Bau an einer echten Kurve nachmessen.**

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
- Toleranz der Steckverbindungen: keine Quelle gefunden.

## Teile

| Teil | Art.-Nr. | Maße | Sicherheit |
|---|---|---|---|
| Gerade lang | 61602 | 342 × 114 | hoch |
| Gerade halb | 61656 | 171 × 114 | hoch |
| Gerade mittel | 61658 | 114 × 114 | hoch |
| Gerade kurz | 61658 | 100 × 114 | hoch |
| Kurve 1/90° | 61603 | 228 × 228 außen, R 171 | Maß hoch, Radius mittel |
| Kurve 1/45° | 61611 | Länge 161 | hoch |
| Kurve 2/45° | 61617 | 242 × 179 | hoch |
| Kurve 3/45° | 61645 | 323 × 211 | hoch |
| Steilkurve 1/45° | 61612 | 155 × 155, Radius unbekannt | mittel |
| Steilkurve 2/45° | 61646 | 226 × 166, Radius unbekannt | mittel |
| Spurwechselkurve | 61655 | 228 × 228 | hoch |
| Spurwechsel gerade | 61609 | 228 × 114 | mittel |
| Mech. Spurwechsel | 61618 | 342 × 215 | mittel |
| Engstelle | 61610 | 228 × 114 | hoch |
| Schikane | 61647 | 2 Teile, zusammen 458 × 225 | hoch |
| Kreuzung | 61616 | 342 × 114 | hoch |
| Anschlussstück | 61530 / 61666 | 114 × 114 (61530) | hoch / unbekannt |
| Wireless-Anschluss | aus 61676 | unbekannt, vermutlich 114 × 114 | niedrig |
| Looping | 61613 | 8 Teile, Maße unbekannt | niedrig |
| Brücke, Sprungschanze, Stützen | 61604, 61641, 61642 | ohne Maße | niedrig |

Kopierfehler auf CT, nicht übernehmen: 61645 nennt „30°" (gemeint 45°), 61609 nennt „4 Teile,
161 mm" (gemeint 2 × 228 mm), 61617 nennt „Gefälle 45°" (gemeint Kurvenwinkel).

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
| Loop-Teile | 12 (8 L + 4 K) | – | – | 12, Zuordnung unklar |

Belege: Mach 8 aus der Zeichnung der Anleitung (CT listet andere Packungen, Widerspruch),
Ausbauset 1 nur über Händler, Ausbauset 3 von CT (dort als „Digital 143" gelabelt, Teile
kompatibel). Wireless Upgrade Kit: Anschlussstück + 2 Regler, keine weiteren Schienen.

**An der echten Packung prüfen:** Stückzahlen Mach 8 (insbesondere 100-/114-mm-Geraden),
Funktion der Teile K und L, Inhalt Ausbauset 1.

## Vorhandene Planer

- **Autorennbahnplaner** (slotcar-union.com): kennt GO!!!, Bestandsliste mit benutzt/übrig,
  Höhen, 3D. Desktop (PC/Mac), kostenpflichtig, ca. 25 € (ungeprüft), Demo verfügbar.
- RailModeller (Mac): soll GO!!! kennen, nicht geprüft.
- Race Track Lab (Browser, kostenlos): 1:43 laut Artikel vom April 2026 noch nicht unterstützt.

Kein kostenloser Browser-Editor speziell für GO!!! gefunden.

## Offene Lücken

1. Radien nur abgeleitet → nachmessen.
2. Spurabstand Mitte–Mitte unbekannt.
3. Radius der Steilkurven unbekannt.
4. Maße von Loop, Brücke, Sprungschanze, Zeitnahme, Wireless-Anschluss fehlen.
5. Streckenlänge Mach 8 (5,3 m laut CT) nicht nachgerechnet.
