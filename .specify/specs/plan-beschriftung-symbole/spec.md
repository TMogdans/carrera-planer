# Spec: Teilenamen und eigene Symbole im Plan (Issues #35 und #36)

Status: Entwurf zur Abnahme per Review des Spec-PR. Die Empfehlungen zu den offenen Fragen der
beiden Issues stehen im Abschnitt „Empfehlungen zu den offenen Fragen“ (die Kriterien verweisen
mit „(Frage n)“ darauf), die Punkte mit Abweichung vom Issue unter „Zur Abnahme“.
Grundlage: Issue #35 („Plan: Teilenamen am Bauteil anzeigen (ein-/ausblendbar)“), Issue #36
(„Plan: eigene Darstellung für Rundenzähler, Anschlussstück, Spurwechsel“),
[KONZEPT.md](../../../KONZEPT.md) (abgenommen 2026-11-23; „Bedienung“, „Architektur“),
[docs/recherche.md](../../../docs/recherche.md) (Zeilen 45–53: Spurwechsel gerade „keine
Einbaurichtung“, Wireless-Anschluss Maße unbekannt), die umgesetzten Specs
[M2](../m2-editor/spec.md), [M3a](../m3a-bestand/spec.md), [gerade-100](../gerade-100/spec.md) und
[constitution.md](../../constitution.md). Basisstand: `origin/main` = `85a99b0`.

