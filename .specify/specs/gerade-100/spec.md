# Spec: Gerade 100 und die Packung 20061658 (Issue #34)

Status: Entwurf zur Abnahme per Review des Spec-PR. Die Punkte „zur Abnahme“ stehen gesammelt im
Abschnitt „Zur Abnahme“.
Grundlage: Issue #34 („Gerade 100 fehlt im Katalog“), [docs/recherche.md](../../../docs/recherche.md)
(Zeilen 19, 37, 76 f.), [docs/carrera-go-katalog.md](../../../docs/carrera-go-katalog.md) (Zeile 20:
20061658 = „3 x Geraden 100 mm Länge, 3 x Geraden 114 mm Länge“), die umgesetzten Specs
[M1](../m1-rechenkern/spec.md), [M2](../m2-editor/spec.md), [M3a](../m3a-bestand/spec.md) und
[constitution.md](../../constitution.md). Basisstand: `origin/main` = `0bfa1bf`.

**Tier: T2** (vorläufig, advisorisch). Abgeleitet mit devloops `derive-tier` gegen
`.devloop/tier-map.json` aus den geplanten Pfaden `.specify/specs/gerade-100/spec.md`,
`src/catalog/catalog.ts`, `src/catalog/sets.ts`, `src/catalog/catalog.test.ts`,
`src/catalog/sets.test.ts`, `src/web/editor/inventory.ts`, `src/web/editor/shopping.test.ts`,
`src/web/editor/editor.test.ts` → `{"tier":"T2"}`. T2 kommt aus `src/catalog/**`. Gegenproben: nur
`src/web/**` → T1; käme `src/schema/schema.ts` dazu → T3. **Ein Schemawechsel ist nicht nötig**
(siehe „Ohne Schemawechsel“): `articleNumbers: "keineEigene"` und `SetTemplateSchema` gibt es
schon. Das autoritative Tier rechnet CI aus dem tatsächlichen Diff.
Smoke: `.devloop/config.json` schaltet die Smoke-Station nur für T1 und T3 ein. Für T2 läuft sie
nicht als Station; der Abschnitt „Smoke“ ist die Abnahmeliste für den Menschen.

## User Story

Als Bahnbauer, der Carrera-GO!!!-Strecken plant, möchte ich die 100-mm-Gerade im Planer verwenden
und die Packung 20061658 (3 × 100 mm + 3 × 114 mm) als das erfassen, was sie ist — eine Packung,
kein Einzelteil —, damit ich Strecken, die mit 114 mm um 17 mm offen bleiben, mit einer 100er bis
auf wenige Millimeter schließen kann und die Einkaufsliste mir sagt, in welcher Packung ich die
kurzen Geraden bekomme.

## Begriffe

Alles aus M1, M2 und M3a gilt weiter (exakte Koordinate a + b·√2, Element-ID, Leisten-Einteilung,
bestandsfähig, Bestand, Verbrauch, Fehlmenge, Set-Vorlage, Suchbegriff).

- **Packung 20061658:** Carrera-Artikel mit 3 × Gerade 100 und 3 × Gerade 114. Weder Gerade 100
  noch Gerade 114 gibt es einzeln zu kaufen; die Nummer benennt die Packung, nicht ein Teil.
  Sie wird als **Set-Vorlage** geführt (wie Mach 8 oder Ausbauset 1), nicht als Artikelnummer
  eines Katalogeintrags. Das entspricht REQ-CAT-2 aus M1 („Nie ein Verweis auf ein Set, in dem das
  Teil steckt“), gegen das der heutige Katalog mit `gerade-114: ["20061658"]` verstößt.
- **Hobby-Layout:** die Elementfolge im Abschnitt „Hobby-Layout“ (44 Elemente), Startpose wie in M2
  (0, 0, k = 0). Sie dient als Prüfbeispiel, nicht als Vorlage im Produkt.
- **Versatz:** `closure(...).closure.offset` des Kerns, also Startpunkt minus Endpunkt (dx, dy),
  jeweils exakt als a + b·√2 mm.

## Ohne Schemawechsel

Geprüft am Basisstand:

- `CatalogEntrySchema.articleNumbers` erlaubt schon `"keineEigene"` (`src/schema/schema.ts:68`).
- Längen sind positive ganze mm ohne Rasterbedingung (`Millimeters`, `src/schema/schema.ts:15`);
  100 besteht das Schema.
