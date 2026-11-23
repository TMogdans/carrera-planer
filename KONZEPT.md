# Konzept: carrera-planer

**Status: abgenommen am 2026-11-23.** Dieses Dokument ist die Wurzel. Spätere
Änderungen werden vor dem Weiterbauen abgenommen.

## Ziel

Ein Streckenplaner für unsere Carrera GO!!!-Bahn, den wir zu zweit im Browser benutzen (Laptop,
Tablet, Handy). Er läuft auf dem Raspi im Heimnetz und ist von unterwegs per VPN erreichbar.

Nicht-Ziele: andere Carrera-Systeme, 3D-Ansicht, Login, Veröffentlichung im Internet.

## Modi

| Modus | Verhalten |
|---|---|
| **Bestand** | Die Teileleiste bietet nur, was wir besitzen, mit Restzähler. Ist ein Teil aufgebraucht, ist es gesperrt. |
| **Sandbox** | Alle bekannten Teile in beliebiger Zahl. Dazu eine Einkaufsliste: benötigt minus vorhanden, je Teiletyp. |

Ein Layout wird nicht an einen Modus gebunden. Ein Sandbox-Entwurf lässt sich jederzeit gegen den
Bestand prüfen und umgekehrt.

**Bestand pflegen:** Zähler je Teiletyp, dazu Set-Vorlagen zum Anklicken (Mach 8, Ausbauset 1,
Ausbauset 3, Wireless Kit), die ihren Inhalt auf den Bestand addieren.

## Geometrie

Grundlage: [docs/recherche.md](docs/recherche.md). R1 = 171 mm ist nachgemessen.

**Modell.** Jedes Teil hat einen Eingang und einen Ausgang. Ein Layout ist eine **geordnete Folge
von Teilen**; der Ausgang des einen ist der Eingang des nächsten. Verzweigungen gibt es bei GO!!!
analog nicht: Spurwechsel und Kreuzung tauschen nur die Spuren innerhalb eines Teils. Eine Kurve
hat zusätzlich eine Richtung (links/rechts).

**Exakte Rechnung statt Toleranz.** Alle Richtungen sind Vielfache von 45°. Sinus und Cosinus sind
damit immer 0, ±1 oder ±√2/2. Jede Koordinate lässt sich exakt als `a + b·√2` darstellen, mit
rationalen a, b und einem kleinen festen Nenner in Einheiten von 57 mm. Intern sind das ganze
Zahlen. „Geschlossen“ heißt: Endpunkt gleich Startpunkt und Endrichtung gleich Startrichtung —
ein exakter Vergleich ohne Millimeter-Toleranz.

**Geschlossen ist nicht gleich baubar.** Der Editor meldet zusätzlich:
- **Überschneidung:** zwei Teile liegen übereinander, obwohl keins davon als Brücke oder Loop
  markiert ist.
- **Offen:** Lücke zwischen Ende und Start, angezeigt als Versatz in mm und Winkel.

**Baugruppen.** Manche Elemente bestehen aus mehreren Katalogteilen. Beispiel Steilkehre: 4
K-Teile plus zwei normale 1/90°-Kurven, die oben als steile 180°-Kehre angesteckt werden. Im
Editor ist eine Baugruppe ein einzelnes Element mit Eingang und Ausgang; im Bestand verbraucht
sie alle ihre Teile. Die Steilkehre nimmt also zwei der acht 1/90°-Kurven weg. Auch der Looping
ist eine Baugruppe (8 L-Teile).

**Höhe** gibt es in Version 1 nur als Markierung (Teil ist erhöht / ist Brücke / ist Loop). Eine
markierte Überschneidung ist erlaubt, eine unmarkierte ist ein Fehler.

**Teile mit unbekannten Maßen** (Looping, Steilkehre, Steilkurve 1/45°, Wireless-Anschluss) gehen als Blackbox ein:
Versatz und Drehung zwischen Eingang und Ausgang, von uns gemessen. Bis dahin sind sie im Katalog
als „Maße fehlen“ gekennzeichnet und nicht verwendbar.

## Bedienung