**Tier: T1** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` gegen
`.devloop/tier-map.json` aus den geplanten Pfaden
`.specify/specs/plan-beschriftung-symbole/spec.md`, `src/web/editor/labels.ts` (+ Test),
`src/web/editor/planner-session.ts` (+ Test), `src/web/editor/types.ts`,
`src/web/editor/index.ts`, `src/web/ui/canvas.tsx`, `src/web/ui/app.tsx`,
`src/web/ui/style.css`, `src/web/ui/symbols.tsx` → `{"tier":"T1"}`. Alle Pfade fallen unter `**`.
Gegenprobe: `src/web/ui/canvas.tsx` plus `src/catalog/catalog.ts` → T2. Das Tier bleibt also nur
T1, solange weder Katalog noch Kern, Schema oder Server berührt werden (REQ-PARCH-2). Die
Dateinamen sind Vorschläge; das autoritative Tier rechnet CI aus dem tatsächlichen Diff.
Smoke: `.devloop/config.json` schaltet die Smoke-Station für T1 ein. Der Abschnitt „Smoke“ läuft
damit als Station und ist zugleich die Abnahmeliste für den Menschen.

## User Story

Als Bahnbauer, der eine geplante Carrera-GO!!!-Strecke auf dem Boden nachbaut, möchte ich im Plan
an jedem Teil sehen, welches Teil es ist — „Gerade 114“ oder „Gerade 100“, „Kurve 1/45°“ oder
„Kurve 2/45°“ — und Rundenzähler, Anschlussstück, Spurwechsel und Engstelle auf einen Blick von
gewöhnlichen Geraden und Kurven unterscheiden, ohne jedes Teil einzeln antippen zu müssen. Wenn
mich die Namen stören, blende ich sie aus, und der Plan merkt sich das.

## Begriffe

- **Beschriftung:** der Text an einem gezeichneten Element im Plan, entweder der **volle Name**
  (Feld `name` des Katalogeintrags) oder die **Kurzform** (Tabelle unten).
- **Kurzform:** nur für Einträge, deren Name mit „Gerade “ oder „Kurve “ beginnt: der Name ohne
  dieses erste Wort. Heute ergibt das:

  | Katalog-ID | voller Name | Kurzform |
  |---|---|---|
  | `gerade-342` | Gerade 342 | 342 |
  | `gerade-171` | Gerade 171 | 171 |
  | `gerade-114` | Gerade 114 | 114 |
  | `gerade-100` | Gerade 100 | 100 |
  | `kurve-1-90` | Kurve 1/90° | 1/90° |
  | `kurve-1-45` | Kurve 1/45° | 1/45° |
  | `kurve-2-45` | Kurve 2/45° | 2/45° |
  | `kurve-3-45` | Kurve 3/45° | 3/45° |

  Alle übrigen platzierbaren Einträge (Spurwechselkurve, Spurwechsel gerade, Engstelle, Kreuzung,
  Anschlussstück, Rundenzähler) haben keine Kurzform (Frage 2).
- **Symbolteil:** Katalogeintrag mit eigenem Symbol nach REQ-SYM-1 (Rundenzähler, Anschlussstück,
  Spurwechsel gerade, Spurwechselkurve, Engstelle).
- **Maßstab s:** `view.scale` der Zeichenfläche, Bildschirm-Pixel je mm (`src/web/ui/view.ts:4`),
  begrenzt auf 0,01 bis 20 (`view.ts:13-14`).
- **Platz P:** Sehnenlänge des Elements auf dem Bildschirm = Abstand zwischen Anfangs- und
  Endpunkt seiner Mittellinie (`centerline.from`/`.to` aus `drawing`) in mm, mal s. Für Geraden
  ist das die Länge, für Kurven die Sehne (Kurve 1/90° R1: 171·√2 ≈ 241,8 mm; Kurve 1/45° R1:
  2·171·sin 22,5° ≈ 130,9 mm), für die Kreuzung 342 mm.
- **Breitenschätzung B:** 7,5 Bildschirm-Pixel je Zeichen des Texts (Zeichen = Unicode-Codepoints,
  „°“ und „ü“ zählen je 1), bei Symbolteilen zuzüglich 20 px für Symbol und Abstand. Grund:
  gemessen in Chrome, 12 px `system-ui` (Schrift der Seite, `style.css:17`), ist das breiteste
  Verhältnis 7,2 px je Zeichen („Rundenzähler“ 86,6 px für 12 Zeichen; „Anschlussstück“
  98,8 px/14; „Gerade 100“ 65,3 px/10; „Kurve 3/45°“ 74,5 px/11). Echte Textmetrik gibt es in der
  Node-Umgebung nicht; die Schätzung macht die Regel ohne DOM prüfbar.
- **Schalter „Namen“:** der neue Ein/Aus-Schalter für Beschriftungen.

## Messungen (Basisstand `85a99b0`)

Gemessen mit `vite build` und Chrome headless (`--dump-dom`, Ansicht aus der
`matrix(...)`-Transformation der Zeichenfläche abgelesen), Arbeitsstand jeweils vorab in
`localStorage` gesetzt. „Groß“ = Oval aus 2 × 4 Gerade 342 und 4 Kurven 1/90° (Box 1824 × 456 mm,
ungefähr Mach-8-Größe). Chrome headless erzwingt mindestens 500 px Fensterbreite; die Werte für
das Handy (360 × 740) sind deshalb aus der gemessenen Höhe der Fläche (435 px) und der Breite 360 px
mit derselben Formel (`fitBox`, `view.ts:42-51`, Rand 40 px; Startansicht `app.tsx:162-166`)
gerechnet. Die Werte bei 500 px Breite stimmen mit der Formel überein (Oval 420/798 = 0,526, Groß
420/1824 = 0,230).

| Gerät (Fenster) | Ansicht | s | Gerade 100 | Gerade 342 | Kurve 1/45° (Sehne) |
|---|---|---|---|---|---|
| Handy 360 × 740 | leer (Start) | 0,24 | 24 px | 82 px | 31 px |
| Handy 360 × 740 | Oval eingepasst | 0,35 | 35 px | 120 px | 46 px |
| Handy 360 × 740 | Groß eingepasst | 0,15 | 15 px | 53 px | 20 px |
| Tablet 768 × 1024 | Oval eingepasst | 0,86 | 86 px | 295 px | 113 px |
| Tablet 768 × 1024 | Groß eingepasst | 0,38 | 38 px | 129 px | 49 px |
| Laptop 1280 × 800 | leer (Start) | 0,40 | 40 px | 137 px | 52 px |
| Laptop 1280 × 800 | Oval eingepasst | 1,14 | 114 px | 389 px | 149 px |
| Laptop 1280 × 800 | Groß eingepasst | 0,52 | 52 px | 176 px | 67 px |
| – | kleinster Zoom | 0,01 | 1 px | 3 px | 1 px |

Folgerung: Ein voller Name braucht 50 bis 115 px. Gerade 100 hat ihn erst ab s ≈ 0,75, also auf
dem Handy praktisch nie ohne Hineinzoomen; die Kurzform „100“ (23 px) passt ab s = 0,225. Das ist
der Grund für die Kurzform und für die Regel „lieber weglassen als überdecken“.

## Aufteilung: Logik und Darstellung

Wie in M2: Was sich als Zahl fassen lässt, steht in der Logik-Schicht (Frage 11).

| Schicht | Inhalt | Ort (Vorschlag) | Nachweis |
|---|---|---|---|
| **Logik** | Beschriftungstext (voll/kurz), Platzregel, Ort der Beschriftung, Symbolzuordnung je Katalog-ID, Zustand und Speicherung des Schalters | `src/web/editor/` (z. B. `labels.ts`, Erweiterung von `planner-session.ts`) | Vitest in Node ohne DOM; Stryker-Ratchet `break=100` (REQ-WARCH-4 gilt schon für `src/web/editor`) |
| **Darstellung** | SVG-Ausgabe der Beschriftungen und Symbole, Ebenenreihenfolge, Schalter in der Werkzeugleiste, CSS | `src/web/ui/` | Vitest in Node auf der SVG-Ausgabe hook-freier Komponenten (Preact-VNode-Baum: Elemente, Text, `data-id`, `transform`, Reihenfolge) und Browser-Smoke |

Für die Darstellung gibt es weiter weder jsdom noch eine Komponenten-Testbibliothek (neue
Abhängigkeit = geschützter Satz). Ein Preact-VNode-Baum lässt sich aber ohne DOM prüfen, wenn die
Beschriftungs- und Symbol-Ebene als Komponente ohne Hooks gebaut ist, die aus (Elementen, Ansicht,
Schalterzustand) ihre SVG-Kinder liefert. Die Kriterien REQ-LBL-7 bis -10 und REQ-SYM-2 bis -5
sind so gefasst, dass sie an diesem Baum prüfbar sind; was nur am Bildschirm sichtbar ist
(Kontrast, Lesbarkeit), prüft der Smoke. `src/web/ui` liegt nicht im Stryker-Ratchet; die
Mutationsprobe dort fährt der Critic von Hand (Platzregel verfälschen, Ebene vertauschen,
Drehung einbauen — ein Test muss rot werden).

## Empfehlungen zu den offenen Fragen

1. **Feste Bildschirmgröße 12 px, nicht mitskaliert** (REQ-LBL-8). Die Schrift wird wie die
   bestehenden Marken (`canvas.tsx:211-225`: `scale(${px})`) auf Bildschirmpixel zurückskaliert.
   Grund: Bei s = 0,15 wäre ein mitskalierter Text in mm unlesbar klein, bei s = 20 riesig; die
   Seite nutzt 12–14 px für Fließtext.
2. **Kurzform nur für Geraden und Kurven, und zwar die Zahl ohne Wortteil („114“, „2/45°“), nicht
   „G114“/„K1/90“** (REQ-LBL-1). Grund: Ob Gerade oder Kurve, zeigt die Form des Bands schon; was
   fehlt, ist die Zahl. „114“ ist ohne Legende lesbar, „G114“ braucht eine. Für Symbolteile
   übernimmt das Symbol die Rolle der Kurzform; Kreuzung (342 mm, „Kreuzung“ passt ab s = 0,18)
   und Spurwechsel brauchen keine.
3. **Ausblenden statt überdecken, je Teil nach Platz** (REQ-LBL-2). Voller Name, wenn B ≤ P; sonst
   Kurzform, wenn vorhanden und B ≤ P; sonst nichts. Kein globaler Zoom-Schwellwert. Grund: Eine
   feste Zoomstufe passt nicht zugleich zu Gerade 100 (voll ab s = 0,75) und Gerade 342 (voll ab
   s = 0,22); die Regel je Teil zeigt bei mittlerem Zoom die langen Teile voll und die kurzen
   kurz. Wirkung laut Messung: Handy, große Strecke eingepasst: Gerade 342 zeigt „342“, Gerade 100
   nichts; Laptop, Oval eingepasst: alles voll.
4. **Handy 360 px: dieselbe Regel, kein Sonderfall** (REQ-LBL-2, REQ-LBL-7). Der Platz wird in
   Bildschirmpixeln gerechnet, das Handy bekommt dadurch automatisch weniger und kürzere Namen.
   Der Schalter steht in der Werkzeugleiste, die auf schmalen Bildschirmen schon in sich scrollt
   (`style.css:94-102`), mit 44 × 44 px Tippziel.
5. **Querung nicht beschriften** (REQ-LBL-4). Grund: Die Mitte der Querung ist exakt die Mitte der
   Kreuzung (Queranschlüsse mittig, 171 mm hinter dem Eingang, KONZEPT „Kreuzung“); beide
   Beschriftungen lägen aufeinander. Die Querung ist kein Teil und verbraucht keins; die
   Auswahlleiste nennt sie weiter „Querung“ (`app.tsx:238-239`).
6. **Waagerecht, nie mitgedreht, mittig auf der Mittellinie** (REQ-LBL-3, REQ-LBL-8). Ort ist die
   Mitte der Mittellinie (bei Kurven die Bogenmitte, nicht die Sehnenmitte). Grund: gedrehter Text
   bei 45°-Teilen und auf Gegengeraden (Kopf steht) ist auf dem Handy schwer lesbar; die Breite
   eines waagerechten Texts ist von der Teilrichtung unabhängig, was die Platzregel einfach hält.
7. **Baugruppen und Teile mit fehlenden Maßen: keine Beschriftung, kein Symbol** (REQ-LBL-4). Sie
   werden nicht gezeichnet (M2: gezeichneter Abschnitt endet vor dem ersten Fehler), also gibt es
   keinen Ort. Dasselbe gilt für alle Elemente hinter dem ersten Fehler.
8. **Eigene Symbole für Rundenzähler (Zielflagge), Anschlussstück (Stecker), Spurwechsel gerade und
   Spurwechselkurve (gemeinsames Spurwechsel-Zeichen) und Engstelle (Taille)** (REQ-SYM-1). Die
   Kreuzung ist mit ihrem gezeichneten Querweg schon unterscheidbar (`canvas.tsx:173-178`) und
   bekommt keins. Die **Engstelle sieht heute aus wie eine gewöhnliche Gerade 228** und gehört
   deshalb dazu, obwohl das Issue sie nur „prüfen“ lässt. Der **Wireless-Anschluss** ist
   `masseFehlen` (`catalog.ts`), nicht platzierbar und wird nie gezeichnet; er bekommt sein Symbol
   erst mit den Maßen (#1).
9. **Keine Spurwechsel-Richtung** (Nicht-Ziel). Der Katalog kennt keine: Spurwechsel gerade hat laut
   Recherche „keine Einbaurichtung“ (`docs/recherche.md:46`), die Spurwechselkurve hat nur die
   Kurvenrichtung links/rechts wie jede Kurve, aber keine Angabe, von welcher auf welche Spur sie
   wechselt. Darstellen hieße raten.
10. **Symbol als festes 16-px-Zeichen an der Beschriftungsstelle, Name rechts daneben in derselben
    Zeile; Unterscheidung über die Form, nicht über die Farbe** (REQ-SYM-2, REQ-SYM-3). Grund:
    (a) Beim Herauszoomen ist ein Rundenzähler auf dem Handy 17 px lang (Groß eingepasst); eine
    Markierung in mm auf dem Band (Zielflaggen-Karos von 19 mm) wäre dort 3 px groß und nicht
    erkennbar, ein festes 16-px-Zeichen schon. (b) Symbol und Name können sich nicht überdecken,
    weil sie per Bau nebeneinander stehen. (c) Die Seite hat **keinen Dunkelmodus** (kein
    `prefers-color-scheme` in `src/web`); „hell/dunkel“ heißt hier: auf dem dunkelgrauen Band
    (`--band: #4b5563`) und auf dem hellen Hintergrund (`#e9e6df`) lesbar. Deshalb steht jedes
    Symbol auf einer hellen Plakette mit dunkler Kontur. (d) Die Seite des Steckers am echten
    Anschlussstück steht in keinem Katalogfeld; ein Zeichen „am Rand“ würde eine Einbauseite
    behaupten, die wir nicht kennen. Alternative siehe „Zur Abnahme“ 2.