- `SetTemplateSchema` (`src/schema/schema.ts:127` ff.) trägt `name`, `articleNumber`, `source`,
  `certainty`, `contents`; eine Vorlage „3 × gerade-100, 3 × gerade-114“ passt ohne neues Feld.
- Der Hinweis „enthalten in <Packung>, Art.-Nr. …“ wird aus den Set-Vorlagen abgeleitet
  (REQ-EINK-3, geändert), nicht aus einem neuen Hinweisfeld.

Brauchte die Umsetzung doch eine Änderung unter `src/schema`, wäre das T3 und eine neue Abnahme;
das ist ausdrücklich nicht das Ziel.

## Katalog- und Vorlagen-Änderungen

Maßgeblich für REQ-G100-1 bis -3 und die geänderten REQ-CAT-1, REQ-SET-2.

| Eintrag | Art.-Nr. | Geometrie | platzierbar | Sicherheit | Quelle | Prägung |
|---|---|---|---|---|---|---|
| Gerade 100 (`gerade-100`, **neu**, Katalogposition direkt nach `gerade-114`) | keine eigene | Gerade 100 mm | ja | hoch | CT, Artikel 20061658 (Packung 3 × 100 + 3 × 114); Maß laut Carrera, nicht nachgemessen | keine |
| Gerade 114 (`gerade-114`, **geändert**) | keine eigene (bisher 20061658) | Gerade 114 mm (unverändert) | ja | hoch (unverändert) | CT (nur in Packung 20061658), Karton Mach 8 (nachgemessen) | keine |

| Set-Vorlage (**neu**, letzte Position) | Art.-Nr. | Inhalt | Summe | Sicherheit | Quelle |
|---|---|---|---|---|---|
| Geraden 3 × 100 + 3 × 114 (ID z. B. `geraden-100-114`) | 20061658 | gerade-100 × 3, gerade-114 × 3 | 6 | hoch | CT-Seite 20061658 („3 x Geraden 100 mm Länge, 3 x Geraden 114 mm Länge“), docs/carrera-go-katalog.md |

Die übrigen Katalogeinträge und die vier Vorlagen aus M3a bleiben unverändert. Der Katalog hat
danach 20 Einträge (bisher 19), davon 14 platzierbar (bisher 13); es gibt 5 Set-Vorlagen
(bisher 4). Die Summenzeile „Mach 8 + Ausbauset 1 + Ausbauset 3 = 49 Teile“ aus M3a gilt
unverändert (die neue Vorlage gehört nicht dazu).

## Raster-Prüfung (Fundstellen)

100 ist das einzige Maß, das nicht auf dem 57-mm-Raster liegt (docs/recherche.md:19). Geprüft am
Basisstand, wo das bricht und wo nicht:

