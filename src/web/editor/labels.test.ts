/**
 * Spec plan-beschriftung-symbole (.specify/specs/plan-beschriftung-symbole/spec.md): Logik der
 * Beschriftung und der Symbolzuordnung. Abnahmetests REQ-LBL-1 bis REQ-LBL-4, REQ-SYM-1 und der
 * Wirkungsteil von REQ-PARCH-2.
 *
 * ## Gewählte Schnittstelle (implement setzt genau diese um)
 *
 * Modul `src/web/editor/labels.ts` (rein, ohne Preact und DOM; Katalog immer Argument):
 *
 *   labelTexts(catalog, partId): { full, short } | undefined
 *       full = `name` des Katalogeintrags; short = `name` ohne das erste Wort, wenn `name` mit
 *       „Gerade “ oder „Kurve “ beginnt, sonst undefined. Unbekannte ID: undefined.
 *   symbolOf(partId): "zielflagge" | "stecker" | "spurwechsel" | "engstelle" | undefined
 *       allein aus der Katalog-ID (kein Katalog-Argument).
 *   textWidth(text): number
 *       Breitenschätzung B in Bildschirm-Pixeln: 7,5 je Unicode-Codepoint.
 *   labelVariant(catalog, partId, room, on): LabelVariant
 *       Platzregel (REQ-LBL-2) für den Platz P = room (Bildschirm-Pixel) und den Schalter.
 *   labelPoint(shape): ScreenPoint
 *       Ort (REQ-LBL-3) in Zeichenkoordinaten (mm, y nach unten wie `drawing`).
 *   labelPlan(catalog, elements, shapes, scale, on): LabelEntry[]
 *       je gezeichnetem Teil-Element (also nicht für Querungen) genau ein Eintrag, in
 *       Folgereihenfolge, auch mit Variante "keine". `shapes` = `drawing(catalog, elements)`; die
 *       Zeichengeometrie wird nicht neu gerechnet (REQ-PARCH-3: neu bestimmt wird je Zoomschritt).
 *       P = Abstand centerline.from → centerline.to · scale.
 *
 * LabelEntry = { id, partId, variant, text, fullName, symbol, at }
 *   text: bei "voll" und "symbolUndName" der volle Name, bei "kurz" die Kurzform, sonst undefined.
 *   fullName: voller Name (für das SVG-`<title>` der Symbole, REQ-SYM-4).
 *   symbol: symbolOf(partId).   at: labelPoint(shape).
 *
 * Variantennamen: "keine" | "kurz" | "voll" | "nurSymbol" („nur Symbol“) | "symbolUndName"
 * („Symbol + Name“).
 *
 * Die Typen stehen hier im Test (nicht in src/web/test-support, das im geschützten Satz liegt);
 * implement spiegelt sie in src/web/editor/types.ts. Geladen wird dynamisch über einen Pfad in
 * einer Variablen, damit die Datei typcheckt, bevor es das Modul gibt.
 *
 * Orakel: Erwartungen stehen als Zahlen aus der Spec (Tabellen „Begriffe“ und REQ-LBL-2/-3) oder
 * werden im Test unabhängig aus der Zeichengeometrie gerechnet (Bogenmitte, Sehne).
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  ACHT,
  CATALOG,
  type CatalogEntry,
  type Centerline,
  elementsArb,
  expectPointNear,
  type LayoutElement,
  loadDrawing,
  OVAL,
  PLACEABLE_IDS,
  type ScreenPoint,
  validElementsArb,
} from "../test-support/editor-fixtures.js";

type Catalog = ReadonlyArray<CatalogEntry>;
type Elements = ReadonlyArray<LayoutElement>;
type ElementShape = {
  readonly id: string;
  readonly index: number;
  readonly centerline: Centerline;
  readonly band: { readonly left: Centerline; readonly right: Centerline };
  readonly ports?: { readonly left: ScreenPoint; readonly right: ScreenPoint };
};

type SymbolKind = "zielflagge" | "stecker" | "spurwechsel" | "engstelle";
type LabelVariant = "keine" | "kurz" | "voll" | "nurSymbol" | "symbolUndName";
type LabelTexts = { readonly full: string; readonly short: string | undefined };
type LabelEntry = {
  readonly id: string;
  readonly partId: string;
  readonly variant: LabelVariant;
  readonly text: string | undefined;
  readonly fullName: string;
  readonly symbol: SymbolKind | undefined;
  readonly at: ScreenPoint;
};
type LabelsApi = {
  labelTexts(catalog: Catalog, partId: string): LabelTexts | undefined;
  symbolOf(partId: string): SymbolKind | undefined;
  textWidth(text: string): number;
  labelVariant(catalog: Catalog, partId: string, room: number, on: boolean): LabelVariant;
  labelPoint(shape: ElementShape): ScreenPoint;
  labelPlan(
    catalog: Catalog,
    elements: Elements,
    shapes: ReadonlyArray<ElementShape>,
    scale: number,
    on: boolean,
  ): ReadonlyArray<LabelEntry>;
};

const LABELS_MODULE = "./labels.js";
const loadLabels = async (): Promise<LabelsApi> =>
  (await import(/* @vite-ignore */ LABELS_MODULE)) as LabelsApi;