11. **Logik in `src/web/editor`, nicht nur `src/web/ui`** (Aufteilung oben). Grund: M2 hat
    festgelegt, dass Zählbares in die Logik-Schicht gehört, und nur dort greift der Stryker-Ratchet;
    der Modus-Schalter, nach dessen Vorbild der Schalter „Namen“ gespeichert wird, liegt ebenfalls
    dort (`planner-session.ts:39-41`, `:160-172`, `:205-208`). Das Tier bleibt T1. Abweichung vom
    Issue-Umfang („nur `src/web/ui`“), siehe „Zur Abnahme“ 1.
12. **Schalter „Namen“ standardmäßig an, gespeichert wie der Modus** (REQ-LBL-5). Grund: Das Issue
    wünscht die Namen; die Platzregel hält den Plan bei kleinem Zoom leer genug. Ungültiger Wert
    und Speicherfehler verhalten sich wie beim Modus (Meldung, Rückfall auf den Standard), damit es
    keine zweite Regel gibt.
13. **Beschriftung und Symbol über der Auswahl, unter den Marken** (REQ-LBL-9). Grund: Die
    Auswahlhervorhebung (`canvas.tsx:196-198`) liegt halbtransparent über dem Band und würde den
    Namen sonst verwaschen; Zielmarken, Endpfeil und Fehlermarke sind Rückmeldung und müssen oben
    bleiben. Ein Tipp auf den Namen wählt sein Element aus.

