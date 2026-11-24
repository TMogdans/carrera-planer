/**
 * Set-Vorlagen (Spec M3a, Tabelle „Set-Vorlagen M3a“, REQ-SET-2/-3; danach die Packung 20061658
 * aus Spec gerade-100): Packungen mit fester Teileliste, deren Inhalt auf den Bestand addiert
 * wird. Reine Daten in Tabellenreihenfolge.
 * Stützen und Regler sind keine Katalogteile und fehlen deshalb.
 */
import type { SetTemplate } from "../schema/schema.js";

export const SET_TEMPLATES: ReadonlyArray<SetTemplate> = [
  {
    id: "mach-8",
    name: "Mach 8",
    articleNumber: "20062492",
    source: "Zeichnung der Anleitung, am Karton bestätigt 2026-11-23",
    certainty: "hoch",
    contents: [
      { part: "gerade-342", count: 4 },
      { part: "gerade-114", count: 1 },
      { part: "kurve-1-90", count: 6 },
      { part: "engstelle", count: 1 },
      { part: "kreuzung", count: 1 },
      { part: "anschlussstueck", count: 1 },
      { part: "rundenzaehler", count: 1 },
      { part: "looping-teil", count: 8 },
      { part: "steilkehre-teil", count: 4 },
    ],
  },
  {
    id: "ausbauset-1",
    name: "Ausbauset 1",
    articleNumber: "20061600",
    source: "Händlerangabe; welcher Spurwechsel, ungeprüft (#2)",
    certainty: "niedrig",
    contents: [
      { part: "kurve-1-90", count: 2 },
      { part: "spurwechsel-gerade", count: 2 },
      { part: "gerade-342", count: 2 },
    ],
  },
  {
    id: "ausbauset-3",
    name: "Ausbauset 3",
    articleNumber: "20061614",
    source: "CT-Seite 20061614; nicht am Karton geprüft",
    certainty: "mittel",
    contents: [
      { part: "gerade-342", count: 8 },
      { part: "kurve-1-45", count: 4 },
      { part: "steilkurve-1-45", count: 4 },
    ],
  },
  {
    id: "wireless-upgrade-kit",
    name: "Wireless Upgrade Kit",
    articleNumber: "20061676",
    source: "CT-Seite 20061676 („1x Wireless Anschlussschiene, 2x Wireless Handregler“)",
    certainty: "hoch",
    contents: [{ part: "wireless-anschluss", count: 1 }],
  },
  {
    id: "geraden-100-114",
    name: "Geraden 3 × 100 + 3 × 114",
    articleNumber: "20061658",
    source:
      "CT-Seite 20061658 („3 x Geraden 100 mm Länge, 3 x Geraden 114 mm Länge“), docs/carrera-go-katalog.md",
    certainty: "hoch",
    contents: [
      { part: "gerade-100", count: 3 },
      { part: "gerade-114", count: 3 },
    ],
  },
];