// ---------------------------------------------------------------------------------------------
// Orakel aus der Spec
// ---------------------------------------------------------------------------------------------

/** Tabelle „Begriffe“: Teile mit Kurzform. */
const WITH_SHORT: ReadonlyArray<readonly [string, string, string]> = [
  ["gerade-342", "Gerade 342", "342"],
  ["gerade-171", "Gerade 171", "171"],
  ["gerade-114", "Gerade 114", "114"],
  ["gerade-100", "Gerade 100", "100"],
  ["kurve-1-90", "Kurve 1/90°", "1/90°"],
  ["kurve-1-45", "Kurve 1/45°", "1/45°"],
  ["kurve-2-45", "Kurve 2/45°", "2/45°"],
  ["kurve-3-45", "Kurve 3/45°", "3/45°"],
];
/** Übrige platzierbare Einträge: keine Kurzform. */
const WITHOUT_SHORT: ReadonlyArray<readonly [string, string]> = [
  ["spurwechselkurve", "Spurwechselkurve"],
  ["spurwechsel-gerade", "Spurwechsel gerade"],
  ["engstelle", "Engstelle"],
  ["kreuzung", "Kreuzung"],
  ["anschlussstueck", "Anschlussstück"],
  ["rundenzaehler", "Rundenzähler"],
  // Nachtrag #1: vermessen und platzierbar
  ["wireless-anschluss", "Wireless-Anschluss"],
  ["steilkurve-1-45", "Steilkurve 1/45°"],
];

/** REQ-SYM-1: Zuordnung allein an der ID. */
const SYMBOLS: Readonly<Record<string, SymbolKind>> = {
  rundenzaehler: "zielflagge",
  anschlussstueck: "stecker",
  // Nachtrag #1: Anschlussschiene mit den Maßen des Anschlussstücks, gleiches Symbol
  "wireless-anschluss": "stecker",
  "spurwechsel-gerade": "spurwechsel",
  spurwechselkurve: "spurwechsel",
  engstelle: "engstelle",
};

/** B aus „Begriffe“: 7,5 px je Codepoint. */
const B = (text: string): number => [...text].length * 7.5;

const shortOf = (name: string): string | undefined =>
  name.startsWith("Gerade ") || name.startsWith("Kurve ")
    ? name.slice(name.indexOf(" ") + 1)
    : undefined;

/** Platzregel REQ-LBL-2, unabhängig nachgeschrieben. */
const expectedVariant = (
  catalog: Catalog,
  partId: string,
  room: number,
  on: boolean,
): LabelVariant => {
  const name = catalog.find((e) => e.id === partId)?.name;
  if (name === undefined) throw new Error(`Testdaten: ${partId} fehlt im Katalog`);
  const symbol = SYMBOLS[partId] !== undefined;
  if (symbol) {
    if (on && 20 + B(name) <= room) return "symbolUndName";
    return 16 <= room ? "nurSymbol" : "keine";
  }
  if (!on) return "keine";
  if (B(name) <= room) return "voll";
  const short = shortOf(name);
  if (short !== undefined && B(short) <= room) return "kurz";
  return "keine";
};

const RANK: Readonly<Record<LabelVariant, number>> = {
  keine: 0,
  kurz: 1,
  voll: 2,
  nurSymbol: 1,
  symbolUndName: 2,
};