## Akzeptanzkriterien

### Logik: Beschriftung (`src/web/editor`)

- **REQ-LBL-1** [Where] Der Beschriftungstext eines Teil-Elements kommt aus dem übergebenen
  Katalog: voller Name = `name` des Eintrags; Kurzform = `name` ohne das erste Wort, wenn `name`
  mit „Gerade “ oder „Kurve “ beginnt, sonst keine. Mit dem echten Katalog ergibt das genau die
  Tabelle unter „Begriffe“; Spurwechselkurve, Spurwechsel gerade, Engstelle, Kreuzung,
  Anschlussstück und Rundenzähler haben keine Kurzform. Wirkungsnachweis mit verfälschtem Katalog:
  heißt `gerade-114` dort „Gerade 999“, ist die Beschriftung „Gerade 999“ bzw. „999“; heißt
  `engstelle` „Kurve X“, bekommt sie die Kurzform „X“ (Frage 2).
- **REQ-LBL-2** [When] **Platzregel.** Für jedes gezeichnete Teil-Element, Maßstab s und
  Schalterzustand bestimmt die Logik genau eine Variante:
  - Schalter an, kein Symbolteil: „voll“, wenn B(voller Name) ≤ P; sonst „kurz“, wenn es eine
    Kurzform gibt und B(Kurzform) ≤ P; sonst „keine“.
  - Schalter an, Symbolteil: „Symbol + Name“, wenn 20 + B(voller Name) ≤ P; sonst „nur Symbol“,
    wenn 16 ≤ P; sonst „keine“.
  - Schalter aus: Symbolteil „nur Symbol“, wenn 16 ≤ P, sonst „keine“; andere Teile immer „keine“.

  (B und P wie unter „Begriffe“; B ohne die 20 px, die schon in der Formel stehen.) Beispiele,
  Schalter an, gerechnet mit den Sehnen aus „Begriffe“:

  | Teil | s = 0,15 | s = 0,4 | s = 1,14 |
  |---|---|---|---|
  | Gerade 100 (P = 15 / 40 / 114) | keine | kurz „100“ | voll „Gerade 100“ |
  | Gerade 342 (P = 51,3 / 136,8 / 389,9) | kurz „342“ | voll | voll |
  | Kurve 1/45° (P = 19,6 / 52,4 / 149,2) | keine | kurz „1/45°“ | voll |
  | Kreuzung (P = 51,3 / 136,8 / 389,9) | keine | voll | voll |
  | Rundenzähler (P = 17,1 / 45,6 / 130,0) | nur Symbol | nur Symbol | Symbol + Name |
  | Anschlussstück (P = 17,1 / 45,6 / 130,0) | nur Symbol | nur Symbol | Symbol + Name |

  Grenzfälle sind eingeschlossen (B = P zählt als „passt“): Gerade 100 bei s = 0,225 ist „kurz“,
  bei s = 0,224 „keine“; bei s = 0,75 „voll“. Eigenschaft: Wächst s, wird die Variante nie
  „kleiner“ (Ordnung keine < kurz < voll bzw. keine < nur Symbol < Symbol + Name) (Frage 3, 4).
- **REQ-LBL-3** [Where] Der Ort der Beschriftung (und des Symbols) ist die Mitte der Mittellinie
  des Elements in Zeichenkoordinaten (mm, y nach unten wie `drawing`): bei Geraden und der Kreuzung
  der Mittelpunkt der Strecke, bei Kurven der Punkt auf dem Bogen mit gleichem Abstand zu Anfang
  und Ende. Beispiele aus der Startpose: `[gerade-342]` → (171, 0); `[kurve-1-90 links]` →
  (171·√2/2, −171 + 171·√2/2) ≈ (120,92, −50,08); `[kurve-1-90 rechts]` → (120,92, 50,08);
  Kreuzung als erstes Element → (171, 0), also der Kreuzungspunkt (Frage 6).
- **REQ-LBL-4** [If/Then] Keine Beschriftung und kein Symbol bekommen: Querungen; Elemente hinter
  dem ersten Fehlerindex (nicht gezeichnet); Baugruppen und Teile mit Geometrie `masseFehlen`
  (nie gezeichnet). Beispiele: `[gerade-342, querung]` über einer Kreuzung liefert für die Querung
  nichts; ein importiertes `[steilkehre, gerade-342]` liefert gar nichts (die Gerade liegt hinter
  dem Fehler); `[gerade-342, looping]` liefert nur für die Gerade eine Beschriftung (Frage 5, 7).
