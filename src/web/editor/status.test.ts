/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Editor-Logik — Status, Lücke und Winkel,
 * Fehlerliste, Teileverbrauch, Gesamtlänge. Abnahmetests REQ-STAT-1 bis REQ-STAT-5 und
 * REQ-WARCH-3.
 *
 * Schnittstelle (Typen: src/web/test-support/editor-fixtures.ts), Modul `src/web/editor/status.ts`:
 *   statusOf(catalog, elements): StatusView
 *     { kind: "leer" } | { kind: "geschlossen" } | { kind: "offen", gapText, angleDeg }
 *     | { kind: "fehlerhaft" }
 *   formatGap(offset: Offset): string                "342 mm", "< 1 mm", "0 mm"
 *   errorEntries(catalog, elements): ErrorEntry[]    { numbers (Index + 1), name, text }
 *   consumptionView(catalog, elements)               { ok: true, entries, total } | { ok: false, text }
 *   totalLength(catalog, elements): number | undefined   mm, Gleitkomma
 *   formatLength(mm | undefined): string             "1,76 m" bzw. "–"
 *
 * Orakel für Status, Fehler und Verbrauch ist der Kern selbst (REQ-STAT-1, REQ-WARCH-3); für die
 * Länge rechnen die Tests aus den Zahlen der Spec.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { closure, consumption, type TraceError } from "../../core/index.js";