| Stelle | Befund |
|---|---|
| `src/core/geometry.ts:4-9`, `:44-49` | Kern rechnet in Viertel-mm (bigint), x = (xa + xb·√2)/4; eine Gerade L verschiebt um f = 2L. Jede ganze mm-Länge ist exakt darstellbar, 100 also auch. **Bricht nicht.** |
| `src/schema/schema.ts:15` | `Millimeters` = positive ganze Zahl, keine Rasterbedingung. **Bricht nicht.** |
| `src/catalog/catalog.test.ts:294-310` (REQ-CAT-5, M1) | Prüft „Geradenlängen sind Vielfache von 57“. **Bricht** mit `gerade-100` → REQ-CAT-5 wird geändert (unten). |
| M1-Spec, „Darstellbares Raster“ (Zeilen 34-37) | „mindestens“ alle Vielfachen von 28,5 mm; der Satz „Jeder Endpunkt, den die Katalogteile von M1 erreichen, liegt darauf“ gilt für den M1-Katalog und mit Gerade 100 nicht mehr. Keine Prüfung hängt daran außer REQ-CAT-5. |
| M1-Spec, Nicht-Ziele (Zeile 380) | „Nicht im Katalog: Gerade 100 mm (bricht das 57-mm-Raster, nicht im Bestand)“ — wird durch diese Spec aufgehoben. |
| `.specify/constitution.md:7-8`, `KONZEPT.md:45-52` | Text: „fester Nenner in Einheiten von 57 mm“. Die Implementierung nutzt Viertel-mm (M1, Entscheidung 5: interne Einheit offen, geprüft wird die Wirkung). Mit Gerade 100 stimmt der Wortlaut nicht mehr → **zur Abnahme** (Wortlaut nachziehen, geschützte Datei). |
| `src/core/core.test.ts:504-512` | `arbRasterCoord` erzeugt Startposen auf dem 28,5-mm-Raster: ein Testgenerator, keine Produktannahme. Bricht nicht. |
| `src/web/editor/drawing.ts:12-14`, `:85-90` | Gleitkomma nur zur Darstellung; ±57 ist die halbe Schienenbreite (Bandränder), kein Raster. Bricht nicht. |
| `src/web/ui/canvas.tsx:57-58` | ±57 als Bandbreite (Normale). Bricht nicht. |
| `src/web/ui/view.ts:15-45`, `:94-103` | Zoom (Skala 0,01–20) und Bounding-Box aus Gleitkommapunkten, ohne Raster. Bricht nicht. |
| `src/web/editor/status.ts:18-25` | Lücke: `hypot` gerundet auf ganze mm, „< 1 mm“ nur bei exakt ≠ 0. Bricht nicht. |
| `src/web/editor/status.ts:80-106` | Gesamtlänge summiert `g.length`. Bricht nicht. |
| `src/web/editor/editor.ts:241-258` | Leisten-Einteilung in Katalogreihenfolge, keine Sortierung nach Länge. Bricht nicht. |
| `src/web/ui/app.tsx:63-75` | Leistensymbol: Geraden ≥ 342 lang, ≥ 228 mittel, sonst kurz. Gerade 100 bekommt dasselbe Symbol wie Gerade 114; unterscheidbar nur am Namen → bekannte Grenze. |
| Fang, Rasterlinien, Kollision/Überschneidung | Gibt es im Code nicht (keine Fundstelle für snap/Fang/Raster/Überschneidung außerhalb von Tests). Nichts zu brechen. |

## Hobby-Layout

Elementfolge (Element-IDs `e1` … `e44`, Kurven mit Richtung L = links, R = rechts):

```
e1  rundenzaehler      e12 kurve-3-45 L       e23 gerade-114         e34 kurve-3-45 R
e2  gerade-114         e13 kurve-3-45 R       e24 gerade-342         e35 kurve-1-45 R
e3  anschlussstueck    e14 gerade-342         e25 kurve-2-45 R       e36 kurve-2-45 R
e4  gerade-114         e15 kurve-2-45 R       e26 kurve-1-45 R       e37 kurve-3-45 R
e5  spurwechsel-gerade e16 gerade-342         e27 kurve-1-90 R       e38 kurve-1-90 L
e6  gerade-114         e17 kurve-2-45 R       e28 gerade-171         e39 kurve-1-90 L
e7  gerade-114         e18 kurve-2-45 R       e29 spurwechsel-gerade e40 kurve-2-45 L
e8  gerade-342         e19 kurve-3-45 R       e30 gerade-114         e41 gerade-342
e9  kurve-2-45 L       e20 gerade-342         e31 gerade-342         e42 kurve-3-45 L
e10 kurve-1-90 L       e21 gerade-171         e32 kurve-3-45 L       e43 kurve-3-45 L
e11 kurve-2-45 L       e22 gerade-114         e33 gerade-342         e44 gerade-342
```

Gerechnet mit `closure` aus `src/core` am Basisstand (Katalog im Test um `gerade-100` ergänzt):

| Variante | dx (exakt) | dx ≈ | dy (exakt) | dy ≈ | Winkel | Lücke (REQ-STAT-2) |
|---|---|---|---|---|---|---|
| wie oben (sieben × Gerade 114) | −1710 + 1197·√2 | −17,186 | 1368 − 969·√2 | −2,373 | 0 | „17 mm“ |
| `e2` durch Gerade 100 ersetzt | −1696 + 1197·√2 | −3,186 | 1368 − 969·√2 | −2,373 | 0 | „4 mm“ |
| `e30` durch Gerade 100 ersetzt | −1724 + 1197·√2 | −31,186 | 1368 − 969·√2 | −2,373 | 0 | „31 mm“ |

Dasselbe Ergebnis wie für `e2` liefert der Tausch an `e4`, `e6`, `e7`, `e22` oder `e23` (alle in
Richtung k = 0). Der √2-Anteil (1197 bzw. −969) ändert sich durch keinen Tausch einer Geraden; mit
Geraden allein schließt die Strecke deshalb exakt nie. Das ist kein Fehler, sondern der Anlass für
#27 (Toleranz) und nicht Teil dieser Spec.