- **REQ-LBL-5** [When] **Schalter speichern.** Der Schalterzustand liegt unter dem Schlüssel
  `carrera-planer:beschriftung` mit dem Wert `an` oder `aus`; jedes Umschalten schreibt ihn sofort.
  Eine neue Sitzung auf demselben Speicher übernimmt ihn. Ohne Schlüssel gilt „an“, ohne Meldung
  und ohne Schreiben. Bei einem anderen Wert gilt „an“, es erscheint eine Meldung, die den Wert
  nennt, und der Wert bleibt bis zum nächsten Umschalten unverändert im Speicher. Scheitert das
  Schreiben, ändert sich der Zustand trotzdem und es erscheint eine Speicherfehler-Meldung
  (Muster REQ-STORE-8). Der Schlüssel erscheint weder in der Layout-Liste noch in einer
  Defekt-Liste (M2 und M3a) (Frage 12).
- **REQ-LBL-6** [Contract] Umschalten ist kein Befehl: Es ändert weder die Elementfolge noch die
  Auswahl, legt keinen Verlaufseintrag an und löst keine automatische Sicherung des Layouts aus.
  Wirkungsnachweis: Oval bauen, umschalten, „Rückgängig“ → das letzte Teil verschwindet, der
  Schalter bleibt; der gespeicherte Arbeitsstand (`carrera-planer:layout:`) ist vor und nach dem
  Umschalten zeichengleich; ein Export enthält kein Feld zur Beschriftung.

### Darstellung: Beschriftung (`src/web/ui`)

- **REQ-LBL-7** [Where] Die Werkzeugleiste hat einen Schalter „Namen“ (auf schmalen Bildschirmen
  nur das Zeichen, wie die übrigen Knöpfe), dessen `aria-pressed` den Zustand zeigt und der beim
  Antippen umschaltet. Tippziel mindestens 44 × 44 CSS-Pixel; auf allen Geräten aus REQ-UI-1 ohne
  waagerechtes Scrollen der Seite (Frage 4).
- **REQ-LBL-8** [Where] Für jedes Element mit Variante „voll“, „kurz“ oder „Symbol + Name“ enthält
  die SVG-Ausgabe genau ein Textelement mit genau diesem Text (voller Name bzw. Kurzform), für
  „keine“ und „nur Symbol“ keines. Der Text steht am Ort aus REQ-LBL-3, waagerecht zentriert (bei
  „Symbol + Name“ die ganze Zeile aus Symbol und Text) und senkrecht mittig. Seine wirksame
  Transformation gegenüber dem Bildschirm ist eine reine Verschiebung ohne Drehung, Scherung oder
  Skalierung, und die Schriftgröße beträgt bei s = 0,15, 1 und 20 jeweils 12 CSS-Pixel
  (Zurückskalieren mit 1/s wie die bestehenden Marken). Ist der Schalter aus, enthält die Ausgabe
  kein Beschriftungs-Textelement (Frage 1, 6).
- **REQ-LBL-9** [Where] **Ebenen.** Beschriftungen und Symbole stehen in der SVG-Ausgabe nach allen
  Bändern, Querwegen, Querungen und der Auswahlhervorhebung und vor Zielmarken, hervorgehobenen
  Queranschlüssen, Startmarke, Endpfeil und Fehlermarke. Jede Beschriftung bzw. jedes Symbol liegt
  in einem Element mit `data-id` = Element-ID seines Elements, sodass ein Tipp darauf dieses
  Element auswählt (REQ-UI-4 gilt unverändert). Das ausgewählte Element behält seine Beschriftung
  (Frage 13).
- **REQ-LBL-10** [Where] **Lesbarkeit auf Band und Hintergrund.** Der Text hat eine helle Füllung
  mit dunkler Kontur (Halo). Kontrast Füllung zu Band (`#4b5563`) mindestens 4,5 : 1, Kontur zum
  Flächenhintergrund (`#e9e6df`) mindestens 4,5 : 1 (WCAG-Kontrastformel; Werte im Smoke mit den
  Entwicklerwerkzeugen abgelesen). Beschriftungen fangen keine Gesten ab, die nicht auch das Band
  fangen würde: Ziehen auf einem Namen verschiebt die Ansicht, Mausrad zoomt (REQ-UI-7 gilt
  unverändert).

### Symbole

- **REQ-SYM-1** [Where] Die Symbolzuordnung hängt allein an der Katalog-ID: `rundenzaehler` →
  Zielflagge, `anschlussstueck` → Stecker, `spurwechsel-gerade` und `spurwechselkurve` →
  Spurwechsel, `engstelle` → Engstelle. Jede andere ID hat kein Symbol, auch `kreuzung`,
  `wireless-anschluss` und alle Geraden und Kurven. Wirkungsnachweis mit verfälschtem Katalog: ein
  Eintrag `rundenzaehler` mit Geometrie Gerade 342 behält die Zielflagge; ein Eintrag
  `gerade-114` mit Name „Rundenzähler“ bekommt keine (Frage 8).
- **REQ-SYM-2** [Where] Für jedes Element mit Variante „nur Symbol“ oder „Symbol + Name“ enthält
  die SVG-Ausgabe genau ein Symbol: im Code gezeichnete SVG-Pfade auf einer 16 × 16 CSS-Pixel
  großen Plakette, ohne Drehung, unabhängig von s (zurückskaliert wie REQ-LBL-8). Bei „nur Symbol“
  sitzt die Plakette mittig auf dem Ort aus REQ-LBL-3. Bei „Symbol + Name“ ist die Zeile
  W = 20 + B(voller Name) breit (16 px Plakette, 4 px Abstand, Text) und als Ganzes um den Ort x
  zentriert: Plakette von x − W/2 bis x − W/2 + 16, Textanfang (`text-anchor: start`) bei
  x − W/2 + 20. Die Plakette und der Textbereich [Textanfang, Textanfang + B(voller Name)]
  überlappen sich nicht. Symbole erscheinen auch bei ausgeschaltetem Schalter (Frage 10).