import {
  ACHT,
  ACHT_G171,
  CATALOG,
  type CatalogEntry,
  coord,
  elementsArb,
  expectNear,
  type LayoutElement,
  loadStatus,
  ORIGIN,
  OVAL,
  rat,
  replaceAt,
  validElementsArb,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

const ERROR_TEXT: Record<TraceError["kind"], string> = {
  unbekanntesTeil: "Teil unbekannt",
  nichtPlatzierbar: "Maße fehlen, nicht platzierbar",
  richtungFehlt: "Kurvenrichtung fehlt",
  richtungUeberzaehlig: "Richtung bei Nicht-Kurve",
  ungueltigerVerweis: "Querung verweist auf keine frühere Kreuzung",
  bereitsGequert: "Kreuzung bereits gequert",
  ankunftNichtAmQueranschluss: "Strecke kommt nicht am Queranschluss an",
  doppelteElementId: "doppelte Element-ID",
};

const curves = (n: number, turn: "links" | "rechts", part = "kurve-1-90"): Elements =>
  Array.from({ length: n }, (_, i) => ({ id: `k${i}`, part, turn }));

describe("Status", () => {
  test.skip("[REQ-STAT-1] Status leer/geschlossen/offen/fehlerhaft an den Abnahmefällen", async () => {
    const S = await loadStatus();
    expect(S.statusOf(CATALOG, [])).toEqual({ kind: "leer" });
    expect(S.statusOf(CATALOG, OVAL)).toEqual({ kind: "geschlossen" });
    expect(S.statusOf(CATALOG, ACHT)).toEqual({ kind: "geschlossen" });
    expect(S.statusOf(CATALOG, curves(4, "rechts"))).toEqual({ kind: "geschlossen" });
    expect(S.statusOf(CATALOG, OVAL.slice(0, 5)).kind).toBe("offen");
    expect(S.statusOf(CATALOG, ACHT_G171)).toEqual({ kind: "fehlerhaft" });
    expect(S.statusOf(CATALOG, [{ id: "x", part: "looping" }])).toEqual({ kind: "fehlerhaft" });
  });

  test.skip("[REQ-STAT-1] Eigenschaft: Status folgt ausschließlich closure des Kerns", async () => {
    const S = await loadStatus();
    fc.assert(
      fc.property(fc.oneof(elementsArb, validElementsArb), (elements) => {
        const r = closure(CATALOG, elements, ORIGIN);
        expect(S.statusOf(CATALOG, elements).kind).toBe(r.ok ? r.closure.status : "fehlerhaft");
      }),
      { numRuns: 300 },
    );
  });

  test.skip("[REQ-STAT-2] Offen: Lücke auf ganze mm, Winkel × 45° mit Vorzeichen (3 × Kurve links; Oval ohne letzte Gerade)", async () => {
    const S = await loadStatus();
    expect(S.statusOf(CATALOG, curves(3, "links"))).toEqual({
      kind: "offen",
      gapText: "242 mm",
      angleDeg: 90,
    });
    expect(S.statusOf(CATALOG, curves(3, "rechts"))).toEqual({
      kind: "offen",
      gapText: "242 mm",
      angleDeg: -90,
    });
    expect(S.statusOf(CATALOG, OVAL.slice(0, 5))).toEqual({
      kind: "offen",
      gapText: "342 mm",
      angleDeg: 0,
    });
    // 2 × Kurve links: Ende (0, 342) mit Richtung k = 4, Winkel 180°
    expect(S.statusOf(CATALOG, curves(2, "links"))).toEqual({
      kind: "offen",
      gapText: "342 mm",
      angleDeg: 180,
    });
    // Gleiche Position, andere Richtung (Kurve links, 3 × Kurve rechts, Gerade 342): Versatz
    // exakt null → „0 mm“, aber offen mit Winkel 180° (keine Rundung entscheidet über geschlossen)
    const uTurn: Elements = [
      { id: "w1", part: "kurve-1-90", turn: "links" },
      { id: "w2", part: "kurve-1-90", turn: "rechts" },
      { id: "w3", part: "kurve-1-90", turn: "rechts" },
      { id: "w4", part: "kurve-1-90", turn: "rechts" },
      { id: "w5", part: "gerade-342" },
    ];
    expect(S.statusOf(CATALOG, uTurn)).toEqual({ kind: "offen", gapText: "0 mm", angleDeg: 180 });
    // 1 × Kurve 1/45° links: Versatz 171·√(2 − √2) ≈ 130,9 mm, Winkel −45°
    expect(S.statusOf(CATALOG, curves(1, "links", "kurve-1-45"))).toEqual({
      kind: "offen",
      gapText: "131 mm",
      angleDeg: -45,
    });
  });

  test.skip("[REQ-STAT-2] Lücke unter 0,5 mm bei Versatz ≠ 0 zeigt „< 1 mm“, exakt null zeigt „0 mm“", async () => {
    const S = await loadStatus();
    const zero = coord(rat(0n), rat(0n));
    // dx = 28,5·(99 − 70·√2) ≈ 0,14 mm
    const tiny = coord(rat(5643n, 2n), rat(-1995n));
    expect(S.formatGap({ dx: tiny, dy: zero })).toBe("< 1 mm");
    expect(S.formatGap({ dx: zero, dy: tiny })).toBe("< 1 mm");
    expect(S.formatGap({ dx: zero, dy: zero })).toBe("0 mm");
    expect(S.formatGap({ dx: coord(rat(0n, 4n), rat(0n, 4n)), dy: zero })).toBe("0 mm");
    // Rundungsgrenzen: 0,5 mm → „1 mm“ (nicht „< 1 mm“), 341,5 → „342 mm“
    expect(S.formatGap({ dx: coord(rat(1n, 2n)), dy: zero })).toBe("1 mm");
    expect(S.formatGap({ dx: coord(rat(-683n, 2n)), dy: zero })).toBe("342 mm");
    // Betrag: (3, 4) → 5 mm
    expect(S.formatGap({ dx: coord(rat(-3n)), dy: coord(rat(4n)) })).toBe("5 mm");
  });

  test.skip("[REQ-STAT-3] Fehlerliste: Acht mit Gerade 171 → genau ein Eintrag Nr. 6", async () => {
    const S = await loadStatus();
    const entries = S.errorEntries(CATALOG, ACHT_G171);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      numbers: [6],
      text: "Strecke kommt nicht am Queranschluss an",
    });
    expect(S.errorEntries(CATALOG, ACHT)).toEqual([]);
    expect(S.errorEntries(CATALOG, [])).toEqual([]);
  });

  test.skip("[REQ-STAT-3] Fehlerliste: deutsche Texte je Fehlerart, Teilname, bei doppelter ID alle Nummern", async () => {
    const S = await loadStatus();
    const elements: Elements = [
      { id: "a", part: "gerade-342" },
      { id: "b", part: "gibt-es-nicht" },
      { id: "c", part: "looping" },
      { id: "d", part: "kurve-1-90" },
      { id: "e", part: "gerade-114", turn: "links" },
      { id: "f", crosses: "a" },
      { id: "g", part: "kreuzung" },
      { id: "h", crosses: "g" },
      { id: "i", crosses: "g" },
      { id: "a", part: "gerade-171" },
    ];
    const entries = [...S.errorEntries(CATALOG, elements)].sort(
      (x, y) => (x.numbers[0] ?? 0) - (y.numbers[0] ?? 0),
    );
    expect(entries.map((e) => ({ numbers: e.numbers, text: e.text }))).toEqual([
      { numbers: [1, 10], text: "doppelte Element-ID" },
      { numbers: [2], text: "Teil unbekannt" },
      { numbers: [3], text: "Maße fehlen, nicht platzierbar" },
      { numbers: [4], text: "Kurvenrichtung fehlt" },
      { numbers: [5], text: "Richtung bei Nicht-Kurve" },
      { numbers: [6], text: "Querung verweist auf keine frühere Kreuzung" },
      { numbers: [9], text: "Kreuzung bereits gequert" },
    ]);
    const byNumber = (n: number) => entries.find((e) => e.numbers[0] === n);
    expect(byNumber(3)?.name).toBe("Looping (Baugruppe)");
    expect(byNumber(4)?.name).toBe("Kurve 1/90°");
    expect(byNumber(5)?.name).toBe("Gerade 114");
    for (const e of entries) expect(e.name.length).toBeGreaterThan(0);
  });

  test.skip("[REQ-STAT-3] Eigenschaft: ein Eintrag je Kern-Fehler mit Nummer(n) und Text der Fehlerart", async () => {
    const S = await loadStatus();
    const key = (numbers: ReadonlyArray<number>, text: string) => `${numbers.join(",")}:${text}`;
    fc.assert(
      fc.property(
        elementsArb.chain((els) =>
          // gelegentlich doppelte IDs erzeugen
          fc.nat().map((n) =>
            els.length > 1 && n % 4 === 0
              ? replaceAt(els, els.length - 1, {
                  ...(els[els.length - 1] as LayoutElement),
                  id: "u0",
                })
              : els,
          ),
        ),
        (elements) => {
          const r = closure(CATALOG, elements, ORIGIN);
          const expected = r.ok
            ? []
            : r.errors.map((e) =>
                key(
                  e.kind === "doppelteElementId" ? e.indices.map((i) => i + 1) : [e.index + 1],
                  ERROR_TEXT[e.kind],
                ),
              );
          const actual = S.errorEntries(CATALOG, elements).map((e) => key(e.numbers, e.text));
          expect([...actual].sort()).toEqual([...expected].sort());
        },
      ),
      { numRuns: 300 },
    );
  });

  test.skip("[REQ-STAT-4] Verbrauch der Acht in Katalogreihenfolge mit Namen, zusammen 9", async () => {
    const S = await loadStatus();
    expect(S.consumptionView(CATALOG, ACHT)).toEqual({
      ok: true,
      entries: [
        { partId: "gerade-114", name: "Gerade 114", count: 1 },
        { partId: "kurve-1-90", name: "Kurve 1/90°", count: 6 },
        { partId: "kreuzung", name: "Kreuzung", count: 1 },
        { partId: "anschlussstueck", name: "Anschlussstück", count: 1 },
      ],
      total: 9,
    });
    expect(S.consumptionView(CATALOG, OVAL)).toEqual({
      ok: true,
      entries: [
        { partId: "gerade-342", name: "Gerade 342", count: 2 },
        { partId: "kurve-1-90", name: "Kurve 1/90°", count: 4 },
      ],
      total: 6,
    });
    expect(S.consumptionView(CATALOG, [])).toEqual({ ok: true, entries: [], total: 0 });
  });

  test.skip("[REQ-STAT-4] Verbrauch auch bei Fehlern; nur bei „Teil unbekannt“ „Verbrauch nicht bestimmbar“", async () => {
    const S = await loadStatus();
    const g171 = S.consumptionView(CATALOG, ACHT_G171);
    expect(g171.ok && g171.total).toBe(9);
    // Baugruppe (Fehler „nicht platzierbar“) wird aufgelöst wie im Kern
    const steil = S.consumptionView(CATALOG, [{ id: "s", part: "steilkehre" }]);
    expect(steil).toEqual({
      ok: true,
      entries: [
        { partId: "kurve-1-90", name: "Kurve 1/90°", count: 2 },
        { partId: "steilkehre-teil", name: "Steilkehre-Teil (K)", count: 4 },
      ],
      total: 6,
    });
    expect(S.consumptionView(CATALOG, [...OVAL, { id: "z", part: "gibt-es-nicht" }])).toEqual({
      ok: false,
      text: "Verbrauch nicht bestimmbar",
    });
  });

  test.skip("[REQ-STAT-4] Eigenschaft: Verbrauch = consumption des Kerns, Katalogreihenfolge, Summe", async () => {
    const S = await loadStatus();
    fc.assert(
      fc.property(elementsArb, (elements) => {
        const r = consumption(CATALOG, elements);
        const v = S.consumptionView(CATALOG, elements);
        if (!r.ok) {
          expect(v.ok).toBe(false);
          return;
        }
        const entries = CATALOG.filter((e) => (r.counts[e.id] ?? 0) > 0).map((e) => ({
          partId: e.id,
          name: e.name,
          count: r.counts[e.id] as number,
        }));
        expect(v).toEqual({
          ok: true,
          entries,
          total: entries.reduce((sum, e) => sum + e.count, 0),
        });
      }),
      { numRuns: 300 },
    );
  });

  test.skip("[REQ-STAT-5] Gesamtlänge: Oval „1,76 m“, Acht „2,30 m“", async () => {
    const S = await loadStatus();
    const oval = S.totalLength(CATALOG, OVAL);
    expect(oval).toBeDefined();
    expectNear(oval as number, 684 + 342 * Math.PI, 1e-6);
    expect(S.formatLength(oval)).toBe("1,76 m");
    const acht = S.totalLength(CATALOG, ACHT);
    expectNear(acht as number, 342 + 6 * 85.5 * Math.PI + 3 * 114, 1e-6);
    expect(S.formatLength(acht)).toBe("2,30 m");
    expect(S.totalLength(CATALOG, [])).toBe(0);
    expect(S.formatLength(0)).toBe("0,00 m");
    // Kurve 1/45°: π·171/4 ≈ 134,3 mm; Kurve 3/45°: π·399/4 ≈ 313,4 mm
    expectNear(
      S.totalLength(CATALOG, curves(1, "links", "kurve-1-45")) as number,
      (Math.PI * 171) / 4,
      1e-6,
    );
    expectNear(
      S.totalLength(CATALOG, curves(1, "rechts", "kurve-3-45")) as number,
      (Math.PI * 399) / 4,
      1e-6,
    );
    expect(S.formatLength((Math.PI * 171) / 4)).toBe("0,13 m");
    expect(S.formatLength(12345.6)).toBe("12,35 m");
  });

  test.skip("[REQ-STAT-5] Länge unabhängig von Lagefehlern; „–“ bei unbekannter Länge", async () => {
    const S = await loadStatus();
    // Ankunftsfehler: Länge bleibt bestimmt (Gerade 171 statt 114)
    const g171 = S.totalLength(CATALOG, ACHT_G171);
    expectNear(g171 as number, 342 + 6 * 85.5 * Math.PI + 171 + 114 + 114, 1e-6);
    expect(S.formatLength(g171)).toBe("2,35 m");
    // Kurve ohne Richtung: Lagefehler, Länge bekannt
    expectNear(
      S.totalLength(CATALOG, [{ id: "k", part: "kurve-1-90" }]) as number,
      85.5 * Math.PI,
      1e-6,
    );

    const unknownLength: ReadonlyArray<Elements> = [
      [...OVAL, { id: "z", part: "gibt-es-nicht" }],
      [...OVAL, { id: "z", part: "looping" }],
      [...OVAL, { id: "z", part: "wireless-anschluss" }],
      [...OVAL, { id: "z", crosses: "o3" }], // Querung auf eine Gerade
      [...OVAL, { id: "z", crosses: "nirgends" }],
    ];
    for (const els of unknownLength) {
      expect(S.totalLength(CATALOG, els), JSON.stringify(els.at(-1))).toBeUndefined();
    }
    expect(S.formatLength(undefined)).toBe("–");
  });
});