/** Mitte der Mittellinie: Streckenmitte bzw. Bogenpunkt gleichen Abstands zu Anfang und Ende. */
const midOf = (c: Centerline): ScreenPoint => {
  const m = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
  if (c.kind === "strecke") return m;
  const dx = m.x - c.center.x;
  const dy = m.y - c.center.y;
  const len = Math.hypot(dx, dy);
  return { x: c.center.x + (dx / len) * c.radius, y: c.center.y + (dy / len) * c.radius };
};

const chord = (c: Centerline): number => Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y);

const near = (actual: ScreenPoint, expected: ScreenPoint, tol = 1e-6): void => {
  expectPointNear(actual, expected, tol);
};

const L = "links" as const;
const R = "rechts" as const;

/** Szene der Tabelle in REQ-LBL-2 (fehlerfrei, jede Zeile ein Element). */
const TABLE_SCENE: Elements = [
  { id: "g100", part: "gerade-100" },
  { id: "g342", part: "gerade-342" },
  { id: "k145", part: "kurve-1-45", turn: L },
  { id: "kr", part: "kreuzung" },
  { id: "rz", part: "rundenzaehler" },
  { id: "as", part: "anschlussstueck" },
];

/** Erwartung aus der Tabelle in REQ-LBL-2: [Variante, Text]. */
const TABLE: ReadonlyArray<
  readonly [number, Readonly<Record<string, readonly [LabelVariant, string | undefined]>>]
> = [
  [
    0.15,
    {
      g100: ["keine", undefined],
      g342: ["kurz", "342"],
      k145: ["keine", undefined],
      kr: ["keine", undefined],
      rz: ["nurSymbol", undefined],
      as: ["nurSymbol", undefined],
    },
  ],
  [
    0.4,
    {
      g100: ["kurz", "100"],
      g342: ["voll", "Gerade 342"],
      k145: ["kurz", "1/45°"],
      kr: ["voll", "Kreuzung"],
      rz: ["nurSymbol", undefined],
      as: ["nurSymbol", undefined],
    },
  ],
  [
    1.14,
    {
      g100: ["voll", "Gerade 100"],
      g342: ["voll", "Gerade 342"],
      k145: ["voll", "Kurve 1/45°"],
      kr: ["voll", "Kreuzung"],
      rz: ["symbolUndName", "Rundenzähler"],
      as: ["symbolUndName", "Anschlussstück"],
    },
  ],
];

const withName = (catalog: Catalog, id: string, name: string): Catalog =>
  catalog.map((e) => (e.id === id ? { ...e, name } : e));

// ---------------------------------------------------------------------------------------------
// REQ-LBL-1: Beschriftungstext
// ---------------------------------------------------------------------------------------------