- **REQ-SYM-3** [Where] **Unterscheidbar ohne Farbe.** Die vier Symbole unterscheiden sich in der
  Form, nicht nur in der Farbe: Zielflagge = Schachbrettmuster (mindestens 3 × 3 Felder,
  abwechselnd hell/dunkel); Stecker = Steckerkörper mit zwei Stiften und Kabel; Spurwechsel = zwei
  parallele Spurlinien mit einer diagonalen Verbindung; Engstelle = zwei Linien, die sich zur Mitte
  hin nähern und wieder öffnen. Im Smoke sind alle vier auch in der Graustufen-Emulation der
  Entwicklerwerkzeuge (Achromatopsie) auseinanderzuhalten. Die Plakette ist hell mit dunkler
  Kontur; Kontrast Plakette zu Band und Kontur zum Flächenhintergrund (`#e9e6df`) jeweils
  mindestens 3 : 1 (WCAG 1.4.11, grafische Objekte) (Frage 10). Kontur zu Band wird nicht
  verlangt: Das Band hat die Leuchtdichte 0,089, selbst Schwarz erreicht dazu nur 2,78 : 1. Gegen
  das Band trennt die helle Plakette, gegen den Hintergrund die Kontur (Nachschärfung nach der
  Implementierung, vom Menschen abgenommen).
- **REQ-SYM-4** [Where] Jedes Symbol trägt ein SVG-`<title>` mit dem vollen Namen des
  Katalogeintrags, sodass am Laptop ein Hovern den Namen zeigt, auch wenn der Schalter aus ist
  oder der Name nicht passt.
- **REQ-SYM-5** [Architektur] Symbole sind im Code gezeichnet: keine Bilddateien, kein
  `<image>`-Element, keine Carrera-Grafiken, keine Anfragen ans Netz (REQ-UI-10 gilt unverändert).

### Architektur

- **REQ-PARCH-1** [Architektur] Beschriftungstext, Platzregel, Ort, Symbolzuordnung und
  Schalterzustand liegen in `src/web/editor`, nutzen weder Preact noch DOM-Globale und rechnen
  korrekt im Vitest-Lauf in der Node-Umgebung mit werfendem `preact`-Stub (wie REQ-WARCH-1). Der
  Mutations-Ratchet (`break=100`) endet ohne überlebenden Mutanten in `src/web/editor`;
  `stryker.config.json` bleibt unverändert.
- **REQ-PARCH-2** [Architektur] Die Änderung berührt keine Datei unter `src/core`, `src/catalog`,
  `src/schema`, `src/server` und keine Datei im geschützten Satz (darunter
  `src/web/test-support/**`). Wirkungsnachweis: das CI-Tier aus dem tatsächlichen Diff ist T1, und
  die Testdateien in `src/core`, `src/catalog`, `src/schema` laufen unverändert grün.
- **REQ-PARCH-3** [Performance] Die Beschriftungen werden bei jedem Zoom- und Verschiebeschritt neu
  bestimmt. Für eine fehlerfreie Folge mit 1000 Elementen dauert die Bestimmung von Variante und
  Ort aller Elemente für eine Ansicht im Vitest-Lauf (Node 22) **höchstens 16 ms im Maximum über
  20 Durchläufe** (ein Bild bei 60 Hz); der Test gibt Maximum und Median aus.

## Nicht-Ziele

- Spurwechsel-Richtung (welche Spur auf welche) — der Katalog kennt sie nicht (Frage 9). Kommt,
  wenn ein Katalogfeld dafür abgenommen ist (dann T2/T3).