## Akzeptanzkriterien

### Neue Kriterien

- **REQ-G100-1** [Where] Der Katalog enthält `gerade-100` genau nach der Tabelle
  „Katalog- und Vorlagen-Änderungen“: Name „Gerade 100“, `articleNumbers: "keineEigene"`,
  Geometrie Gerade 100 mm, Sicherheit „hoch“, nicht leere Quelle, **kein** Feld `praegung`, an der
  Katalogposition direkt nach `gerade-114`. Der Eintrag besteht `CatalogEntrySchema`.
- **REQ-G100-2** [Where] `gerade-114` führt `articleNumbers: "keineEigene"` statt `["20061658"]`;
  Geometrie, Name, Sicherheit und Position bleiben. Kein Katalogeintrag führt `20061658`.
- **REQ-G100-3** [Contract] Packungsnummer ist keine Teilenummer: Keine Artikelnummer einer
  Set-Vorlage kommt als Artikelnummer eines Katalogeintrags vor. Wirkungsnachweis mit verändertem
  Katalog: Bekommt `gerade-114` wieder `["20061658"]`, schlägt die Prüfung fehl; bekommt
  `gerade-342` die Mach-8-Nummer `20062492`, ebenso.
- **REQ-G100-4** [When] Wenn die Set-Vorlage „Geraden 3 × 100 + 3 × 114“ gewählt und bestätigt
  wird (REQ-SET-4, REQ-BUI-2), steigt der Bestand von `gerade-100` und `gerade-114` um je 3; alle
  anderen Anzahlen bleiben. Beispiel: leerer Bestand + Mach 8 + diese Vorlage → `gerade-114` 4,
  `gerade-100` 3, `gerade-342` 4. Die Rückfrage zeigt „Gerade 100 × 3“, „Gerade 114 × 3“,
  „zusammen 6 Teile“ und Art.-Nr. 20061658; der Hinweis „Inhalt ungeprüft“ erscheint nicht
  (Sicherheit „hoch“).
- **REQ-G100-5** [When] Gerade 100 verhält sich im Kern wie jede Gerade: aus (0, 0, k) eine
  Verschiebung um exakt 100 mm in Richtung k (Spezialfall von REQ-CORE-2, ohne Änderung an
  `src/core`). Beispiele: Gerade 100 allein aus (0, 0, 0) → Versatz dx = −100, dy = 0; Gerade 100
  + Gerade 114 → dx = −214. Das Oval aus Gerade 100, 2 × Kurve 1/90° L, Gerade 100,
  2 × Kurve 1/90° L ist exakt „geschlossen“ (Versatz 0, Winkel 0).
- **REQ-G100-6** [When] **Hobby-Layout.** `closure` liefert für das Hobby-Layout und seine
  Varianten genau die Werte der Tabelle im Abschnitt „Hobby-Layout“ (exakt als a + b·√2, Status
  „offen“, Winkel 0): mit Gerade 114 an `e2` dx = −1710 + 1197·√2, dy = 1368 − 969·√2; mit
  Gerade 100 an `e2` dx = −1696 + 1197·√2, dy unverändert; mit Gerade 100 an `e30`
  dx = −1724 + 1197·√2. Die Statusanzeige der Editor-Logik (`statusOf`) zeigt dafür „17 mm“,
  „4 mm“ bzw. „31 mm“. Eigenschaft: Ersetzt man in einer beliebigen fehlerfreien Folge eine
  Gerade 114 durch eine Gerade 100 (Folge ohne Querungen), ändert sich der Versatz genau um 14·e(k) (k = Richtung am
  Eingang dieses Elements), der √2-Anteil von dx und dy bleibt bei k ∈ {0, 2, 4, 6} gleich.
- **REQ-G100-7** [Where] Leiste und Bestandsmodus ohne Sonderfall: In der Sandbox ist Gerade 100
  platzierbar und steht in der Leiste direkt nach Gerade 114. Im Modus „Bestand“ entfällt sie bei
  Bestand 0 wie jedes bestandsfähige Teil (REQ-MODUS-5): mit Bestand Mach 8, Ausbauset 1,
  Ausbauset 3 oder deren Summe erscheint sie nicht; nach Hinzufügen der Vorlage
  „Geraden 3 × 100 + 3 × 114“ erscheint sie mit Bestand 3. Ein Befehl, der eine vierte Gerade 100
  hinzufügen würde, wird bei Bestand 3 abgewiesen (REQ-MODUS-3).