describe("Beschriftungstext", () => {
  test("[REQ-LBL-1] echter Katalog: voller Name und Kurzform genau wie die Tabelle „Begriffe“ (nach Vermessung #1)", async () => {
    const api = await loadLabels();
    for (const [id, full, short] of WITH_SHORT) {
      expect({ id, texts: api.labelTexts(CATALOG, id) }).toEqual({ id, texts: { full, short } });
    }
    for (const [id, full] of WITHOUT_SHORT) {
      expect({ id, texts: api.labelTexts(CATALOG, id) }).toEqual({
        id,
        texts: { full, short: undefined },
      });
    }
    // Abdeckung: die Tabelle umfasst genau die platzierbaren Einträge
    expect(new Set([...WITH_SHORT.map((r) => r[0]), ...WITHOUT_SHORT.map((r) => r[0])])).toEqual(
      new Set(PLACEABLE_IDS),
    );
  });

  test("[REQ-LBL-1] voller Name ist bei jedem Katalogeintrag das Feld name; unbekannte ID ohne Text", async () => {
    const api = await loadLabels();
    for (const entry of CATALOG) {
      expect(api.labelTexts(CATALOG, entry.id)?.full).toBe(entry.name);
    }
    expect(api.labelTexts(CATALOG, "gibt-es-nicht")).toBeUndefined();
  });

  test("[REQ-LBL-1] Wirkungsnachweis mit verfälschtem Katalog: Gerade 999 und Kurve X", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const fake = withName(withName(CATALOG, "gerade-114", "Gerade 999"), "engstelle", "Kurve X");
    expect(api.labelTexts(fake, "gerade-114")).toEqual({ full: "Gerade 999", short: "999" });
    expect(api.labelTexts(fake, "engstelle")).toEqual({ full: "Kurve X", short: "X" });
    // Gegenprobe: der echte Katalog ist davon unberührt
    expect(api.labelTexts(CATALOG, "gerade-114")).toEqual({ full: "Gerade 114", short: "114" });
    expect(api.labelTexts(CATALOG, "engstelle")).toEqual({ full: "Engstelle", short: undefined });

    // Auch die Beschriftung im Plan kommt aus dem übergebenen Katalog (P = 114 · s)
    const elements: Elements = [{ id: "a", part: "gerade-114" }];
    const shapes = D.drawing(fake, elements);
    const full = api.labelPlan(fake, elements, shapes, 1, true);
    expect(full.map((e) => [e.variant, e.text, e.fullName])).toEqual([
      ["voll", "Gerade 999", "Gerade 999"],
    ]);
    const short = api.labelPlan(fake, elements, shapes, 0.3, true);
    expect(short.map((e) => [e.variant, e.text])).toEqual([["kurz", "999"]]);
  });

  test("[REQ-LBL-1] Kurzform nur bei „Gerade “ und „Kurve “ als erstem Wort", async () => {
    const api = await loadLabels();
    const cases: ReadonlyArray<readonly [string, string | undefined]> = [
      ["Gerade 12", "12"],
      ["Kurve 9/30°", "9/30°"],
      ["Kurve lang und breit", "lang und breit"],
      ["Geradeaus 12", undefined],
      ["gerade 12", undefined],
      ["Kurven 1", undefined],
      ["Steilkurve 1/45°", undefined],
      ["Die Gerade 12", undefined],
    ];
    for (const [name, short] of cases) {
      const fake = withName(CATALOG, "gerade-171", name);
      expect({ name, texts: api.labelTexts(fake, "gerade-171") }).toEqual({
        name,
        texts: { full: name, short },
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-LBL-2: Platzregel
// ---------------------------------------------------------------------------------------------

describe("Platzregel", () => {
  test("[REQ-LBL-2] Breitenschätzung: 7,5 px je Codepoint, ° und ü zählen je 1", async () => {
    const api = await loadLabels();
    expect(api.textWidth("100")).toBe(22.5);
    expect(api.textWidth("Gerade 100")).toBe(75);
    expect(api.textWidth("Kurve 3/45°")).toBe(82.5);
    expect(api.textWidth("Rundenzähler")).toBe(90);
    expect(api.textWidth("Anschlussstück")).toBe(105);
    expect(api.textWidth("")).toBe(0);
    // Codepoints, nicht UTF-16-Einheiten
    expect(api.textWidth("𝟙𝟚")).toBe(15);
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 30 }), (s) => {
        expect(api.textWidth(s)).toBe([...s].length * 7.5);
      }),
    );
  });

  test("[REQ-LBL-2] Tabelle der Spec: Gerade 100/342, Kurve 1/45°, Kreuzung, Rundenzähler, Anschlussstück bei s = 0,15 / 0,4 / 1,14", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const shapes = D.drawing(CATALOG, TABLE_SCENE);
    expect(shapes).toHaveLength(TABLE_SCENE.length);
    for (const [s, rows] of TABLE) {
      const plan = api.labelPlan(CATALOG, TABLE_SCENE, shapes, s, true);
      const got = Object.fromEntries(plan.map((e) => [e.id, [e.variant, e.text]]));
      expect({ s, got }).toEqual({ s, got: rows });
    }
  });

  test("[REQ-LBL-2] Grenzfälle eingeschlossen: Gerade 100 bei s = 0,224 keine, 0,225 kurz, 0,749 kurz, 0,75 voll", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const elements: Elements = [{ id: "a", part: "gerade-100" }];
    const shapes = D.drawing(CATALOG, elements);
    const at = (s: number) => api.labelPlan(CATALOG, elements, shapes, s, true)[0]?.variant;
    expect(at(0.224)).toBe("keine");
    expect(at(0.225)).toBe("kurz");
    expect(at(0.749)).toBe("kurz");
    expect(at(0.75)).toBe("voll");
    // direkt über den Platz: B = P zählt als „passt“
    expect(api.labelVariant(CATALOG, "gerade-100", 22.5, true)).toBe("kurz");
    expect(api.labelVariant(CATALOG, "gerade-100", 22.499, true)).toBe("keine");
    expect(api.labelVariant(CATALOG, "gerade-100", 75, true)).toBe("voll");
    expect(api.labelVariant(CATALOG, "gerade-100", 74.999, true)).toBe("kurz");
  });

  test("[REQ-LBL-2] Symbolteile: Symbol + Name ab 20 + B, nur Symbol ab 16 px, darunter keine", async () => {
    const api = await loadLabels();
    // Rundenzähler: 20 + 90 = 110
    expect(api.labelVariant(CATALOG, "rundenzaehler", 110, true)).toBe("symbolUndName");
    expect(api.labelVariant(CATALOG, "rundenzaehler", 109.999, true)).toBe("nurSymbol");
    expect(api.labelVariant(CATALOG, "rundenzaehler", 16, true)).toBe("nurSymbol");
    expect(api.labelVariant(CATALOG, "rundenzaehler", 15.999, true)).toBe("keine");
    // Anschlussstück: 20 + 105 = 125
    expect(api.labelVariant(CATALOG, "anschlussstueck", 125, true)).toBe("symbolUndName");
    expect(api.labelVariant(CATALOG, "anschlussstueck", 124.999, true)).toBe("nurSymbol");
    // Schalter aus: auch mit viel Platz nur das Symbol
    expect(api.labelVariant(CATALOG, "rundenzaehler", 1000, false)).toBe("nurSymbol");
    expect(api.labelVariant(CATALOG, "rundenzaehler", 16, false)).toBe("nurSymbol");
    expect(api.labelVariant(CATALOG, "rundenzaehler", 15.999, false)).toBe("keine");
    // Schalter aus, kein Symbolteil: immer keine
    expect(api.labelVariant(CATALOG, "gerade-342", 1000, false)).toBe("keine");
    expect(api.labelVariant(CATALOG, "kreuzung", 1000, false)).toBe("keine");
  });

  test("[REQ-LBL-2] Eigenschaft: Variante folgt der Regel für jedes platzierbare Teil, jeden Platz und beide Schalterstellungen", async () => {
    const api = await loadLabels();
    const thresholds = PLACEABLE_IDS.flatMap((id) => {
      const name = CATALOG.find((e) => e.id === id)?.name ?? "";
      const short = shortOf(name);
      return [B(name), 20 + B(name), ...(short === undefined ? [] : [B(short)]), 16];
    });
    const roomArb = fc.oneof(
      fc.double({ min: 0, max: 500, noNaN: true }),
      fc.constantFrom(...thresholds),
      fc.constantFrom(...thresholds).map((t) => t - 1e-9),
    );
    fc.assert(
      fc.property(fc.constantFrom(...PLACEABLE_IDS), roomArb, fc.boolean(), (id, room, on) => {
        expect({ id, room, on, v: api.labelVariant(CATALOG, id, room, on) }).toEqual({
          id,
          room,
          on,
          v: expectedVariant(CATALOG, id, room, on),
        });
      }),
      { numRuns: 2000 },
    );
  });

  test("[REQ-LBL-2] Eigenschaft: wächst der Platz (bzw. s), wird die Variante nie kleiner", async () => {
    const api = await loadLabels();
    fc.assert(
      fc.property(
        fc.constantFrom(...PLACEABLE_IDS),
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.boolean(),
        (id, a, b, on) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const vLo = api.labelVariant(CATALOG, id, lo, on);
          const vHi = api.labelVariant(CATALOG, id, hi, on);
          expect(RANK[vLo], `${id} ${lo}→${hi}: ${vLo} → ${vHi}`).toBeLessThanOrEqual(RANK[vHi]);
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("[REQ-LBL-2] labelPlan rechnet P als Sehne · s und nimmt Variante und Text daraus (Eigenschaft über fehlerfreie Folgen)", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    fc.assert(
      fc.property(
        validElementsArb,
        fc.double({ min: 0.01, max: 20, noNaN: true }),
        fc.boolean(),
        (elements, s, on) => {
          const shapes = D.drawing(CATALOG, elements);
          const plan = api.labelPlan(CATALOG, elements, shapes, s, on);
          expect(plan).toHaveLength(shapes.length);
          plan.forEach((entry, i) => {
            const shape = shapes[i] as ElementShape;
            const el = elements[shape.index] as { readonly id: string; readonly part: string };
            const name = CATALOG.find((c) => c.id === el.part)?.name as string;
            const variant = expectedVariant(CATALOG, el.part, chord(shape.centerline) * s, on);
            const text =
              variant === "voll" || variant === "symbolUndName"
                ? name
                : variant === "kurz"
                  ? shortOf(name)
                  : undefined;
            expect(entry.id).toBe(el.id);
            expect(entry.partId).toBe(el.part);
            expect(entry.variant).toBe(variant);
            expect(entry.text).toBe(text);
            expect(entry.fullName).toBe(name);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-LBL-3: Ort
// ---------------------------------------------------------------------------------------------

describe("Ort der Beschriftung", () => {
  test("[REQ-LBL-3] Beispiele aus der Startpose: Gerade 342, Kurve 1/90° links und rechts, Kreuzung", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const h = (171 * Math.SQRT2) / 2;
    const cases: ReadonlyArray<readonly [LayoutElement, ScreenPoint]> = [
      [
        { id: "a", part: "gerade-342" },
        { x: 171, y: 0 },
      ],
      [
        { id: "a", part: "kurve-1-90", turn: L },
        { x: h, y: -171 + h },
      ],
      [
        { id: "a", part: "kurve-1-90", turn: R },
        { x: h, y: 171 - h },
      ],
      [
        { id: "a", part: "kreuzung" },
        { x: 171, y: 0 },
      ],
    ];
    for (const [el, expected] of cases) {
      const shape = D.drawing(CATALOG, [el])[0] as ElementShape;
      near(api.labelPoint(shape), expected);
      const plan = api.labelPlan(CATALOG, [el], [shape], 1, true);
      near((plan[0] as LabelEntry).at, expected);
    }
    // Zahlen der Spec (gerundet)
    expect(h).toBeCloseTo(120.92, 2);
    expect(-171 + h).toBeCloseTo(-50.08, 2);
  });

  test("[REQ-LBL-3] Eigenschaft: Ort ist Streckenmitte bzw. Bogenpunkt gleichen Abstands zu Anfang und Ende", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    fc.assert(
      fc.property(validElementsArb, (elements) => {
        const shapes = D.drawing(CATALOG, elements);
        const plan = api.labelPlan(CATALOG, elements, shapes, 1, true);
        shapes.forEach((shape, i) => {
          const p = api.labelPoint(shape);
          near(p, midOf(shape.centerline));
          near((plan[i] as LabelEntry).at, p);
          const c = shape.centerline;
          if (c.kind === "bogen") {
            // auf dem Bogen und gleich weit von Anfang und Ende
            expect(
              Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius),
            ).toBeLessThan(1e-6);
            const dFrom = Math.hypot(p.x - c.from.x, p.y - c.from.y);
            const dTo = Math.hypot(p.x - c.to.x, p.y - c.to.y);
            expect(Math.abs(dFrom - dTo)).toBeLessThan(1e-6);
            // Bogenmitte, nicht Sehnenmitte
            const m = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
            expect(Math.hypot(p.x - m.x, p.y - m.y)).toBeGreaterThan(1);
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-LBL-4: wer nichts bekommt
// ---------------------------------------------------------------------------------------------

describe("Keine Beschriftung", () => {
  const idsOf = async (elements: Elements): Promise<ReadonlyArray<string>> => {
    const api = await loadLabels();
    const D = await loadDrawing();
    // großer Maßstab: alles, was beschriftet werden darf, bekommt eine Beschriftung
    const plan = api.labelPlan(CATALOG, elements, D.drawing(CATALOG, elements), 20, true);
    for (const e of plan) expect(e.variant).not.toBe("keine");
    return plan.map((e) => e.id);
  };

  test("[REQ-LBL-4] Querung über einer Kreuzung bekommt nichts, alle übrigen Elemente der Acht je einen Eintrag", async () => {
    expect(await idsOf(ACHT)).toEqual(["e1", "e2", "e3", "e4", "e5", "e7", "e8", "e9", "e10"]);
  });

  test("[REQ-LBL-4] importiertes [steilkehre, gerade-342] liefert nichts; [gerade-342, looping] nur die Gerade", async () => {
    expect(
      await idsOf([
        { id: "a", part: "steilkehre" },
        { id: "b", part: "gerade-342" },
      ]),
    ).toEqual([]);
    expect(
      await idsOf([
        { id: "a", part: "gerade-342" },
        { id: "b", part: "looping" },
      ]),
    ).toEqual(["a"]);
  });

  test("[REQ-LBL-4] Teile mit fehlenden Maßen und alles dahinter bekommen nichts", async () => {
    expect(
      await idsOf([
        { id: "a", part: "gerade-342" },
        { id: "b", part: "looping-teil" },
        { id: "c", part: "rundenzaehler" },
      ]),
    ).toEqual(["a"]);
    expect(
      await idsOf([
        { id: "a", part: "rundenzaehler" },
        { id: "b", part: "kurve-1-90", turn: L },
        { id: "c", part: "steilkehre-teil" },
        { id: "d", part: "anschlussstueck" },
      ]),
    ).toEqual(["a", "b"]);
  });

  test("[REQ-LBL-4] Nachtrag #1: Wireless-Anschluss und Steilkurve werden gezeichnet und beschriftet, auch das Teil dahinter", async () => {
    expect(
      await idsOf([
        { id: "a", part: "gerade-342" },
        { id: "b", part: "wireless-anschluss" },
        { id: "c", part: "steilkurve-1-45", turn: L },
        { id: "d", part: "rundenzaehler" },
      ]),
    ).toEqual(["a", "b", "c", "d"]);
  });

  test("[REQ-LBL-4] Eigenschaft: Einträge genau für die gezeichneten Teil-Elemente vor dem ersten Fehler, in Folgereihenfolge", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    fc.assert(
      fc.property(elementsArb, fc.boolean(), (elements, on) => {
        const drawn = D.drawnSection(CATALOG, elements).drawnCount;
        const expected = elements
          .slice(0, drawn)
          .filter((el) => !("crosses" in el))
          .map((el) => el.id);
        const plan = api.labelPlan(CATALOG, elements, D.drawing(CATALOG, elements), 20, on);
        expect(plan.map((e) => e.id)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-SYM-1: Symbolzuordnung
// ---------------------------------------------------------------------------------------------

describe("Symbolzuordnung", () => {
  test("[REQ-SYM-1] Zuordnung je Katalog-ID; jede andere ID ohne Symbol (Wireless-Anschluss mit Stecker, Nachtrag #1)", async () => {
    const api = await loadLabels();
    expect(api.symbolOf("rundenzaehler")).toBe("zielflagge");
    expect(api.symbolOf("anschlussstueck")).toBe("stecker");
    expect(api.symbolOf("wireless-anschluss")).toBe("stecker");
    expect(api.symbolOf("spurwechsel-gerade")).toBe("spurwechsel");
    expect(api.symbolOf("spurwechselkurve")).toBe("spurwechsel");
    expect(api.symbolOf("engstelle")).toBe("engstelle");
    for (const entry of CATALOG) {
      expect({ id: entry.id, symbol: api.symbolOf(entry.id) }).toEqual({
        id: entry.id,
        symbol: SYMBOLS[entry.id],
      });
    }
    for (const id of ["kreuzung", "steilkurve-1-45", "gerade-342", "kurve-1-90", "x", ""]) {
      expect(api.symbolOf(id)).toBeUndefined();
    }
  });

  test("[REQ-SYM-1] Wirkungsnachweis mit verfälschtem Katalog: rundenzaehler als Gerade 342 behält die Zielflagge, gerade-114 namens Rundenzähler bekommt keine", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const fake: Catalog = CATALOG.map(
      (e): CatalogEntry =>
        e.id === "rundenzaehler"
          ? { ...e, geometry: { kind: "gerade", length: 342 } }
          : e.id === "gerade-114"
            ? { ...e, name: "Rundenzähler" }
            : e,
    );
    const elements: Elements = [
      { id: "a", part: "rundenzaehler" },
      { id: "b", part: "gerade-114" },
    ];
    const shapes = D.drawing(fake, elements);
    expect(shapes.map((s) => Math.round(chord(s.centerline)))).toEqual([342, 114]);
    const plan = api.labelPlan(fake, elements, shapes, 1, true);
    expect(plan.map((e) => [e.id, e.symbol, e.variant, e.text])).toEqual([
      ["a", "zielflagge", "symbolUndName", "Rundenzähler"],
      ["b", undefined, "voll", "Rundenzähler"],
    ]);
    // Platz der verfälschten Geometrie: 342 · 0,05 = 17,1 ≥ 16 → nur Symbol (echt wäre 5,7 → keine)
    const small = api.labelPlan(fake, elements, shapes, 0.05, true);
    expect(small.map((e) => e.variant)).toEqual(["nurSymbol", "keine"]);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-PARCH-2 (Wirkungsteil): Katalog bleibt unberührt
// ---------------------------------------------------------------------------------------------

describe("Katalog unberührt", () => {
  test("[REQ-PARCH-2] die Beschriftungslogik liest den Katalog nur: eingefrorener Katalog, Ergebnis wie mit dem echten, echter Katalog danach unverändert", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const before = JSON.stringify(CATALOG);
    const deepFreeze = <T>(v: T): T => {
      if (typeof v === "object" && v !== null) {
        for (const x of Object.values(v)) deepFreeze(x);
        Object.freeze(v);
      }
      return v;
    };
    const frozen = deepFreeze(structuredClone(CATALOG) as Catalog);
    const elements: Elements = [...OVAL, ...TABLE_SCENE];
    const shapes = D.drawing(CATALOG, elements);
    for (const s of [0.15, 0.4, 1.14, 20]) {
      for (const on of [true, false]) {
        const a = api.labelPlan(frozen, elements, shapes, s, on);
        const b = api.labelPlan(CATALOG, elements, shapes, s, on);
        expect(a).toEqual(b);
      }
    }
    for (const e of CATALOG) {
      expect(api.labelTexts(frozen, e.id)).toEqual(api.labelTexts(CATALOG, e.id));
    }
    for (const id of PLACEABLE_IDS) {
      expect(api.labelVariant(frozen, id, 100, true)).toBe(
        api.labelVariant(CATALOG, id, 100, true),
      );
    }
    expect(JSON.stringify(CATALOG)).toBe(before);
  });
});

describe("Nachtrag #1: Wireless-Anschluss im Plan", () => {
  test("[REQ-SYM-1] [REQ-LBL-2] Wireless-Anschluss trägt im Plan den Stecker und folgt der Platzregel wie das Anschlussstück (P = 114 · s)", async () => {
    const api = await loadLabels();
    const D = await loadDrawing();
    const elements: Elements = [
      { id: "as", part: "anschlussstueck" },
      { id: "w", part: "wireless-anschluss" },
    ];
    const shapes = D.drawing(CATALOG, elements);
    expect(shapes.map((s) => Math.round(chord(s.centerline)))).toEqual([114, 114]);
    // Grenzen: „Symbol + Name“ ab 20 + B(„Wireless-Anschluss“) = 20 + 18 · 7,5 = 155 px;
    // „nur Symbol“ ab 16 px
    const cases: ReadonlyArray<readonly [number, boolean, LabelVariant, string | undefined]> = [
      [1.36, true, "symbolUndName", "Wireless-Anschluss"],
      [1.35, true, "nurSymbol", undefined],
      [0.15, true, "nurSymbol", undefined],
      [0.15, false, "nurSymbol", undefined],
      [0.14, true, "keine", undefined],
      [20, false, "nurSymbol", undefined],
    ];
    for (const [scale, on, variant, text] of cases) {
      const w = api.labelPlan(CATALOG, elements, shapes, scale, on)[1];
      expect({ scale, on, entry: w && [w.id, w.symbol, w.variant, w.text, w.fullName] }).toEqual({
        scale,
        on,
        entry: ["w", "stecker", variant, text, "Wireless-Anschluss"],
      });
    }
    // dasselbe Symbol wie das Anschlussstück
    const plan = api.labelPlan(CATALOG, elements, shapes, 20, true);
    expect(plan.map((e) => e.symbol)).toEqual(["stecker", "stecker"]);
  });
});