- Symbol für den Wireless-Anschluss, solange er `masseFehlen` ist (#1).
- Eigene Symbole in der Teileleiste (`PartIcon`, `app.tsx:63-75`). Dort unterscheidet heute der
  Name; vorgeschlagenes Folge-Issue „Leiste: Symbole aus dem Plan übernehmen“.
- Dunkelmodus der Seite.
- Gedrehte Beschriftung entlang des Teils, Beschriftung außerhalb des Bands mit Führungslinie,
  automatische Verdrängung überlappender Namen nicht benachbarter Teile.
- Nummern der Elemente im Plan (die Auswahlleiste zeigt sie).
- Abgleich des Schalters zwischen Tabs (anders als der Bestand, REQ-BEST-10): ein anderer Tab
  übernimmt ihn beim nächsten Laden.
- Änderungen an Katalog, Schema, Kern, Server.

## Bekannte Grenzen

- **Breitenschätzung statt Messung.** 7,5 px je Zeichen ist in Chrome/macOS mit `system-ui` 12 px
  gemessen (größtes Verhältnis 7,2). Andere Schriften (Android Roboto, iOS San Francisco in
  anderer Größe, Nutzer-Schriftgröße) können breiter laufen; dann ragt ein Name ein paar Pixel über
  sein Teil hinaus. Kein Fehler im Sinn dieser Spec; nachprüfen unter „Nach dem Deploy“.
- **Überdeckung nur für benachbarte Teile auf einer Linie ausgeschlossen.** Die Platzregel sorgt
  dafür, dass der waagerechte Name nicht breiter ist als die Sehne des eigenen Teils. Für
  aufeinanderfolgende waagerechte Teile auf einer Geraden heißt das: keine Überdeckung. Bei
  senkrechten Teilen ragt der waagerechte Name seitlich über das Band; liegen zwei Gleise eng
  nebeneinander (Gegengerade, Kreuzung mit Querung, 45°-Ketten), können sich Namen nicht
  benachbarter Teile oder Namen mit Symbolen des Nachbarteils berühren. Dokumentiert, keine
  Verdrängungslogik in dieser Spec.
- **Kreuzungsmitte.** Der Name der Kreuzung liegt auf dem Kreuzungspunkt und damit über dem Band
  der Querung, wenn eine da ist. Lesbar durch den Halo; gewollt (Frage 5).
- **Symbole klein gegen kurze Teile.** Unter 16 px Platz verschwindet auch das Symbol (Handy,
  große Strecke: 114-mm-Teile haben 17 px, also gerade noch sichtbar). Hineinzoomen zeigt es.
- **Kein Bezug zur Einbauseite.** Das Stecker-Symbol sagt nicht, auf welcher Seite des echten
  Anschlussstücks das Kabel sitzt (Frage 10 d).

## Zur Abnahme

1. **Logik in `src/web/editor` statt nur `src/web/ui`** (Frage 11). Beide Issues nennen „nur
   `src/web/ui`“. Vorschlag: Platzregel, Texte, Symbolzuordnung und Schalter-Speicherung in die
   Logik-Schicht, Darstellung in `src/web/ui`. Gewinn: Stryker-Ratchet und verwaltete Tests auf
   der Regel, die am meisten Zahlen hat; der Schalter liegt neben dem Modus. Preis: zwei Schichten
   statt einer, `planner-session.ts` wird angefasst. Das Tier ist in beiden Fällen T1. Alternative:
   alles in `src/web/ui`, dann prüft nur der Critic per Hand-Mutation.
2. **Symbol als festes Zeichen neben dem Namen statt Markierung auf dem Band** (Frage 10). Das
   Issue denkt eher an Markierungen auf dem Teil („Querbalken“, „am Rand“, „diagonale Markierung“).
   Vorschlag: festes 16-px-Zeichen, weil es beim Herauszoomen lesbar bleibt (gemessen: 17 px für
   ein 114-mm-Teil am Handy) und Name und Symbol sich per Bau nicht überdecken. Alternative:
   Markierung in mm auf dem Band (näher am echten Teil, beim Hineinzoomen schöner), dafür ab etwa
   s < 0,5 kaum erkennbar, und die Regel gegen das Überdecken des Namens wird deutlich
   aufwendiger.
3. **Engstelle mit aufgenommen** (Frage 8), obwohl #36 sie nur „prüfen“ lässt: sie ist heute nicht
   von einer Geraden 228 zu unterscheiden.
4. **Standard „an“** (Frage 12). Alternative „aus“ (bisheriges Aussehen bleibt, wer Namen will,
   schaltet ein).
5. **Meldung bei ungültigem gespeichertem Wert** (REQ-LBL-5) wie beim Modus. Alternative: still auf
   „an“ zurückfallen — weniger Lärm bei einer reinen Anzeige-Einstellung, aber eine zweite Regel
   neben dem Modus.
6. **Kurzform ohne Buchstaben** („114“ statt „G114“, Frage 2).

## Smoke

**Aufrufer des geänderten Pfads: die Browser-Oberfläche, sonst niemand.** Nachgesehen am
Basisstand `85a99b0`:

- Einstieg `src/web/index.ts:4-7` → `mount` in `src/web/ui/app.tsx:547`, das die Sitzung mit
  `createPlannerSession` und `browserStorage()` baut (Modus-Speicherung als Vorbild:
  `src/web/editor/planner-session.ts:39-41`, `:160-172`, `:205-208`).
- Zeichengeometrie entsteht nur in der Oberfläche: `drawing(catalog, elements)` in
  `src/web/ui/app.tsx:104`, an die Zeichenfläche übergeben in `app.tsx:330`; gezeichnet in
  `src/web/ui/canvas.tsx:169-198` (Bänder, Querungen, Auswahl), Marken ab `canvas.tsx:199`.
  Außerhalb der Tests ruft sonst nur `src/web/test-support/editor-fixtures.ts` `drawing` auf
  (Testhilfe, geschützt).
- Der Modus-Schalter, neben den der neue Schalter kommt: `app.tsx:289-302`.
- `src/server/index.ts:2` ist ein Platzhalter (`export {};`); MCP oder andere Dienste rufen nichts
  auf.

Start wie in M2: `pnpm dev --host`, Laptop (Chrome oder Firefox), Tablet und Handy im Heimnetz.
Vor dem ersten Fall in den Entwicklerwerkzeugen `carrera-planer:beschriftung` löschen.

1. **Standard und Namen.** Sandbox, Neu. Schalter „Namen“ ist gedrückt. Oval aus Gerade 342, zwei
   Kurven 1/90° links, Gerade 342, zwei Kurven 1/90° links bauen, „Einpassen“. Am Laptop steht an
   jedem Teil der volle Name („Gerade 342“, „Kurve 1/90°“), waagerecht, mittig auf dem Teil, auch
   an den Kurven unten und an der Gegengeraden nicht auf dem Kopf.
2. **Kurzform und Ausblenden beim Zoomen.** Eine Gerade 342 durch Gerade 100 ersetzen (Oval bleibt
   offen, egal). Langsam herauszoomen: Gerade 100 wechselt zuerst auf „100“, dann verschwindet ihr
   Name, während Gerade 342 noch „Gerade 342“ zeigt; weiter heraus wird daraus „342“, dann nichts.
   Wieder hineinzoomen: in umgekehrter Reihenfolge zurück. Die Schrift bleibt dabei gleich groß
   (12 px, in den Entwicklerwerkzeugen am Textelement ablesbar).
3. **Kurven unterscheiden.** Neu; Kurve 1/45°, Kurve 2/45°, Kurve 3/45° hintereinander, einpassen
   → „Kurve 1/45°“, „Kurve 2/45°“, „Kurve 3/45°“ bzw. bei weniger Zoom „1/45°“, „2/45°“, „3/45°“.
4. **Schalter.** „Namen“ antippen → alle Namen weg, Symbole (Fall 6) bleiben. Seite neu laden →
   Schalter weiter aus, keine Namen. Wieder an → Namen da, neu laden → an.
5. **Tipp auf den Namen.** Am Laptop auf „Gerade 342“ klicken → genau diese Gerade ist ausgewählt
   (Auswahlleiste „Nr. 1: Gerade 342“), ihr Name bleibt über der Hervorhebung lesbar. Auf einem
   Namen ziehen → die Ansicht verschiebt sich, nichts wird ausgewählt.
6. **Symbole.** Neu; Rundenzähler, Anschlussstück, Spurwechsel gerade, Engstelle, Spurwechselkurve,
   Gerade 342, Kreuzung. Einpassen am Laptop, dann hineinzoomen, bis alle fünf Symbolteile ihren
   Namen zeigen (nach dem Einpassen allein reicht der Platz laut REQ-LBL-2 bei 1280 px Breite nicht
   für jeden Namen; Nachschärfung nach dem Smoke, vom Menschen abgenommen): Rundenzähler mit
   Zielflagge, Anschlussstück mit Stecker, beide Spurwechsel mit dem Spurwechsel-Zeichen, Engstelle
   mit der Taille, jeweils links neben dem Namen, ohne sich zu überdecken; Gerade 342 und Kreuzung ohne Symbol, die Kreuzung mit
   ihrem Querweg. Hovern über einem Symbol zeigt den Namen.
7. **Herauszoomen mit Symbolen.** Aus Fall 6 so weit herauszoomen, bis die Namen weg sind: die
   Symbole stehen allein und bleiben gleich groß; erst wenn das Teil kürzer als etwa 16 px ist,
   verschwinden sie.
8. **Ohne Farbe.** Entwicklerwerkzeuge → Rendering → „Achromatopsia“ emulieren: die vier Symbole
   sind auseinanderzuhalten, die Namen auf Band und Hintergrund lesbar. Kontrast mit dem
   Farbwähler der Entwicklerwerkzeuge: Textfüllung zu `#4b5563` ≥ 4,5, Halo zu `#e9e6df` ≥ 4,5,
   Plakette zum Band ≥ 3, Kontur zu `#e9e6df` ≥ 3.
9. **Handy 360 × 740** (Entwicklerwerkzeuge oder echtes Gerät). Schalter „Namen“ in der
   Werkzeugleiste mit dem Daumen treffbar (≥ 44 × 44), Seite ohne waagerechtes Scrollen. Großes
   Oval (je Seite 4 × Gerade 342) einpassen → Geraden zeigen „342“, Kurven nichts, kein Name ragt
   über einen anderen Namen.

Gegenfälle, die geschlossen bleiben müssen:

10. **Querung ohne Namen.** Die Acht bauen (Kreuzung, …, Querung): am Kreuzungspunkt steht genau
    ein Name („Kreuzung“), kein „Querung“. Die Auswahlleiste zeigt die Querung weiter als
    „Querung“.
11. **Nicht gezeichnete Teile ohne Namen.** Per „Importieren“
    `{"schemaVersion":1,"elements":[{"id":"a","part":"gerade-342"},{"id":"b","part":"steilkehre"},{"id":"c","part":"gerade-342"}]}`
    → nur die erste Gerade hat einen Namen; hinter der Fehlermarke steht nichts.
12. **Schalter ist kein Befehl.** Oval bauen, Schalter umschalten, „Rückgängig“ → das letzte Teil
    verschwindet, der Schalter bleibt, wie er war. „Exportieren“ → die Datei enthält nur
    `schemaVersion` und `elements`.
13. **Schlüssel taucht nirgends auf.** Speichern/Laden-Dialog: keine Zeile „beschriftung“ in der
    Layout-Liste oder den defekten Sicherungen; Bestandsdialog: nicht in der Defekt-Liste.
14. **Kaputter Wert.** `carrera-planer:beschriftung` von Hand auf `vielleicht` setzen, neu laden →
    Namen sichtbar (an), sichtbare Meldung mit „vielleicht“, der Wert steht noch im Speicher; nach
    einmal Umschalten steht `aus`.
15. **Speicher gesperrt** (Website-Einstellungen): Umschalten zeigt eine Meldung, die Namen
    verschwinden trotzdem, die Seite bleibt bedienbar.
16. **Netzwerk-Reiter:** keine Anfragen an fremde Adressen, keine Bilddateien für Symbole
    (REQ-SYM-5).

### Nach dem Deploy

Deploy ist M4; bis dahin gibt es kein Produktivsystem. Erst dort bzw. nur in der echten Welt
prüfbar:

- Der Schalter hängt wie Modus und Layouts an der Adresse: am Dev-Server gewählt heißt nicht auf
  dem Raspi gewählt. Erwartet.
- Auf den echten Geräten (iPhone/Safari, Android/Chrome) prüfen, ob die Namen in ihr Teil passen;
  laufen sie dort sichtbar über, ist die Schätzung 7,5 px je Zeichen zu knapp (Datennachtrag in der
  Logik, keine neue Regel).
- Eine geplante Strecke mit Rundenzähler, Anschlussstück und Spurwechsel auf dem Boden nachbauen:
  Man findet die Sonderteile im Plan ohne Antippen, und die Namen reichen, um Gerade 100 und 114
  bzw. die 45°-Kurven richtig zu greifen.
- Die Symbole neben die echten Teile halten: Erkennt die Familie, welches Zeichen zu welchem Teil
  gehört?