- **REQ-G100-8** [Architektur] Diese Änderung berührt keine Datei unter `src/core`, `src/schema`
  und `src/server` und keine Datei im geschützten Satz (`.devloop/protected-globs.json`, darunter
  `src/web/test-support/**`). Die Testhilfen leiten Teillisten schon aus `CATALOG` ab
  (`src/web/test-support/editor-fixtures.ts:378-379`, `:534`) und brauchen keine Änderung.
- **REQ-G100-9** [Architektur] Der Mutations-Ratchet (`break=100`) endet ohne überlebenden
  Mutanten in `src/catalog` und `src/web/editor`; `stryker.config.json` bleibt unverändert.

### Geänderte Kriterien (IDs bleiben, damit Tests und Trace die Zuordnung halten)

- **REQ-CAT-1** (M1, geändert) [Where] Der Katalog enthält genau die Einträge der Tabelle
  „Katalog M1“ mit den Änderungen aus „Katalog- und Vorlagen-Änderungen“ dieser Spec: zusätzlich
  `gerade-100`, und `gerade-114` mit „keine eigene“ Artikelnummer; 20 Einträge, 14 platzierbar.
- **REQ-CAT-5** (M1, geändert) [Contract] Jede Geometrie eines platzierbaren Eintrags hat Winkel
  45° oder 90°; Radien sowie Längs- und Querweg der Kreuzung sind Vielfache von 57 mm, der Querweg
  ist höchstens so lang wie der Längsweg. Geradenlängen sind Vielfache von 57 mm **mit genau einer
  benannten Ausnahme: `gerade-100` (100 mm)**. Wirkungsnachweis mit verändertem Katalog: Eine
  Gerade 171 mit 170 mm, eine Kurve mit Radius 170 oder eine zweite Gerade abseits des Rasters
  (z. B. eine Kopie von `gerade-100` unter anderer ID) lässt die Prüfung scheitern.
- **REQ-EDIT-21** (M2, geändert, nur das Beispiel) Mit dem aktuellen Katalog sind die 14 Einträge
  von Gerade 342 bis Rundenzähler platzierbar (Gerade 100 an vierter Stelle); „Maße fehlen“ und
  „ausgeblendet“ unverändert.
- **REQ-SET-2** (M3a, geändert) [Where] `src/catalog` exportiert die Set-Vorlagen der Tabelle
  „Set-Vorlagen M3a“ und danach die Vorlage „Geraden 3 × 100 + 3 × 114“ (fünf Vorlagen, in dieser
  Reihenfolge). Die Summe Mach 8 + Ausbauset 1 + Ausbauset 3 bleibt 49 Teile mit `gerade-114` 1.
- **REQ-EINK-3** (M3a, geändert) [When] Suchbegriffe je Zeile wie bisher, mit einer Ergänzung im
  dritten Fall (weder Artikelnummer noch Prägung): Nach dem Hinweis „keine Artikelnummer, keine
  Prägung bekannt“ und den Baugruppen-Einträgen „enthalten in <Name der Baugruppe>, Art.-Nr. …“
  folgt für jede **Set-Vorlage**, deren Inhalt das Teil enthält, in Vorlagenreihenfolge ein
  Hinweis „enthalten in <Name der Vorlage>, Art.-Nr. <articleNumber>“ (Vorschlag, **zur
  Abnahme**). Die Vorlagen kommen aus `src/catalog` und sind für Tests austauschbar (wie der
  Katalog). Teile mit Artikelnummer oder Prägung bekommen keine Vorlagen-Hinweise.
  Beispiele mit leerem Bestand:
  - Gerade 100 → „keine Artikelnummer, keine Prägung bekannt“, „enthalten in Geraden 3 × 100 +
    3 × 114, Art.-Nr. 20061658“.
  - Gerade 114 → „keine Artikelnummer, keine Prägung bekannt“, „enthalten in Mach 8, Art.-Nr.
    20062492“, „enthalten in Geraden 3 × 100 + 3 × 114, Art.-Nr. 20061658“.
  - Looping-Teil (L) → „keine Artikelnummer, keine Prägung bekannt“, „enthalten in Looping
    (Baugruppe), Art.-Nr. 20061613“, „enthalten in Mach 8, Art.-Nr. 20062492“ (**neu** gegenüber
    M3a).
  - Steilkehre-Teil (K), Anschlussstück, Gerade 342, Kurve 1/90°: unverändert wie in M3a.

  Wirkungsnachweis mit veränderter Vorlagenliste: ohne die neue Vorlage zeigt Gerade 114 nur den
  Mach-8-Hinweis und Gerade 100 nur „keine Artikelnummer, keine Prägung bekannt“; eine Vorlage, die
  `gerade-342` enthält, erzeugt bei Gerade 342 keinen Hinweis (sie hat eine Artikelnummer).

