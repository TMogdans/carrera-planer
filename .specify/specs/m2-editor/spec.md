# Spec: M2 — Editor im Sandbox-Modus, Layout lokal im Browser

Status: Entwurf, wartet auf Spec-Review (harter Stopp).
Grundlage: [KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23; Abschnitte „Ziel“, „Modi“,
„Geometrie“, „Bedienung“, „Architektur“, „Prüfen“, „Meilensteine“),
[docs/recherche.md](../../../docs/recherche.md), [constitution.md](../../constitution.md), die
abgenommene und umgesetzte Spec [M1](../m1-rechenkern/spec.md) und ihre API in `src/core`,
`src/catalog`, `src/schema` (Stand `3db7bc8`).

**Tier: T1** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` aus den geplanten
Pfaden `.specify/specs/m2-editor/spec.md`, `src/web/**` (Logik, Oberfläche, Tests,
`index.html`) und `vite.config.ts` gegen `.devloop/tier-map.json`: alle fallen unter `**` → T1.
Gegenprobe: derselbe Satz plus `src/schema/schema.ts` ergibt T3. Das Tier bleibt also nur T1,
solange M2 weder `src/schema` noch `src/core`, `src/catalog`, `src/server` berührt
(REQ-WARCH-2). Das autoritative Tier rechnet CI aus dem tatsächlichen Diff.

## User Story

Als Bahnbauer, der mit seiner Familie Carrera-GO!!!-Strecken plant, möchte ich im Browser auf
Laptop, Tablet oder Handy aus allen bekannten Teilen eine Strecke zusammentippen, sie ändern,
Schritte zurücknehmen und die Strecke auf dem Gerät speichern, und dabei jederzeit sehen, ob sie
exakt geschlossen ist, wo sie fehlerhaft ist, welche Teile sie verbraucht und wie lang sie ist —
damit ich eine Strecke erst am Bildschirm plane und sie dann auf dem Boden ohne Spannung
zusammenstecke.

## Begriffe und Konventionen

Konvention zur Prüfbarkeit, keine Domänenwahrheit. Alles Geometrische (Pose, Layout,
Element-ID, Teil-Element, Querung, Queranschluss, platzierbar, Fehlerarten) gilt wie in M1
definiert.

- **Sandbox:** Die Leiste bietet jedes platzierbare Katalogteil in beliebiger Zahl. Bestand,
  Restzähler und Einkaufsliste gibt es in M2 nicht (M3).
- **Startpose:** fest (0, 0, k = 0). Das erste Element beginnt im Ursprung und zeigt in +x. Die
  Startpose wird nicht gespeichert (sie gehört laut M1 nicht zum Layout).
- **Nummer:** Stelle eines Elements in der Folge für die Anzeige, ab 1 gezählt (Nummer = Kern-Index
  + 1).
- **Arbeitsstand:** die gerade bearbeitete Elementfolge. Dazu kommen Zustände, die nicht
  gespeichert werden: Auswahl, aktive Aktion, Leisten-Kurvenrichtung, Verlauf, Ansicht
  (Zoom/Verschiebung).
- **Befehl:** eine Operation, die die Elementfolge ändert (anhängen, Querung anhängen, löschen,
  ersetzen, davor einfügen, Richtung umschalten, neu, laden). Nur Befehle kommen in den Verlauf.
- **Auswahl:** höchstens ein ausgewähltes Element, angegeben über seine Element-ID.
- **Aktion:** bei bestehender Auswahl entweder keine, „Ersetzen“ oder „Davor einfügen“. Sie
  bestimmt, was ein Tipp auf ein Leistenteil bewirkt.
- **Erster Fehlerindex:** der kleinste Index über alle Fehler, die der Kern (`trace`) für die
  Elementfolge meldet; bei `doppelteElementId` zählt der kleinste ihrer Indizes. Ohne Fehler gibt
  es keinen.
- **Gezeichneter Abschnitt:** die Elemente vor dem ersten Fehlerindex, ohne Fehler die ganze
  Folge. Weil jede Fehlerart des Kerns nur von früheren Elementen abhängt (doppelte IDs vergibt
  der Editor nie, REQ-EDIT-17), ist dieser Abschnitt allein verfolgt fehlerfrei.
- **Offenes Ende:** die Endpose des Kerns, wenn die ganze Folge fehlerfrei ist; sonst unbestimmt.
- **Ungequerte Kreuzung:** Teil-Element mit Katalog-Geometrie `kreuzung`, auf das keine Querung
  der Folge verweist.
- **Nur Bestandteil:** Katalogeintrag mit Geometrie `masseFehlen`, der als Bestandteil einer
  Baugruppe vorkommt (heute Looping-Teil L und Steilkehre-Teil K). Aus dem Katalog abgeleitet,
  kein neues Feld.

## Aufteilung: Logik und Darstellung

Die Spec trennt zwei Schichten, weil sie verschieden prüfbar sind:

| Schicht | Inhalt | Ort (Vorschlag) | Nachweis |
|---|---|---|---|
| **Editor-Logik** | Zustand, Befehle, Auswahl, Verlauf, Status (aus dem Kern), Länge, gezeichneter Abschnitt, Zeichengeometrie als Zahlen, Speichern/Laden über eine Speicher-Schnittstelle | `src/web/editor/` | Unit- und Eigenschaftstests (Vitest, fast-check) in der Node-Umgebung, ohne DOM |
| **Darstellung/Bedienung** | Preact-Komponenten, SVG, Gesten, Tastatur, Dialoge, Seitenaufbau | `src/web/ui/`, `src/web/index.html`, `vite.config.ts` | Browser-Smoke (Abschnitt „Smoke“) |

Für die Darstellung gibt es keine automatisierten Tests in M2: Weder jsdom noch eine
Komponenten-Testbibliothek noch Playwright stehen in `package.json`, und eine neue Abhängigkeit
ist eine Änderung am geschützten Satz (siehe Entscheidung 5). Die Kriterien REQ-UI-* sind
deshalb so formuliert, dass ein Mensch sie im Browser abhaken kann; alles, was sich als Zahl
fassen lässt, steht in der Logik-Schicht.

## Akzeptanzkriterien

### Editor-Logik: Befehle (`src/web/editor`)

- **REQ-EDIT-1** [When] Wenn ein platzierbarer Katalogeintrag gewählt wird und keine Aktion aktiv
  ist, hängt der Editor ein neues Teil-Element mit diesem Eintrag an das Ende der Folge; eine Kurve
  bekommt die aktuelle Leisten-Kurvenrichtung, jedes andere Teil keine Richtung. Beispiel: aus der
  leeren Folge viermal Kurve 1/90° bei Leistenrichtung „links“ ergibt eine Folge, die der Kern
  als geschlossen meldet (REQ-CORE-13 (a)).
- **REQ-EDIT-2** [If/Then] Ist der gewählte Eintrag nicht platzierbar (Geometrie `masseFehlen`
  oder `baugruppe`) oder unbekannt, lässt ihn kein Befehl in die Folge (anhängen, ersetzen,
  davor einfügen): die Folge bleibt unverändert und der Verlauf bekommt keinen Eintrag.
- **REQ-EDIT-3** [When] Wenn die Leisten-Kurvenrichtung umgeschaltet wird (links ↔ rechts), gilt
  die neue Richtung für künftig eingefügte Kurven; die Folge bleibt unverändert und der Verlauf
  bekommt keinen Eintrag. Startwert beim Öffnen: „links“ (Vorschlag, Frage 8).
- **REQ-EDIT-4** [When] Wenn für ein ausgewähltes Kurven-Element „Richtung umschalten“ ausgelöst
  wird, tauscht genau dieses Element links ↔ rechts; Element-ID, Teil und Stelle bleiben. Für
  Nicht-Kurven und Querungen ist der Befehl nicht verfügbar und ändert nichts. Beispiel: im
  geschlossenen Oval (REQ-CORE-13 (c)) die erste Kurve umgeschaltet ergibt „offen“; Rückgängig
  ergibt wieder „geschlossen“.
- **REQ-EDIT-5** [When] Wenn das ausgewählte Element gelöscht wird, entfällt es; die Folgeelemente
  rücken um eine Stelle vor und behalten Element-ID und Reihenfolge. Danach ist das Element
  ausgewählt, das nun an derselben Stelle steht, sonst das neue letzte Element, bei leerer Folge
  keines (Vorschlag, Frage 11). Beispiel: im Oval die letzte Gerade 342 gelöscht ergibt „offen“,
  Lücke 342 mm, Winkel 0° (REQ-STAT-2).
- **REQ-EDIT-6** [When] Wenn bei aktiver Aktion „Ersetzen“ ein platzierbarer Eintrag gewählt
  wird, ersetzt der Editor das ausgewählte Element an derselben Stelle durch ein Teil-Element
  dieses Eintrags **mit derselben Element-ID**. Richtung: Sind altes und neues Element Kurven, bleibt
  die alte Richtung; sonst bekommt eine neue Kurve die Leistenrichtung, ein Nicht-Kurven-Teil
  keine. Danach bleibt das ersetzte Element ausgewählt, und die Aktion endet (ein Tipp = ein
  Ersetzen; Vorschlag, Frage 11). Ein ausgewähltes Querungs-Element lässt sich so durch ein Teil
  ersetzen.
- **REQ-EDIT-7** [When] Wenn bei aktiver Aktion „Davor einfügen“ ein platzierbarer Eintrag gewählt
  wird, fügt der Editor ein neues Teil-Element unmittelbar vor dem ausgewählten ein (Richtung wie
  REQ-EDIT-1). Auswahl und Aktion bleiben bestehen. Beispiel: ausgewählt X, dann A und B gewählt,
  ergibt die Folge … A, B, X … .
- **REQ-EDIT-8** [Contract] Nach Löschen, Ersetzen oder Einfügen an Stelle i sind die Posen aller
  Elemente vor i exakt unverändert, alle anderen Elemente behalten Element-ID, Inhalt und
  relative Reihenfolge, und Querungen behalten ihren Verweis. Beispiel: Vor Nr. 1 der Acht
  (M1-Tabelle „Acht“) eine Gerade 342 eingefügt: kein Fehler (die Querung bleibt gültig), Status
  „offen“, Versatz Ende → Start (−342, 0), Winkel 0°.
- **REQ-EDIT-9** [When] „Querung anhängen“ ist genau dann verfügbar, wenn die Folge nicht leer und
  fehlerfrei ist und das offene Ende exakt (Position und Richtung, ohne Toleranz) gleich einem
  Queranschluss einer ungequerten Kreuzung ist. Dann hängt der Befehl eine Querung mit neuer
  Element-ID und Verweis auf diese Kreuzung an (trifft das Ende mehrere, die früheste). Ob das
  Ende trifft, entscheidet der Kern (z. B. durch Probe-Verfolgung mit angehängter Querung), nicht
  eine eigene Geometrie des Editors. Sonst ist der Befehl nicht verfügbar und ändert nichts.
  Beispiele an der Acht: Folge Nr. 1–5 → verfügbar, Verweis auf e1; Folge Nr. 1–4 → nicht
  verfügbar; Folge Nr. 1–7 (bereits gequert) → nicht verfügbar.
- **REQ-EDIT-10** [If/Then] Eine Querung lässt sich nur am Ende anhängen; als Ziel von „Ersetzen“
  und „Davor einfügen“ ist sie nicht wählbar. Eine vorhandene Querung lässt sich auswählen,
  löschen und durch ein Teil ersetzen (REQ-EDIT-6).
- **REQ-EDIT-11** [If/Then] Wird eine Kreuzung gelöscht oder durch ein anderes Teil ersetzt, auf
  die eine Querung verweist, bleibt die Querung unverändert stehen; der Kern meldet dann
  „ungültiger Verweis“ und der Editor zeigt ihn an. Keine stille Kaskade (Vorschlag, Frage 5).
  Beispiel: Nr. 1 der Acht gelöscht → Fehler „ungültiger Verweis“ an Nr. 5, gezeichneter
  Abschnitt Nr. 1–4.
- **REQ-EDIT-12** [When] Wenn „Neu“ ausgelöst wird, wird die Folge leer und die Auswahl
  aufgehoben; das ist ein Befehl (rückgängig machbar).
- **REQ-EDIT-13** [When] Auswahl: Ein Element lässt sich über seine Element-ID auswählen, die
  Auswahl lässt sich zum vorigen oder nächsten Element der Folge bewegen (auch über Elemente
  außerhalb des gezeichneten Abschnitts) und aufheben. Eine Aktion lässt sich nur bei bestehender
  Auswahl setzen; Aufheben der Auswahl beendet die Aktion. Auswahl und Aktion ändern die Folge
  nicht und kommen nicht in den Verlauf.

### Editor-Logik: Verlauf und Element-IDs

- **REQ-EDIT-14** [When] Jeder Befehl, der die Folge tatsächlich ändert, legt genau einen
  Verlaufseintrag an. Rückgängig stellt die Folge exakt (einschließlich Element-IDs und
  Richtungen) auf den Stand vor dem Befehl zurück, Wiederholen auf den Stand danach. Ist das
  ausgewählte Element danach nicht mehr vorhanden, wird die Auswahl aufgehoben, sonst bleibt sie.
- **REQ-EDIT-15** [If/Then] Ein neuer Befehl nach einem Rückgängig verwirft alle wiederholbaren
  Schritte. Ohne Verlauf ist Rückgängig, ohne wiederholbare Schritte Wiederholen nicht verfügbar
  und ändert nichts. Ein Befehl, der nichts ändert (z. B. REQ-EDIT-2, Querung nicht verfügbar,
  Löschen ohne Auswahl), legt keinen Eintrag an.
- **REQ-EDIT-16** [Contract] Eigenschaft (fast-check, beliebige Befehlsfolgen aus allen Befehlen
  über dem Katalog): Nach n wirksamen Befehlen führt n-mal Rückgängig exakt zum Ausgangsstand und
  anschließend n-mal Wiederholen exakt zum Endstand. Der Verlauf ist innerhalb einer Sitzung
  unbegrenzt und wird nicht gespeichert (Vorschlag).
- **REQ-EDIT-17** [Contract] Eigenschaft: Jede Folge, die durch beliebige Befehlsfolgen
  einschließlich Laden, Rückgängig und Wiederholen entsteht, besteht die Dekodierung mit
  `LayoutSchema` (eindeutige, nicht leere Element-IDs). Eine neu vergebene Element-ID kommt weder
  in der aktuellen Folge noch in irgendeinem Stand des Verlaufs vor; das gilt auch nach dem Laden
  eines Layouts mit fremd gewählten IDs.

### Editor-Logik: Status

- **REQ-STAT-1** [If/Then] Der Status ist genau einer von „leer“, „geschlossen“, „offen“,
  „fehlerhaft“ und kommt ausschließlich aus `closure` des Kerns mit der Startpose: Liefert der
  Kern Fehler, ist er „fehlerhaft“, sonst der Kern-Status. Keine Rundung oder Anzeige-Zahl
  entscheidet über „geschlossen“.
- **REQ-STAT-2** [If/Then] Ist der Status „offen“, zeigt der Editor die **Lücke** als Betrag des
  Kern-Versatzes in mm, auf ganze mm gerundet, und den **Winkel** als Kern-Winkel × 45° in Grad
  mit Vorzeichen (positiv = das Ende müsste nach links gedreht werden). Rundet die Lücke auf 0 mm,
  obwohl der Status „offen“ ist und der Versatz nicht null, zeigt er „< 1 mm“, nie „0 mm“.
  Beispiele: 3 × Kurve 1/90° links → Lücke 242 mm, Winkel 90°; Oval ohne letzte Gerade 342 →
  Lücke 342 mm, Winkel 0°; Formatierung eines konstruierten Versatzes dx = 28,5·(99 − 70·√2) mm ≈
  0,14 mm, dy = 0 → „< 1 mm“. Gleiche Position, andere Richtung → „0 mm“ ist hier richtig, weil
  der Versatz exakt null ist; der Winkel zeigt die Abweichung.
- **REQ-STAT-3** [If/Then] Meldet der Kern Fehler, liefert der Editor für jeden Fehler einen
  Eintrag mit Nummer des betroffenen Elements (bei doppelter ID alle Nummern), Teil- bzw.
  Elementname und deutschem Text je Fehlerart (Vorschlag): „Teil unbekannt“, „Maße fehlen, nicht
  platzierbar“, „Kurvenrichtung fehlt“, „Richtung bei Nicht-Kurve“, „Querung verweist auf keine
  frühere Kreuzung“, „Kreuzung bereits gequert“, „Strecke kommt nicht am Queranschluss an“,
  „doppelte Element-ID“. Beispiel: Acht mit Gerade 171 statt Gerade 114 an Nr. 5 → genau ein
  Eintrag, Nr. 6, „Strecke kommt nicht am Queranschluss an“.
- **REQ-STAT-4** [When] Der Teileverbrauch kommt aus `consumption` des Kerns: je Katalogeintrag
  Name und Anzahl in Katalogreihenfolge, dazu die Summe. Er wird auch bei Fehlern angezeigt; nur
  wenn der Kern „Teil unbekannt“ meldet, zeigt der Editor „Verbrauch nicht bestimmbar“. Beispiel
  Acht: Kreuzung 1, Kurve 1/90° 6, Gerade 114 1, Anschlussstück 1, zusammen 9.
- **REQ-STAT-5** [When] Die **Gesamtlänge** ist die Summe der Mittellinienlängen: Gerade L, Kurve
  π·R·Winkel/180°, Kreuzung ihr Längsweg, Querung der Querweg der verwiesenen Kreuzung. Anzeige in
  Metern mit zwei Nachkommastellen und Komma (Vorschlag, Frage 9). Sie hängt nicht von
  Fehlern der Lage ab; hat ein Element keine bekannte Länge (unbekanntes oder nicht platzierbares
  Teil, Querung ohne Kreuzung als Ziel), zeigt der Editor „–“. Gleitkomma nur hier und in der
  Zeichengeometrie, nie für Status oder Querungsprüfung. Beispiele: Oval (REQ-CORE-13 (c)) →
  „1,76 m“ (684 + 342·π ≈ 1758,4 mm); Acht → „2,30 m“ (342 + 6 · 85,5·π + 3 · 114 ≈ 2295,6 mm).

### Editor-Logik: Zeichnen

- **REQ-EDIT-18** [When] Der Editor bestimmt den gezeichneten Abschnitt und dessen Posen über
  `trace` des Kerns; Elemente ab dem ersten Fehlerindex gelten als „nicht gezeichnet“, ihre Zahl
  wird geliefert. Beispiel: Acht mit Gerade 171 an Nr. 5 → gezeichnet Nr. 1–5, nicht gezeichnet
  5 Elemente (Nr. 6–10). Fehlerfreie Folge → alles gezeichnet.
- **REQ-EDIT-19** [When] Die Zeichengeometrie ist eine reine Funktion von Posen und Katalog auf
  Bildschirmkoordinaten (Gleitkomma, mm): Bildschirm-x = x, Bildschirm-y = −y, damit „links“
  (gegen den Uhrzeigersinn, M1) auch auf dem Bildschirm gegen den Uhrzeigersinn dreht. Die
  Umrechnung a + b·√2 → Zahl weicht höchstens 0,01 mm vom exakten Wert ab. Je Element liefert sie
  die Mittellinie (Strecke bzw. Kreisbogen mit Mittelpunkt und Radius) und das 114 mm breite Band
  darum; zu einer Kreuzung zusätzlich ihre Queranschlüsse. Beispiel: Kurve 1/90° links ab Start
  endet bei Bildschirm (171, −171), also oberhalb der Startlinie.

### Editor-Logik: Speichern und Laden

- **REQ-STORE-1** [Contract] Gespeichert wird über eine eingereichte Speicher-Schnittstelle mit
  dem Verhalten von Web Storage (`getItem`, `setItem`, `removeItem`, Schlüssel aufzählen); im
  Browser ist das `localStorage`, in Tests eine Attrappe. Jeder Wert ist der JSON-Text des mit
  `LayoutSchema` kodierten Layouts (`schemaVersion`, `elements`), sonst nichts. Das Schema wird
  dafür nicht erweitert; der Layoutname steckt im Schlüssel (Entscheidung 2).
- **REQ-STORE-2** [When] Nach jedem wirksamen Befehl sichert der Editor den Arbeitsstand
  automatisch unter einem festen Schlüssel; beim Start lädt er ihn von dort (Vorschlag, Frage 2).
- **REQ-STORE-3** [When] Speichern unter Namen: Der Name wird an den Rändern von Leerraum befreit
  und darf dann nicht leer sein. Existiert er schon, wird erst nach ausdrücklicher Bestätigung
  überschrieben. Die gespeicherten Namen lassen sich alphabetisch auflisten, ein gespeichertes
  Layout lässt sich nach Bestätigung löschen. Laden ersetzt die Folge (ein Befehl, rückgängig
  machbar) und hebt die Auswahl auf.
- **REQ-STORE-4** [Contract] Speichern und anschließendes Laden ergibt exakt dieselbe Folge
  (Element-IDs, Teile, Richtungen, Verweise), für beliebige vom Editor erzeugte Folgen
  (Eigenschaft).
- **REQ-STORE-5** [If/Then] Laden prüft den gespeicherten Text mit JSON-Parsen und
  `LayoutSchema`-Dekodierung. Scheitert eins davon (kein JSON, fehlende oder fremde
  Schema-Version, unbekanntes Zusatzfeld, falscher Typ, doppelte oder leere Element-ID), bleibt
  der Arbeitsstand unverändert, der Editor liefert eine Fehlermeldung mit Layoutname und Grund
  (Text der Schema-Prüfung), und der gespeicherte Wert wird weder verändert noch gelöscht. Nichts
  wird still bereinigt („alte Layouts scheitern laut“).
- **REQ-STORE-6** [If/Then] Besteht ein Layout das Schema, meldet der Kern aber Fehler (z. B.
  unbekanntes oder nicht platzierbares Teil, fehlende Richtung, ungültiger Verweis), wird es
  geladen und die Fehler erscheinen wie bei der Bearbeitung (REQ-STAT-3, REQ-EDIT-18).
- **REQ-STORE-7** [If/Then] Ist der automatisch gesicherte Arbeitsstand beim Start kaputt
  (REQ-STORE-5), startet der Editor mit leerer Folge und einer Meldung. Die automatische Sicherung
  überschreibt den kaputten Wert erst, nachdem der Mensch die Meldung mit „Verwerfen“ bestätigt
  hat; bis dahin sichert sie nicht und zeigt das an (Vorschlag, Frage 3).
- **REQ-STORE-8** [If/Then] Wirft der Speicher beim Lesen oder Schreiben (nicht verfügbar,
  voll, gesperrt), liefert der Editor eine Fehlermeldung; die Folge im Speicher der Seite bleibt
  erhalten, und der Editor bleibt bedienbar (keine unbehandelte Ausnahme).

### Editor-Logik: Leistung

- **REQ-EDIT-20** [Performance] Für eine fehlerfreie Folge mit 1000 Elementen dauert ein Befehl
  (Anhängen am Ende) samt Neuberechnung von Status, Fehlern, Verbrauch, Länge, gezeichnetem
  Abschnitt und Querungs-Verfügbarkeit im Vitest-Lauf (Node 22) **höchstens 250 ms im Maximum
  über 20 Durchläufe**; der Test gibt Maximum und Median aus.

### Darstellung und Bedienung (`src/web/ui`, Browser-Smoke)

- **REQ-UI-1** [Where] Die Seite besteht aus Zeichenfläche (SVG), Teileleiste, Statusleiste und
  den Knöpfen für Rückgängig, Wiederholen, Einpassen, Neu, Speichern/Laden. Sie ist ohne
  waagerechtes Scrollen der Seite bedienbar auf Laptop (1280 × 800), Tablet (768 × 1024 hoch und
  1024 × 768 quer) und Handy (360 × 740 hoch); die Leiste darf in sich scrollen. Antippbare Ziele
  sind mindestens 44 × 44 CSS-Pixel groß.
- **REQ-UI-2** [Where] Die Leiste zeigt alle platzierbaren Einträge in Katalogreihenfolge mit
  Namen und Symbol, den Kurvenrichtungs-Schalter mit sichtbarer aktueller Richtung und den
  Eintrag „Querung“, der nur aktiv ist, wenn REQ-EDIT-9 ihn verfügbar macht. Nicht platzierbare
  Einträge (Looping, Steilkehre, Steilkurve 1/45°, Wireless-Anschluss) erscheinen ausgegraut mit
  dem Hinweis „Maße fehlen“ und reagieren nicht auf Antippen. Einträge „nur Bestandteil“
  (L- und K-Teile) erscheinen nicht (Vorschlag, Frage 7).
- **REQ-UI-3** [Where] Die Zeichnung zeigt jedes Element des gezeichneten Abschnitts als 114 mm
  breites Band entlang der Mittellinie mit erkennbaren Teilgrenzen, Kurven als Ringsegmente, die
  Kreuzung mit sichtbarem Querweg und eine Querung als hervorgehobenes Band über diesem Querweg.
  Eine Startmarke und ein Pfeil am offenen Ende (in Fahrtrichtung) sind sichtbar. Die
  Queranschlüsse ungequerter Kreuzungen sind als Zielmarken eingezeichnet.
- **REQ-UI-4** [When] Antippen oder Klicken eines Teils in der Zeichnung wählt es aus (sichtbar
  hervorgehoben); Antippen leerer Fläche hebt die Auswahl auf. Bei Auswahl erscheint eine
  Auswahlleiste mit Nummer und Name sowie Löschen, Ersetzen, Davor einfügen, Richtung umschalten
  (nur bei Kurven), voriges/nächstes Element. Eine aktive Aktion ist sichtbar (z. B. „Ersetzen:
  Teil wählen“) und lässt sich abbrechen.
- **REQ-UI-5** [If/Then] Ist der Status „fehlerhaft“, zeichnet die Fläche den gezeichneten
  Abschnitt normal, setzt am Ende des Abschnitts eine rote Fehlermarke und zeigt „n Teile nicht
  gezeichnet“. Bei „Strecke kommt nicht am Queranschluss an“ werden zusätzlich die beiden
  Queranschlüsse der verwiesenen Kreuzung hervorgehoben. Die Statusleiste listet die Fehler
  (REQ-STAT-3); Antippen eines Fehlers wählt das betroffene Element aus, auch wenn es nicht
  gezeichnet ist (Vorschlag, Frage 6).
- **REQ-UI-6** [Where] Die Statusleiste zeigt den Status farblich unterschieden („leer“,
  „geschlossen“, „offen“ mit Lücke und Winkel, „Fehler (n)“), die Teilezahl mit aufklappbarer
  Verbrauchsliste (REQ-STAT-4) und die Gesamtlänge (REQ-STAT-5).
- **REQ-UI-7** [When] Zoomen und Verschieben: Mausrad zoomt um den Mauszeiger, Ziehen auf der
  Fläche verschiebt; mit Touch zoomt Zwei-Finger-Spreizen um den Mittelpunkt der Finger, ein
  Finger verschiebt. Ein Tipp ohne nennenswerte Bewegung wählt aus, ein Ziehen nicht. Gesten auf
  der Fläche zoomen nicht die ganze Seite. „Einpassen“ zeigt die ganze gezeichnete Strecke. Zoom
  und Verschiebung kommen nicht in den Verlauf. Verlässt das offene Ende beim Anhängen den
  sichtbaren Bereich, verschiebt sich die Ansicht so, dass es sichtbar bleibt, ohne den Zoom zu
  ändern (Vorschlag, Frage 12).
- **REQ-UI-8** [When] Rückgängig und Wiederholen sind als Knöpfe da, ausgegraut wenn nicht
  verfügbar, und per Tastatur Strg/Cmd+Z bzw. Strg/Cmd+Umschalt+Z (zusätzlich Strg+Y). Entf und
  Rücktaste löschen das ausgewählte Element, Esc hebt Auswahl und Aktion auf. Tastenkürzel wirken
  nicht, solange ein Texteingabefeld (z. B. Layoutname) den Fokus hat.
- **REQ-UI-9** [When] Speichern/Laden geschieht in einem Dialog mit Namensfeld, Liste der
  gespeicherten Layouts, Laden und Löschen. Fehlermeldungen (REQ-STORE-5, -7, -8) erscheinen
  sichtbar auf der Seite und bleiben stehen, bis der Mensch sie schließt; ein Eintrag nur in der
  Browser-Konsole reicht nicht.
- **REQ-UI-10** [Architektur] Die Anwendung lädt zur Laufzeit nichts aus dem Netz außer ihren
  eigenen Dateien (keine CDN, keine Schriftarten von außen), damit sie im Heimnetz und per VPN
  ohne Internet funktioniert.
- **REQ-UI-11** [Architektur] Die Anwendung startet aus dem Repo mit dem Vite-Dev-Server
  (`pnpm exec vite`, für Tablet und Handy im Heimnetz mit `--host`) ohne Änderung am geschützten
  Satz; `vite.config.ts` (nicht geschützt) bindet `@preact/preset-vite` ein (Frage 13).

### Architektur

- **REQ-WARCH-1** [Architektur] Die Editor-Logik (`src/web/editor`) nutzt weder Preact noch
  DOM-Globale (`window`, `document`, `localStorage` direkt); sie lädt und rechnet korrekt im
  Vitest-Lauf in der Node-Umgebung, wenn `preact` durch einen Stub ersetzt ist, der beim Laden
  wirft (Muster wie REQ-ARCH-1).
- **REQ-WARCH-2** [Architektur] Die M1-API bleibt unverändert: M2 ändert keine Datei unter
  `src/core`, `src/catalog`, `src/schema`, `src/server` und importiert aus ihnen nur über deren
  `index.ts`. Wirkungsnachweis: Das CI-Tier aus dem tatsächlichen Diff ist T1, und die
  M1-Testdateien laufen unverändert grün.
- **REQ-WARCH-3** [Architektur] Lage, Geschlossenheit, Queranschlüsse, Fehler und Verbrauch kommen
  ausschließlich vom Kern; der Editor bekommt den Katalog als Argument. Wirkungsnachweis: Mit einem
  im Test verfälschten Katalog (z. B. Kurve 1/90° mit Radius 285) folgt der Status des Editors
  dem Kern (das Oval aus REQ-CORE-13 (c) bleibt geschlossen, weil alle vier Kurven gleich
  verfälscht sind; dasselbe Oval mit einer Kurve 1/90° ersetzt durch 2 × Kurve 1/45° ist mit dem
  echten Katalog geschlossen (REQ-CORE-6), mit dem verfälschten offen), statt eigene Annahmen
  über Teile zu treffen.

## Entscheidungen zum Umfang

1. **Überschneidung: nicht in M2.** KONZEPT nennt sie als Editormeldung, M1 hat sie bewusst in
   eine eigene Kern-Spec verschoben (M1, Entscheidung 1), und die gibt es noch nicht. Eine
   Überschneidungsprüfung im Editor würde Geometrie außerhalb des Kerns erfinden und widerspräche
   REQ-WARCH-3. M2 zeigt deshalb keine Überschneidungsmeldung; die Statusleiste nennt
   „Überschneidung: nicht geprüft“, damit „geschlossen“ nicht als „baubar“ gelesen wird. Preis:
   eine geschlossene Strecke kann sich überschneiden, ohne dass der Editor warnt. Frage 1.
2. **Kein neues Schema, Name im Schlüssel.** Gespeichert wird genau das M1-`LayoutSchema`, der
   Name steckt im Speicherschlüssel (Präfix je Anwendung). Grund: Ein Hülltyp mit Name und
   Zeitstempel gehörte nach Constitution in `src/schema` und höbe M2 auf T3, ohne dass M2 ihn
   braucht. Preis: kein Speicherzeitpunkt, keine Namen mit Sonderbedeutung im Schlüssel; mit M3
   (Backend, Versionsnummer je Layout) kommt ohnehin ein eigenes API-Schema.
3. **Fehler im Bild über den fehlerfreien Anfang.** `trace` liefert bei Fehlern kein Teilergebnis
   (`src/core/trace.ts:175`, Vertrag `src/core/core.test.ts:32`). Statt die API zu ändern,
   verfolgt der Editor den Anfang bis vor den ersten Fehlerindex; der ist nach M1 stets
   fehlerfrei. Was danach kommt, ist laut M1 lageunbestimmt und wird nicht geraten.
4. **Querung nur anhängen, nur bei exakter Ankunft.** So entsteht beim Bauen nie eine fehlerhafte
   Querung; Zielmarken an den Queranschlüssen zeigen, wohin die Strecke muss. Fehlerhafte
   Querungen entstehen nur durch spätere Änderungen davor oder durch geladene Daten und werden dann
   laut gemeldet. Alternative: Querung immer anhängbar (auf die letzte ungequerte Kreuzung), Fehler
   bis zur Korrektur sichtbar. Frage 4.
5. **Nachweis der Darstellung per Browser-Smoke.** Komponenten- oder Browser-Tests bräuchten eine
   neue Abhängigkeit (jsdom/Testing Library/Playwright) und damit eine Admin-Änderung an
   `package.json`/Lockfile. Die Logik-Schicht trägt deshalb alles Zählbare. Mutationsproben: Der
   Stryker-Ratchet deckt nur `src/core|catalog|schema` ab (`stryker.config.json`, geschützt); für
   `src/web/editor` fährt der Critic Mutationsproben von Hand (Befehl verfälschen, zeigen welcher
   Test rot wird). Frage 10.
6. **Startpose fest.** Drehen oder Verschieben der ganzen Strecke ist für das Planen unnötig (die
   Ansicht ist zoom- und verschiebbar), und die Startpose gehört nicht zum Layout.

## Nicht-Ziele (M2)

- Drag & Drop im Editor (#4), Zufallsstrecke (#3).
- Backend, Bestand, Bestandsmodus, Restzähler, Einkaufsliste, Set-Vorlagen, Versionsnummer je
  Layout (M3). Deploy auf den Raspi (M4).
- Teilen zwischen Geräten: `localStorage` gilt je Browser und Adresse. Was auf dem Tablet
  gespeichert ist, sieht das Handy nicht (kommt mit M3). Kein Datei-Export/-Import (Frage 2).
- Überschneidungserkennung und Höhenmarkierung (Entscheidung 1).
- Querung einfügen mitten in der Folge, Teile drehen oder spiegeln als Ganzes, Startpose ändern.
- Spurlängen je Spur, Tischmaß-Prüfung, „Strecke schließen“-Vorschlag.
- Änderungen an M1-API, Katalog oder Schema.

## Offene Fragen an den Menschen

KONZEPT beantwortet diese Punkte nicht; die Spec enthält jeweils den Vorschlag.

1. **Überschneidung in M2?** Vorschlag: nein (Entscheidung 1); die Statusleiste zeigt
   „Überschneidung: nicht geprüft“. Die Überschneidungs-Spec für den Kern (T2, eigene devloop-Kette)
   folgt nach M2. Alternative: sie vor M2 einschieben, dann wartet der Editor darauf.
2. **Was heißt „lokal speichern“?** Vorschlag: beides — automatische Sicherung des Arbeitsstands
   (nichts geht beim Neuladen verloren) und benannte Layouts zum Speichern, Laden, Löschen.
   Kein Datei-Export/-Import in M2. Alternative: nur der Arbeitsstand, oder zusätzlich
   JSON-Export, um Strecken bis M3 zwischen Geräten zu tragen.
3. **Kaputter Arbeitsstand beim Start.** Vorschlag: leer starten, laut melden, die automatische
   Sicherung pausiert, bis der Mensch „Verwerfen“ bestätigt — so überschreibt nicht die erste
   Änderung die alten Daten still. Alternative: kaputte Daten unter einen Ausweichschlüssel
   verschieben und normal weitersichern.
4. **Bedienung der Querung.** Vorschlag: Leisteneintrag „Querung“, nur aktiv, wenn das offene Ende
   exakt an einem Queranschluss einer ungequerten Kreuzung steht; Zielmarken zeigen die
   Anschlüsse; Querung nur am Ende anhängbar. Alternative: immer anhängbar, Fehler bis zur
   Korrektur.
5. **Kreuzung löschen, die gequert wird.** Vorschlag: Querung bleibt stehen, Fehler „Querung
   verweist auf keine frühere Kreuzung“ ist sichtbar (laut statt still, passt zu M1
   Entscheidung 4). Alternative: Querung automatisch mitlöschen (ein Befehl, ein Rückgängig).
6. **Fehler im Bild.** Vorschlag: zeichnen bis vor das erste fehlerhafte Element, rote Marke dort,
   „n Teile nicht gezeichnet“, Fehlerliste antippbar zum Auswählen, voriges/nächstes zum
   Durchgehen auch nicht gezeichneter Elemente. Alternative: eine zusätzliche Elementliste
   (Textform) neben der Zeichnung.
7. **Nicht platzierbare Teile in der Leiste.** Vorschlag: Looping, Steilkehre, Steilkurve 1/45°
   und Wireless-Anschluss ausgegraut mit „Maße fehlen“ zeigen (man sieht, dass sie bekannt sind);
   L- und K-Einzelteile ganz ausblenden, weil sie nie allein verbaut werden. Alternative: alle
   nicht platzierbaren ausblenden.
8. **Kurvenrichtung.** Vorschlag: ein Schalter in der Leiste (Start „links“) für neue Kurven und
   zusätzlich „Richtung umschalten“ am ausgewählten Kurvenelement; beim Ersetzen Kurve durch Kurve
   bleibt die Richtung. Alternative: nur einer der beiden Wege.
9. **Gesamtlänge.** Vorschlag: Mittellinie, die Querung zählt mit ihren 114 mm (die Autos fahren
   sie), Anzeige in Metern mit zwei Nachkommastellen („2,30 m“). Alternative: ohne Querung
   (Acht dann „2,18 m“), oder Anzeige in cm/mm.
10. **Mutationsproben für die Editor-Logik.** Vorschlag: von Hand durch den Critic, ohne
    Stryker-Ratchet (dessen Ausweitung auf `src/web/editor` wäre eine Admin-Änderung an
    `stryker.config.json` und `package.json`). Alternative: Admin weitet den Ratchet aus, dann
    gilt `break=100` auch für den Editor.
11. **Kleinkram der Auswahl.** Vorschlag: nach Löschen ist der Nachfolger ausgewählt (zügiges
    mehrfaches Löschen); „Ersetzen“ wirkt einmal und endet; „Davor einfügen“ bleibt aktiv, damit
    mehrere Teile hintereinander eingefügt werden können. Alternative: beide Aktionen bleiben aktiv
    bis zum Abbrechen.
12. **Ansicht beim Anhängen.** Vorschlag: Die Ansicht rückt mit, wenn das offene Ende aus dem Bild
    liefe, ohne den Zoom zu ändern; sonst bleibt sie, wie der Mensch sie eingestellt hat.
    Alternative: nie automatisch bewegen, nur „Einpassen“.
13. **Start- und Build-Skript.** Vorschlag: In M2 startet der Editor mit `pnpm exec vite` (kein
    Eingriff in `package.json`). Skripte `dev`/`build` trägt der Mensch per Admin-Änderung nach,
    spätestens für M4 (Deploy braucht `build`). Alternative: jetzt per Admin-Änderung aufnehmen.

## Smoke

**Aufrufer des geänderten Pfads: die Browser-Oberfläche, sonst niemand.** Nachgesehen am
Basisstand `3db7bc8`: `src/web/index.ts:2` ist ein Platzhalter (`export {};`); im Repo gibt es
weder `index.html` noch `vite.config.ts`, und `package.json:11-16` kennt nur `typecheck`, `lint`,
`test`, `test:mutation` (kein `dev`, kein `build`). Die M1-API ist exportiert über
`src/core/index.ts:1-3`, `src/catalog/index.ts:1`, `src/schema/index.ts:1`; außer den M1-Tests
importiert heute kein Quelltext daraus. `src/server/index.ts:2` ist ebenfalls Platzhalter; MCP
oder andere Dienste rufen nichts auf. Mit M2 ruft genau ein Weg den Kern auf: Mensch im Browser →
`src/web/index.html` → `src/web/ui` → `src/web/editor` → `src/core`/`src/catalog`/`src/schema`.

Start für die Abnahme: `pnpm exec vite --host` aus dem Repo, aufrufen am Laptop (Chrome oder
Firefox), am Tablet und am Handy im selben Heimnetz. Die Fälle laufen auf jedem der drei Geräte;
Maus-Fälle am Laptop, Touch-Fälle an Tablet und Handy.

1. **Oval aus dem Bestand.** Leistenrichtung „links“, tippen: Kurve 1/90°, Kurve 1/90°,
   Gerade 342, Kurve 1/90°, Kurve 1/90°, Gerade 342. Sichtbar: geschlossenes Oval, Status
   „geschlossen“, Verbrauch Kurve 1/90° 4 und Gerade 342 2 (zusammen 6), Gesamtlänge „1,76 m“.
2. **Acht mit Querung.** Neu, dann Kreuzung; Richtung „rechts“, 3 × Kurve 1/90°, Gerade 114. Der
   Pfeil am Ende steht auf einer Zielmarke der Kreuzung, „Querung“ wird aktiv; antippen. Dann
   Anschlussstück, Richtung „links“, 3 × Kurve 1/90°. Sichtbar: Acht, Querung über die Kreuzung
   hervorgehoben, „geschlossen“, Verbrauch 9 Teile (Kreuzung 1, Kurve 1/90° 6, Gerade 114 1,
   Anschlussstück 1), „2,30 m“. Vor dem Tippen auf Gerade 114 ist „Querung“ ausgegraut.
3. **Bearbeiten.** Im Oval die erste Gerade 342 (Nr. 3) auswählen, „Davor einfügen“, dann
   Gerade 114, Anschlussstück, Rundenzähler tippen; die Gerade 342 bleibt ausgewählt, „Löschen“.
   Sichtbar: an ihrer Stelle die drei kurzen Teile, Status wieder „geschlossen“, Verbrauch 8 Teile.
   Eine Kurve 1/90° auswählen, „Ersetzen“, Kurve 1/45° tippen → „offen“; Rückgängig →
   „geschlossen“. Die letzte Gerade 342 löschen → „offen, Lücke 342 mm, Winkel 0°“, die Lücke ist
   im Bild zu sehen. Rückgängig → „geschlossen“; Wiederholen → wieder offen; Rückgängig. Erste
   Kurve auswählen, „Richtung umschalten“ → offen; Rückgängig. Tastatur am Laptop: Strg/Cmd+Z,
   Strg/Cmd+Umschalt+Z, Entf, Esc.
4. **Zoomen und Verschieben.** Laptop: Mausrad zoomt um den Zeiger, Ziehen verschiebt, Klick
   wählt aus. Tablet und Handy: Spreizen zoomt, ein Finger verschiebt, die Seite selbst zoomt
   dabei nicht, ein Tipp wählt aus, ein Wischen wählt nichts aus. „Einpassen“ holt die Strecke
   zurück, nachdem sie aus dem Bild geschoben wurde. Handy hoch: nichts ragt seitlich heraus, die
   Leiste scrollt, alle Knöpfe sind mit dem Daumen treffbar.
5. **Speichern und Laden.** Oval als „Oval“ speichern, „Neu“, „Oval“ laden → dasselbe Oval,
   „geschlossen“. Noch einmal unter „Oval“ speichern → Rückfrage vor dem Überschreiben. Seite neu
   laden → der letzte Arbeitsstand ist wieder da. Ein gespeichertes Layout löschen (mit
   Rückfrage).

Gegenfälle, die geschlossen bleiben müssen:

6. Looping, Steilkehre, Steilkurve 1/45° und Wireless-Anschluss sind in der Leiste ausgegraut mit
   „Maße fehlen“; Antippen ändert nichts. L- und K-Teile tauchen nicht auf.
7. In der Acht die Gerade 114 (Nr. 5) durch Gerade 171 ersetzen → Status „Fehler (1)“, Eintrag
   „Nr. 6: Strecke kommt nicht am Queranschluss an“, Zeichnung endet nach Nr. 5 mit roter Marke,
   die Queranschlüsse der Kreuzung leuchten, „5 Teile nicht gezeichnet“. Fehler antippen wählt
   Nr. 6 aus. Rückgängig → wieder geschlossen. Die Kreuzung (Nr. 1) löschen → „Querung verweist
   auf keine frühere Kreuzung“ an Nr. 5.
8. Kaputte Daten (Browser-Entwicklerwerkzeuge, gespeicherten Wert von Hand ändern): Text, der
   kein JSON ist; `schemaVersion` 2; ein zusätzliches Feld; zwei Elemente mit gleicher ID. Jedes
   Mal scheitert das Laden mit sichtbarer Meldung samt Grund, der Arbeitsstand bleibt, der
   gespeicherte Wert ist danach unverändert. Ein kaputter Arbeitsstand beim Neuladen: leerer
   Editor, Meldung mit „Verwerfen“, Hinweis „Sicherung pausiert“; erst nach „Verwerfen“ wird
   wieder gesichert.
9. Ein Layout mit `"part": "looping"` im sonst gültigen JSON lädt, zeigt „Maße fehlen, nicht
   platzierbar“ und zeichnet bis davor (Schema gültig, Kern meldet den Fehler).
10. Speicher gesperrt (privates Fenster mit blockiertem Speicher oder Speicher in den
    Website-Einstellungen verbieten): Speichern zeigt eine Meldung, der Editor bleibt bedienbar,
    die Strecke auf dem Bildschirm bleibt.
11. Netzwerk-Reiter der Entwicklerwerkzeuge: nach dem Laden der Seite keine Anfragen an fremde
    Adressen (REQ-UI-10).

### Nach dem Deploy

M2 wird nicht ausgeliefert (Deploy ist M4); nachweisbar erst dort:

- Erreichbarkeit über die echte Adresse auf dem Raspi im Heimnetz und per VPN von unterwegs, auf
  den echten Geräten von beiden Nutzern.
- `localStorage` hängt an der Adresse: Was am Dev-Server (`http://<laptop>:5173`) gespeichert
  wurde, ist unter der Raspi-Adresse nicht da. Erwartet, kein Fehler; vor M4 dem Menschen sagen.

Schon mit M2, aber nur in der echten Welt prüfbar: das Oval und die Acht im Editor bauen, auf dem
Boden mit den echten Teilen nachstecken und prüfen, dass „geschlossen“ im Editor dem spannungsfreien
Schluss auf dem Boden entspricht, und dass „links“ im Bild auch links auf dem Boden ist.