describe("Architektur: Status kommt vom Kern", () => {
  test.skip("[REQ-WARCH-3] Verfälschter Katalog (Kurve 1/90° mit Radius 285): Status, Länge und Querungs-Ziel folgen dem Kern", async () => {
    const S = await loadStatus();
    const forged: ReadonlyArray<CatalogEntry> = CATALOG.map((e) =>
      e.id === "kurve-1-90" ? { ...e, geometry: { kind: "kurve", radius: 285, angle: 90 } } : e,
    );
    // Oval: alle vier Kurven gleich verfälscht → bleibt geschlossen
    expect(S.statusOf(forged, OVAL)).toEqual({ kind: "geschlossen" });
    // Oval mit einer Kurve 1/90° ersetzt durch 2 × Kurve 1/45°
    const mixed: Elements = [
      { id: "h1", part: "kurve-1-45", turn: "links" },
      { id: "h2", part: "kurve-1-45", turn: "links" },
      ...OVAL.slice(1),
    ];
    expect(S.statusOf(CATALOG, mixed)).toEqual({ kind: "geschlossen" });
    expect(S.statusOf(forged, mixed).kind).toBe("offen");
    // Länge folgt dem übergebenen Katalog
    expectNear(S.totalLength(forged, OVAL) as number, 684 + 570 * Math.PI, 1e-6);
    // 3 × Kurve links mit R 285: Lücke 285·√2 ≈ 403 mm
    expect(S.statusOf(forged, curves(3, "links"))).toEqual({
      kind: "offen",
      gapText: "403 mm",
      angleDeg: 90,
    });
    // Ein Katalog ohne die Kurve: der Kern meldet „Teil unbekannt“, der Editor folgt
    const without = CATALOG.filter((e) => e.id !== "kurve-1-90");
    expect(S.statusOf(without, OVAL)).toEqual({ kind: "fehlerhaft" });
    expect(S.consumptionView(without, OVAL).ok).toBe(false);
  });
});