### Einkaufsliste: Einzelteile, keine Packungsrechnung

- **REQ-G100-10** [When] Die Einkaufsliste bleibt bei Einzelteilen (M3a, Entscheidung 4 zum Umfang):
  Gerade 100 und Gerade 114 stehen als **getrennte Zeilen** mit eigener Fehlmenge; sie werden
  nicht zu einer Packungszeile zusammengefasst und nicht auf Packungen gerundet (Vorschlag, **zur
  Abnahme**). Beispiele: Oval aus REQ-G100-5 mit leerem Bestand → Gerade 100 fehlt 2,
  Kurve 1/90° fehlt 4, zusammen 6, in Katalogreihenfolge (Gerade 100 vor Kurve 1/90°). Hobby-Layout
  mit Gerade 100 an `e2` und Bestand Mach 8 → Gerade 100 benötigt 1, vorhanden 0, fehlt 1;
  Gerade 114 benötigt 6, vorhanden 1, fehlt 5; beide Zeilen mit dem Hinweis auf 20061658. Mit
  Bestand Mach 8 + zweimal „Geraden 3 × 100 + 3 × 114“ fehlt keine der beiden Geraden mehr.

## Nicht-Ziele

- Einkaufsliste in Packungen (aufrunden, „1 × 20061658 deckt 1 × 100 und 2 × 114“), Preise,
  Händlerlinks. Folge-Issue vorgeschlagen: „Einkaufsliste in kaufbaren Packungen“ (KONZEPT
  „später“). Grund: braucht eine Zuordnung Teil → kleinste Packung und eine Rundung über
  mehrere Teile je Packung; das ist mehr Logik als diese Katalogergänzung.