- Teil aus der Leiste antippen → wird am offenen Ende angehängt. Kurve: Richtung umschaltbar.
- Teil in der Strecke auswählen → löschen, ersetzen, davor einfügen. Die Folgeteile rücken nach.
- Rückgängig/Wiederholen.
- Zoomen und Verschieben per Maus und Touch.
- Statusleiste: geschlossen/offen, Fehler, Teileverbrauch, Gesamtlänge.

## Architektur

| Teil | Wahl | Grund |
|---|---|---|
| Datenvertrag | Effect Schema für Katalog, Layout, Bestand, API | einmal definiert, in Frontend und Backend geprüft; alte Layouts scheitern laut statt still |
| Geometriekern | reines TypeScript-Modul, ohne UI, I/O und Effect-Laufzeit | reine Mathematik, Effect wäre nur Zeremonie |
| Teilekatalog | Daten, gegen das Schema geprüft, mit Quelle und Sicherheit je Maß | Recherche bleibt nachvollziehbar |
| Frontend | Vite + TypeScript, Preact, Darstellung in SVG; Effect nur als Schema | klein, React-ähnlich, SVG reicht für 2D |
| Backend | Node, `@effect/platform` (HttpApi), `@effect/sql-sqlite-node` | typisierte Fehler, API aus dem Schema; Muster wie in paperless-mcp |
| Deploy | Docker auf dem Raspi, eigener Port | kein Login, Heimnetz + VPN |

Gleichzeitiges Bearbeiten: Versionsnummer je Layout. Wer auf einer veralteten Version speichert,
bekommt einen Hinweis statt still überschrieben zu werden. Live-Mitbearbeitung ist kein Ziel.

## Prüfen

- Eigenschaftstests (fast-check, Generatoren aus dem Schema abgeleitet) für den Kern, zum Beispiel: acht 45°- oder vier 90°-Kurven
  derselben Richtung schließen exakt; ein Layout verschoben oder gedreht bleibt geschlossen;
  ein zusätzliches Teil öffnet ein geschlossenes Layout.
- Bekannte reale Layouts als Abnahmefälle: Oval aus Bestand; das Mach-8-Layout aus der Anleitung,
  sobald der Loop vermessen ist.
- Mutationsproben am Kern: Winkel oder Radius verfälschen, ein Test muss rot werden.

## Meilensteine

| | Inhalt | Ergebnis |
|---|---|---|
| M1 | Geometriekern + Teilekatalog | Tests, keine UI |
| M2 | Editor im Sandbox-Modus, Layout lokal im Browser | erste Strecken planbar |
| M3 | Backend, Bestand, Bestandsmodus, Einkaufsliste | Kern der Idee fertig |
| M4 | Deploy auf den Raspi | im Heimnetz nutzbar |
| später | Zufallsstrecke aus dem Bestand (#3), Drag & Drop im Editor (#4), Leaderboard für Rennzeiten, später mit digitalem Rundenzähler (#5), Spurlängen je Spur (Fairness), Tischmaß-Prüfung, „Strecke schließen“-Vorschlag, Einkaufsliste in kaufbaren Packungen, Höhen genauer | – |

**Zufallsstrecke.** Ein aus dem Schema abgeleiteter Generator liefert *formal gültige* Layouts,
aber fast nie *geschlossene*. Eine Zufallsstrecke zum Nachbauen braucht deshalb eine eigene Suche:
zufällige Teilefolgen aus dem Bestand, die exakt schließen und sich nicht unmarkiert überschneiden.
Der exakte Kern macht das „schließt?“ billig. Interessant wird es mit deutlich mehr Teilen.

## Arbeitsweise

- Rechenkern (M1): devloop-Kette — Spec → Tests → Implementierung → Kritiker.
- Editor und Backend: freier pro Meilenstein, Fehler sind dort sichtbar.
- Offene Punkte und Ideen als GitHub-Issues in TMogdans/carrera-planer.

## Offen

1. Vermessen: Looping und Steilkehre (jeweils Lage des Ausgangs relativ zum Eingang auf dem
   Boden), Steilkurve 1/45° (Radius). → #1
2. Inhalt Ausbauset 1 am Karton bestätigen (Händlerangabe: 2× Kurve 1/90°, 2× Spurwechsel,
   2× Gerade 342). → #2
