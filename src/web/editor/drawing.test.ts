/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Editor-Logik — gezeichneter Abschnitt und
 * Zeichengeometrie. Abnahmetests REQ-EDIT-18 und REQ-EDIT-19.
 *
 * Schnittstelle (Typen: src/web/test-support/editor-fixtures.ts), Modul `src/web/editor/drawing.ts`:
 *   drawnSection(catalog, elements): { firstErrorIndex, steps, drawnCount, notDrawnCount }
 *     steps = Kern-Schritte (trace) des fehlerfreien Anfangs.
 *   drawing(catalog, elements): ElementShape[]   je gezeichnetem Element
 *     { id, index, centerline, band: { left, right }, ports? }
 *     centerline: { kind: "strecke", from, to } | { kind: "bogen", from, to, center, radius }
 *     Bildschirm: x = x, y = −y (mm, Gleitkomma).
 *   coordToNumber(c: Coord): number              a + b·√2, Fehler ≤ 0,01 mm
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { trace } from "../../core/index.js";
import {
  ACHT,
  ACHT_G171,
  CATALOG,
  type Centerline,
  type Coord,
  coord,
  coordExact,
  elementsArb,
  expectNear,
  expectPointNear,
  type LayoutElement,
  loadDrawing,
  ORIGIN,
  OVAL,
  type Pose,
  rat,
  type ScreenPoint,
  validElementsArb,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

const num = (c: Coord): number => coordExact(c);
const screen = (p: Pose): ScreenPoint => ({ x: num(p.x), y: -num(p.y) });

const dist = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Abstand eines Randes zur Mittellinie: Strecke parallel im Abstand d, Bogen konzentrisch. */
const edgeOffset = (center: Centerline, edge: Centerline): number => {
  if (center.kind === "strecke" && edge.kind === "strecke") {
    const dx = center.to.x - center.from.x;
    const dy = center.to.y - center.from.y;
    const len = Math.hypot(dx, dy);
    const d1 =
      Math.abs(dx * (edge.from.y - center.from.y) - dy * (edge.from.x - center.from.x)) / len;
    const d2 = Math.abs(dx * (edge.to.y - center.from.y) - dy * (edge.to.x - center.from.x)) / len;
    expectNear(d1, d2);
    expectNear(dist(edge.from, edge.to), len);
    return d1;
  }
  if (center.kind === "bogen" && edge.kind === "bogen") {
    expectPointNear(edge.center, center.center);
    return Math.abs(edge.radius - center.radius);
  }
  throw new Error(`Rand hat andere Art als die Mittellinie: ${center.kind}/${edge.kind}`);
};

describe("Gezeichneter Abschnitt", () => {
  test.skip("[REQ-EDIT-18] Acht mit Gerade 171: gezeichnet Nr. 1–5, nicht gezeichnet 5; fehlerfrei alles", async () => {
    const D = await loadDrawing();
    const broken = D.drawnSection(CATALOG, ACHT_G171);
    expect(broken.firstErrorIndex).toBe(5);
    expect(broken.drawnCount).toBe(5);
    expect(broken.notDrawnCount).toBe(5);
    const prefix = trace(CATALOG, ACHT_G171.slice(0, 5), ORIGIN);
    expect(prefix.ok && broken.steps).toEqual(prefix.ok && prefix.steps);

    const whole = D.drawnSection(CATALOG, ACHT);
    expect(whole.firstErrorIndex).toBeUndefined();
    expect(whole.drawnCount).toBe(10);
    expect(whole.notDrawnCount).toBe(0);
    const t = trace(CATALOG, ACHT, ORIGIN);
    expect(t.ok && whole.steps).toEqual(t.ok && t.steps);

    expect(D.drawnSection(CATALOG, [])).toEqual({
      firstErrorIndex: undefined,
      steps: [],
      drawnCount: 0,
      notDrawnCount: 0,
    });
  });

  test.skip("[REQ-EDIT-18] Erster Fehlerindex = kleinster Index aller Kern-Fehler, bei doppelter ID der kleinste ihrer Indizes", async () => {
    const D = await loadDrawing();
    const dup: Elements = [
      { id: "a", part: "gerade-342" },
      { id: "b", part: "gerade-342" },
      { id: "a", part: "gerade-342" },
    ];
    expect(D.drawnSection(CATALOG, dup)).toMatchObject({
      firstErrorIndex: 0,
      drawnCount: 0,
      notDrawnCount: 3,
    });
    // Kreuzung gelöscht (REQ-EDIT-11): Fehler an Nr. 5, gezeichnet Nr. 1–4
    expect(D.drawnSection(CATALOG, ACHT.slice(1))).toMatchObject({
      firstErrorIndex: 4,
      drawnCount: 4,
      notDrawnCount: 5,
    });
    const two: Elements = [
      ...OVAL.slice(0, 2),
      { id: "x", part: "kurve-1-90" },
      { id: "y", part: "looping" },
    ];
    expect(D.drawnSection(CATALOG, two)).toMatchObject({ firstErrorIndex: 2, drawnCount: 2 });
  });

  test.skip("[REQ-EDIT-18] Eigenschaft: gezeichneter Abschnitt ist der Anfang bis vor den ersten Fehlerindex, allein fehlerfrei verfolgt", async () => {
    const D = await loadDrawing();
    fc.assert(
      fc.property(fc.oneof(elementsArb, validElementsArb), (elements) => {
        const full = trace(CATALOG, elements, ORIGIN);
        const first = full.ok
          ? undefined
          : Math.min(
              ...full.errors.map((e) =>
                e.kind === "doppelteElementId" ? Math.min(...e.indices) : e.index,
              ),
            );
        const d = D.drawnSection(CATALOG, elements);
        const n = first ?? elements.length;
        expect(d.firstErrorIndex).toBe(first);
        expect(d.drawnCount).toBe(n);
        expect(d.notDrawnCount).toBe(elements.length - n);
        const prefix = trace(CATALOG, elements.slice(0, n), ORIGIN);
        expect(prefix.ok).toBe(true);
        if (prefix.ok) expect(d.steps).toEqual(prefix.steps);
      }),
      { numRuns: 300 },
    );
  });
});

describe("Zeichengeometrie", () => {
  test.skip("[REQ-EDIT-19] Kurve 1/90° links ab Start endet bei Bildschirm (171, −171); Band 114 mm, links innen", async () => {
    const D = await loadDrawing();
    const shapes = D.drawing(CATALOG, [{ id: "k", part: "kurve-1-90", turn: "links" }]);
    expect(shapes).toHaveLength(1);
    const s = shapes[0];
    expect(s).toMatchObject({ id: "k", index: 0 });
    const c = s?.centerline;
    if (c?.kind !== "bogen") return expect.fail("Kurve muss ein Bogen sein");
    expectPointNear(c.from, { x: 0, y: 0 });
    expectPointNear(c.to, { x: 171, y: -171 });
    expectPointNear(c.center, { x: 0, y: -171 });
    expectNear(c.radius, 171);
    const { left, right } = (s as NonNullable<typeof s>).band;
    if (left.kind !== "bogen" || right.kind !== "bogen") return expect.fail("Bandränder als Bogen");
    expectNear(left.radius, 114);
    expectNear(right.radius, 228);
    expectPointNear(left.from, { x: 0, y: -57 });
    expectPointNear(left.to, { x: 114, y: -171 });
    expectPointNear(right.from, { x: 0, y: 57 });
    expectPointNear(right.to, { x: 228, y: -171 });
    expect(s?.ports).toBeUndefined();
  });

  test.skip("[REQ-EDIT-19] Gerade und Kreuzung: Strecke, Bandränder ±57 mm, Queranschlüsse der Kreuzung", async () => {
    const D = await loadDrawing();
    const [g] = D.drawing(CATALOG, [{ id: "g", part: "gerade-342" }]);
    expect(g?.centerline.kind).toBe("strecke");
    expectPointNear(g?.centerline.from as ScreenPoint, { x: 0, y: 0 });
    expectPointNear(g?.centerline.to as ScreenPoint, { x: 342, y: 0 });
    expectPointNear(g?.band.left.from as ScreenPoint, { x: 0, y: -57 });
    expectPointNear(g?.band.left.to as ScreenPoint, { x: 342, y: -57 });
    expectPointNear(g?.band.right.from as ScreenPoint, { x: 0, y: 57 });
    expectPointNear(g?.band.right.to as ScreenPoint, { x: 342, y: 57 });

    const [k] = D.drawing(CATALOG, [{ id: "x", part: "kreuzung" }]);
    expectPointNear(k?.centerline.to as ScreenPoint, { x: 342, y: 0 });
    expect(k?.ports).toBeDefined();
    // Kern: links (171, 57), rechts (171, −57) → Bildschirm y gespiegelt
    expectPointNear(k?.ports?.left as ScreenPoint, { x: 171, y: -57 });
    expectPointNear(k?.ports?.right as ScreenPoint, { x: 171, y: 57 });
  });

  test.skip("[REQ-EDIT-19] Acht: Querung als Strecke über den Querweg, jedes Element mit 114 mm breitem Band", async () => {
    const D = await loadDrawing();
    const shapes = D.drawing(CATALOG, ACHT);
    expect(shapes.map((s) => s.id)).toEqual(ACHT.map((e) => e.id));
    expect(shapes.map((s) => s.index)).toEqual(ACHT.map((_, i) => i));
    const q = shapes[5];
    expect(q?.centerline.kind).toBe("strecke");
    // Ankunft am rechten Anschluss (171, −57), Ausgang am linken (171, 57)
    expectPointNear(q?.centerline.from as ScreenPoint, { x: 171, y: 57 });
    expectPointNear(q?.centerline.to as ScreenPoint, { x: 171, y: -57 });
    expect(q?.ports).toBeUndefined();
    for (const s of shapes) {
      expectNear(edgeOffset(s.centerline, s.band.left), 57);
      expectNear(edgeOffset(s.centerline, s.band.right), 57);
    }
    expect(shapes.filter((s) => s.ports !== undefined).map((s) => s.id)).toEqual(["e1"]);
  });

  test.skip("[REQ-EDIT-19] Nur der gezeichnete Abschnitt wird gezeichnet", async () => {
    const D = await loadDrawing();
    expect(D.drawing(CATALOG, ACHT_G171).map((s) => s.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(D.drawing(CATALOG, [])).toEqual([]);
  });

  test.skip("[REQ-EDIT-19] Eigenschaft: Mittellinien verketten die Kern-Posen in Bildschirmkoordinaten (x, −y)", async () => {
    const D = await loadDrawing();
    fc.assert(
      fc.property(validElementsArb, (elements) => {
        const t = trace(CATALOG, elements, ORIGIN);
        if (!t.ok) return expect.fail("Erzeuger liefert nur fehlerfreie Folgen");
        const shapes = D.drawing(CATALOG, elements);
        expect(shapes).toHaveLength(elements.length);
        let prev = screen(ORIGIN);
        shapes.forEach((s, i) => {
          const end = screen((t.steps[i] as { pose: Pose }).pose);
          expectPointNear(s.centerline.from, prev);
          expectPointNear(s.centerline.to, end);
          if (s.centerline.kind === "bogen") {
            const part = (elements[i] as { part: string }).part;
            const g = CATALOG.find((e) => e.id === part)?.geometry;
            expectNear(s.centerline.radius, g?.kind === "kurve" ? g.radius : Number.NaN);
            expectNear(dist(s.centerline.center, s.centerline.from), s.centerline.radius);
            expectNear(dist(s.centerline.center, s.centerline.to), s.centerline.radius);
          }
          expectNear(edgeOffset(s.centerline, s.band.left), 57);
          expectNear(edgeOffset(s.centerline, s.band.right), 57);
          prev = end;
        });
      }),
      { numRuns: 200 },
    );
  });

  test.skip("[REQ-EDIT-19] Umrechnung a + b·√2 → Zahl weicht höchstens 0,01 mm vom exakten Wert ab", async () => {
    const D = await loadDrawing();
    // Pell-Paar: 665857 − 470832·√2 ≈ 7,5e−7 (starke Auslöschung)
    const pell = coord(rat(665857n), rat(-470832n));
    expectNear(D.coordToNumber(pell), coordExact(pell));
    expectNear(D.coordToNumber(coord(rat(5643n, 2n), rat(-1995n))), 0.1439, 0.0001);
    expect(D.coordToNumber(coord(rat(0n, 4n), rat(0n, 4n)))).toBe(0);
    // Darstellbarer Bereich: Zähler bis 4·10⁷ (10⁷ mm), Nenner 1, 2 oder 4 wie im Kern
    const ratArb = fc.record({
      num: fc.bigInt({ min: -40_000_000n, max: 40_000_000n }),
      den: fc.constantFrom(1n, 2n, 4n, -4n),
    });
    fc.assert(
      fc.property(ratArb, ratArb, (a, b) => {
        const c = coord(a, b);
        expectNear(D.coordToNumber(c), coordExact(c));
      }),
      { numRuns: 1000 },
    );
  });
});