- Toleranz beim Schließen (#27), Folge-Issues #35 und #36.
- Änderungen am Schema (kein Feld für Packungs- oder Hinweistexte), am Kern und am Server.
- Prägung für Gerade 100 oder Gerade 114 (unbekannt; kommt als Datennachtrag).
- Eigenes Leistensymbol für Gerade 100.
- Änderung der Texte in Constitution und KONZEPT (geschützt bzw. eigene Abnahme; siehe
  „Zur Abnahme“).

## Bekannte Grenzen

- **Maß 100 mm nicht nachgemessen.** Quelle ist die Carrera-Angabe (Sicherheit hoch). Am echten
  Teil nachmessen; weicht es ab, ist der Katalogwert falsch (Datennachtrag).
- **Gleiches Symbol.** Gerade 100 und Gerade 114 haben in der Leiste dasselbe kurze Symbol
  (`src/web/ui/app.tsx:68-69`); der Name unterscheidet sie.
- **Bestandsdialog zeigt „keine Artikelnummer“** für Gerade 100 und Gerade 114
  (`numbersOf`, `src/web/ui/inventory-dialog.tsx:27-33`). Den Weg zur Packung zeigt der
  Vorlagen-Knopf im selben Dialog; die Einkaufsliste nennt die Packung (REQ-EINK-3).
- **Gespeicherte Bestände** mit `gerade-114` bleiben gültig und zählen weiter; der Bestand
  `gerade-100` startet bei 0. Gespeicherte Layouts sind nicht betroffen.
- **Kein exakter Schluss.** Das Hobby-Layout bleibt mit jeder Geradenkombination offen
  (√2-Anteil); „schließt mit Spiel“ ist #27.

## Bestehende Tests, die sich ändern müssen

Diese Tests schreiben heute Zahlen oder Listen fest, die mit dieser Spec anders werden; sie werden
von spec-to-tests angepasst, nicht übersprungen:

- `src/catalog/catalog.test.ts:60-196` (`EXPECTED`, `PLACEABLE`), Test REQ-CAT-1 (`:211`, `:219`,
  `:241`): neuer Eintrag `gerade-100`, `gerade-114` mit `"keineEigene"` (`:74-76`), 20 statt 19
  Einträge, 14 statt 13 platzierbar.
- `src/catalog/catalog.test.ts:294-310` (REQ-CAT-5): Ausnahme `gerade-100`.
- `src/catalog/sets.test.ts:52-91` (`EXPECTED`), `:127` (REQ-SET-2, fünf Vorlagen), `:143-160`
  (49-Teile-Summe filtert heute nur `20061676` heraus und muss die neue Vorlage ebenfalls
  ausnehmen).
- `src/web/editor/editor.test.ts:528-545` (REQ-EDIT-21: `slice(0, 13)`, `[12]` = Rundenzähler).
- `src/web/editor/shopping.test.ts:174-198` (REQ-EINK-3: Looping-Teil bekommt den Mach-8-Hinweis).

`src/web/test-support/*` (geschützt) bleibt unverändert (REQ-G100-8).

## Zur Abnahme

1. **Hinweis aus Set-Vorlagen für alle Vorlagen** (REQ-EINK-3 geändert). Vorschlag: jede Vorlage,
   die das Teil enthält, in Vorlagenreihenfolge. Folge: Gerade 114 nennt zuerst Mach 8, dann die
   Packung; das Looping-Teil (L) bekommt zusätzlich „enthalten in Mach 8“ (Änderung gegenüber
   M3a-Smoke-Fall 6). Grund: einfachste Regel, ehrlich, ohne neues Feld. Alternative: nur
   Vorlagen, deren Teile alle keine eigene Artikelnummer haben (trifft heute genau die neue
   Packung, lässt L unverändert) — kürzer in der Anzeige, aber eine schwer erklärbare Regel.
2. **Getrennte Zeilen, keine Packungsrechnung** (REQ-G100-10). Gerade 100 und 114 bleiben
   getrennte Einzelteilzeilen mit gleichem Packungshinweis; Aufrunden auf Packungen ist Nicht-Ziel
   mit vorgeschlagenem Folge-Issue. Grund: M3a hat „Einzelteile, keine Packungen“ abgenommen; eine
   Packungsrechnung braucht eine Teil→Packung-Zuordnung über mehrere Teile.
3. **Name der neuen Vorlage** „Geraden 3 × 100 + 3 × 114“ (trägt den Inhalt im Namen, damit der
   Hinweis ohne weitere Logik „3 × 100 + 3 × 114“ zeigt). Alternative: neutraler Name
   („Geraden kurz“) und Inhalt im Hinweis aus `contents` ableiten (mehr Logik, langer Text bei
   Mach 8).
4. **Katalogposition** von Gerade 100 direkt nach Gerade 114 (Geraden absteigend). Bestimmt die
   Reihenfolge in Leiste, Bestandsdialog und Einkaufsliste.
5. **Constitution und KONZEPT** sagen „fester Nenner in Einheiten von 57 mm“. Der Kern rechnet in
   Viertel-mm, Gerade 100 ist exakt darstellbar; der Wortlaut stimmt aber nicht mehr. Vorschlag:
   eigener kleiner PR (Constitution geschützt, Admin-Override; KONZEPT mit Abnahme), etwa „exakt
   als a + b·√2 mit rationalen a, b; Längen in ganzen mm“. Blockiert diese Spec nicht.
6. **Geänderte REQs aus M1/M2/M3a mit alten IDs** (REQ-CAT-1, REQ-CAT-5, REQ-EDIT-21, REQ-SET-2,
   REQ-EINK-3). Sie stehen geändert in dieser Spec; die alten Spec-Dateien bleiben unverändert.
   Falls die Trace-Prüfung eine ID nur in einer Spec erwartet, bekommen die alten Specs einen
   Verweis „geändert durch gerade-100“.

## Smoke

**Aufrufer des geänderten Pfads: die Browser-Oberfläche, sonst niemand.** Nachgesehen am
Basisstand `0bfa1bf`:

- Einstieg `src/web/index.ts:6-7` → `mount` in `src/web/ui/app.tsx:547-555`, das die Sitzung mit
  `catalog` und `templates: SET_TEMPLATES` baut (`createPlannerSession`,
  `src/web/editor/planner-session.ts:66-70`; Vorlage addieren `:214`).
- Katalog und Vorlagen bezieht nur die Oberfläche: `src/web/ui/app.tsx:10` (Import),
  `:45` (`catalog`), Leiste `:243` (`paletteEntries`), Einkaufsliste `:147` (`shoppingList`,
  `src/web/editor/inventory.ts:221`; Suchbegriffe `:198-215`), Bestandsdialog `:535`
  (`templates={SET_TEMPLATES}`, Knöpfe `src/web/ui/inventory-dialog.tsx:82`).
- `src/server/index.ts:2` ist ein Platzhalter; MCP oder andere Dienste rufen nichts auf.

Start wie in M3a: `pnpm dev --host`, Laptop, Tablet, Handy. Vorher „Bestand leeren“.

1. **Leiste.** Sandbox: Gerade 100 steht direkt nach Gerade 114 und ist antippbar.
2. **Oval mit 100ern.** Neu; Gerade 100, zwei Kurven 1/90° links, Gerade 100, zwei Kurven 1/90°
   links → „geschlossen“, Länge „1,27 m“. Einkaufsliste: Gerade 100 fehlt 2 mit „keine
   Artikelnummer, keine Prägung bekannt“ und „enthalten in Geraden 3 × 100 + 3 × 114, Art.-Nr.
   20061658“; Kurve 1/90° fehlt 4; zusammen 6.
3. **Packung erfassen.** Bestandsdialog: Knopf „Geraden 3 × 100 + 3 × 114“ mit 20061658, ohne
   „Inhalt ungeprüft“. Rückfrage zeigt Gerade 100 × 3, Gerade 114 × 3, zusammen 6; „Hinzufügen“ →
   beide Zähler 3. Seite neu laden → bleibt.
4. **Bestandsmodus.** Leeren, Mach 8 hinzufügen, Modus „Bestand“ → keine Gerade 100 in der Leiste.
   Packung hinzufügen → Gerade 100 mit Rest 3; viermal tippen → nach dem dritten gesperrt.
5. **Hobby-Layout.** Hobby-Layout als Datei importieren (Elementfolge oben) → Status „offen“,
   Lücke „17 mm“, Winkel 0. `e2` durch Gerade 100 ersetzen → „4 mm“. Rückgängig, `e30` ersetzen →
   „31 mm“ (falsche Stelle, die Lücke wächst).
6. **Gerade 114 in der Einkaufsliste.** Bestand leeren, die Acht bauen → Gerade 114 zeigt keine
   Artikelnummer mehr, sondern die Hinweise auf Mach 8 (20062492) und die Packung (20061658).

Gegenfälle, die geschlossen bleiben müssen:

7. Kein Katalogeintrag und keine Zeile der Einkaufsliste zeigt 20061658 als Artikelnummer
   (nur als „enthalten in …“).
8. Die drei M3a-Packungen (Mach 8, Ausbauset 1, Ausbauset 3) erhöhen Gerade 100 nicht; ihre
   Summe bleibt 49 Teile.
9. Ein älterer gespeicherter Bestand (z. B. Mach 8 vor dem Update) lädt ohne Meldung,
   Gerade 114 = 1, Gerade 100 = 0.
10. Anschlussstück, Gerade 342 und Steilkehre-Teil (K) zeigen in der Einkaufsliste dieselben
    Suchbegriffe wie in M3a; nur Looping-Teil (L) bekommt den zusätzlichen Mach-8-Hinweis.
11. Netzwerk-Reiter: keine Anfragen an fremde Adressen (REQ-BUI-6).

### Nach dem Deploy

Deploy ist M4; bis dahin gibt es kein Produktivsystem. Nur in der echten Welt prüfbar:

- Eine Gerade 100 aus einer Packung 20061658 nachmessen (Mittellinie, Steckverbindung wie bei
  Gerade 114). Weicht das Maß ab, ist der Katalogwert falsch.
- Prägung an Gerade 100 und Gerade 114 ablesen (Datennachtrag, #28-Muster).
- Das Hobby-Layout mit einer Gerade 100 an der Startgeraden aufbauen: Die Lücke von etwa 4 mm
  (3,2 mm längs, 2,4 mm quer) muss sich stecken lassen; das ist die Messgröße für #27.
- „20061658“ bei einem Händler eingeben: findet die Packung 3 × 100 + 3 × 114.
