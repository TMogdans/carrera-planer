/**
 * Spec M3b Teil A (.specify/specs/m3b-backend/spec.md): Datenvertrag der API. Abnahmetests
 * REQ-API-1, REQ-API-2, REQ-API-3 und der Schema-Teil von REQ-SARCH-1.
 *
 * Öffentliche API (von spec-to-tests gewählt, wo die Spec die Namen offen lässt):
 * - `src/schema/index.ts` exportiert zusätzlich (z. B. aus `src/schema/api.ts`):
 *     LayoutNameSchema          Layoutname nach „Begriffe“ (REQ-API-1)
 *     LayoutSummarySchema       { name, version ≥ 1, updatedAt, defekt?: string } (Übersicht)
 *     LayoutStateSchema         { name, version ≥ 1, updatedAt, layout } (Layout-Stand)
 *     InventoryStateSchema      { version ≥ 0, updatedAt: string | null, inventory } (Bestands-Stand)
 *     PutLayoutRequestSchema    { expectedVersion ≥ 0, layout }
 *     PutInventoryRequestSchema { expectedVersion ≥ 0, inventory }
 *   und je Fehlerform ein Schema mit dem Namen ihres `_tag` (REQ-API-3):
 *     UngueltigeAnfrage { _tag, reason }       NichtGefunden { _tag, name }
 *     VersionKonflikt   { _tag, expectedVersion, aktuell: LayoutState | InventoryState | null }
 *     GespeichertUngueltig { _tag, ziel, version, reason }   ZuGross { _tag }
 *     FremderHost { _tag, host: string | null }   ServerFehler { _tag, text }
 *   Ob die Fehler als `Schema.TaggedError`-Klassen oder als `Schema.TaggedStruct` vorliegen, ist
 *   frei; geprüft wird über Dekodieren der kodierten (JSON-)Form und Kodieren zurück.
 * - Abweisen mit den Standard-Optionen von Effect (wie M1/M3a): Zusatzfelder macht das Schema
 *   selbst zum Fehler, nicht der Aufrufer.
 * - `updatedAt`: ISO 8601 in UTC mit genau drei Nachkommastellen und `Z`, also die Form von
 *   `Date.prototype.toISOString()`.
 * - Roundtrip-Eigenschaften mit Generatoren aus den Schemas (Arbitrary.make, Constitution). Wer
 *   `updatedAt` mit eigenem Filter statt `Schema.pattern` prüft, muss dem Schema eine
 *   Arbitrary-Annotation geben, sonst findet der Generator keine Werte.
 *
 * Die M1- und M3a-Tests (schema.test.ts, inventory.test.ts) bleiben unverändert.
 */
import { Arbitrary, Either, FastCheck, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "./index.js";

type LayoutElement =
  | { readonly id: string; readonly part: string; readonly turn?: "links" | "rechts" }
  | { readonly id: string; readonly crosses: string };
type Layout = { readonly schemaVersion: 1; readonly elements: ReadonlyArray<LayoutElement> };
type Inventory = { readonly schemaVersion: 1; readonly counts: Readonly<Record<string, number>> };

type AnySchema = Schema.Schema<unknown, unknown>;

const S = schemaModule as unknown as Record<string, AnySchema | undefined>;
const schemaOf = (name: string): AnySchema => {
  const s = S[name];
  if (s === undefined) throw new Error(`src/schema/index.ts exportiert ${name} nicht`);
  return s;
};

const accepts = (name: string, input: unknown): boolean =>
  Either.isRight(Schema.decodeUnknownEither(schemaOf(name))(input));

/** Dekodieren, dann kodieren: ergibt für gültige JSON-Werte wieder denselben Wert. */
const reencode = (name: string, input: unknown): unknown =>
  Schema.encodeSync(schemaOf(name))(Schema.decodeUnknownSync(schemaOf(name))(input));

const withoutKey = (o: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const OVAL: Layout = {
  schemaVersion: 1,
  elements: [
    { id: "o1", part: "kurve-1-90", turn: "links" },
    { id: "o2", part: "kurve-1-90", turn: "links" },
    { id: "o3", part: "gerade-342" },
    { id: "o4", part: "kurve-1-90", turn: "links" },
    { id: "o5", part: "kurve-1-90", turn: "links" },
    { id: "o6", part: "gerade-342" },
  ],
};
const INVENTORY: Inventory = {
  schemaVersion: 1,
  counts: { "kurve-1-90": 8, "gibt-es-nicht": 3 },
};
const T = "2026-11-25T08:15:00.000Z";

const SUMMARY = { name: "Oval", version: 1, updatedAt: T };
const LAYOUT_STATE = { name: "Oval", version: 2, updatedAt: T, layout: OVAL };
const INVENTORY_STATE = { version: 1, updatedAt: T, inventory: INVENTORY };
const INVENTORY_NEVER = {
  version: 0,
  updatedAt: null,
  inventory: { schemaVersion: 1, counts: {} },
};
const PUT_LAYOUT = { expectedVersion: 0, layout: OVAL };
const PUT_INVENTORY = { expectedVersion: 3, inventory: INVENTORY };

// ---------------------------------------------------------------------------------------------
// REQ-API-1 Layoutname
// ---------------------------------------------------------------------------------------------

describe("Layoutname", () => {
  test.skip("[REQ-API-1] angenommen: Oval, Acht / groß, a:b, 100%, Umlaute und genau 200 Zeichen", () => {
    for (const name of [
      "Oval",
      "Acht / groß",
      "a:b",
      "100%",
      "Große Schleife",
      "a b",
      "x",
      "a".repeat(200),
      "🚗".repeat(100), // 200 UTF-16-Einheiten: gezählt wird die Länge der JS-Zeichenkette
    ]) {
      expect(accepts("LayoutNameSchema", name), JSON.stringify(name)).toBe(true);
      expect(reencode("LayoutNameSchema", name)).toBe(name);
    }
  });

  test.skip("[REQ-API-1] abgewiesen: leer, nur Leerraum, Leerraum am Rand, über 200 Zeichen, kein String", () => {
    for (const name of [
      "",
      " ",
      "   ",
      "\t",
      " Oval",
      "Oval ",
      "\tOval",
      "Oval\n",
      " Oval ",
      "a".repeat(201),
      `${"🚗".repeat(100)}a`, // 201 UTF-16-Einheiten
      42,
      null,
      undefined,
      ["Oval"],
      { name: "Oval" },
    ]) {
      expect(accepts("LayoutNameSchema", name), JSON.stringify(name)).toBe(false);
    }
  });

  test.skip("[REQ-API-1] der Name wird beim Dekodieren nicht verändert (kein stilles Trimmen)", () => {
    const decoded = Schema.decodeUnknownEither(schemaOf("LayoutNameSchema"))(" Oval");
    expect(Either.isLeft(decoded)).toBe(true);
    expect(Schema.decodeUnknownSync(schemaOf("LayoutNameSchema"))("Acht / groß")).toBe(
      "Acht / groß",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-2 Stände und Anfragen
// ---------------------------------------------------------------------------------------------

describe("Stände und Anfragen", () => {
  test.skip("[REQ-API-2] gültige Werte werden angenommen und unverändert zurückkodiert", () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["LayoutSummarySchema", SUMMARY],
      ["LayoutSummarySchema", { ...SUMMARY, defekt: "schemaVersion: erwartet 1" }],
      ["LayoutStateSchema", LAYOUT_STATE],
      ["InventoryStateSchema", INVENTORY_STATE],
      ["InventoryStateSchema", INVENTORY_NEVER],
      ["PutLayoutRequestSchema", PUT_LAYOUT],
      ["PutLayoutRequestSchema", { expectedVersion: 7, layout: OVAL }],
      ["PutInventoryRequestSchema", PUT_INVENTORY],
      ["PutInventoryRequestSchema", { expectedVersion: 0, inventory: INVENTORY }],
    ];
    for (const [name, value] of cases) {
      expect(accepts(name, value), `${name} ${JSON.stringify(value)}`).toBe(true);
      expect(reencode(name, value)).toEqual(value);
    }
  });

  test.skip("[REQ-API-2] Untergrenzen der Version: Übersicht und Layout-Stand ab 1, Bestand ab 0, Anfragen ab 0", () => {
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, version: 0 })).toBe(false);
    expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, version: 0 })).toBe(false);
    expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, version: 1 })).toBe(true);
    expect(accepts("InventoryStateSchema", { ...INVENTORY_STATE, version: 0 })).toBe(true);
    expect(accepts("PutLayoutRequestSchema", { ...PUT_LAYOUT, expectedVersion: 0 })).toBe(true);
    expect(accepts("PutInventoryRequestSchema", { ...PUT_INVENTORY, expectedVersion: 0 })).toBe(
      true,
    );
  });

  test.skip("[REQ-API-2] negative, gebrochene und als Text geschriebene Versionen werden abgewiesen", () => {
    for (const bad of [-1, 1.5, "1", "0", Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(accepts("LayoutSummarySchema", { ...SUMMARY, version: bad }), String(bad)).toBe(false);
      expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, version: bad }), String(bad)).toBe(
        false,
      );
      expect(
        accepts("InventoryStateSchema", { ...INVENTORY_STATE, version: bad }),
        String(bad),
      ).toBe(false);
      expect(
        accepts("PutLayoutRequestSchema", { ...PUT_LAYOUT, expectedVersion: bad }),
        String(bad),
      ).toBe(false);
      expect(
        accepts("PutInventoryRequestSchema", { ...PUT_INVENTORY, expectedVersion: bad }),
        String(bad),
      ).toBe(false);
    }
  });

  test.skip("[REQ-API-2] unbekannte Zusatzfelder werden abgewiesen, auch im eingebetteten Layout bzw. Bestand", () => {
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, layout: OVAL })).toBe(false);
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, zusatz: 1 })).toBe(false);
    expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, zusatz: 1 })).toBe(false);
    expect(accepts("InventoryStateSchema", { ...INVENTORY_STATE, zusatz: 1 })).toBe(false);
    expect(accepts("PutLayoutRequestSchema", { ...PUT_LAYOUT, name: "Oval" })).toBe(false);
    expect(accepts("PutInventoryRequestSchema", { ...PUT_INVENTORY, zusatz: true })).toBe(false);
    expect(
      accepts("PutLayoutRequestSchema", { ...PUT_LAYOUT, layout: { ...OVAL, zusatz: 1 } }),
    ).toBe(false);
    expect(
      accepts("PutInventoryRequestSchema", {
        ...PUT_INVENTORY,
        inventory: { ...INVENTORY, zusatz: 1 },
      }),
    ).toBe(false);
  });

  test.skip("[REQ-API-2] ein fehlendes Pflichtfeld wird abgewiesen", () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, ReadonlyArray<string>]> =
      [
        ["LayoutSummarySchema", SUMMARY, ["name", "version", "updatedAt"]],
        ["LayoutStateSchema", LAYOUT_STATE, ["name", "version", "updatedAt", "layout"]],
        ["InventoryStateSchema", INVENTORY_STATE, ["version", "updatedAt", "inventory"]],
        ["PutLayoutRequestSchema", PUT_LAYOUT, ["expectedVersion", "layout"]],
        ["PutInventoryRequestSchema", PUT_INVENTORY, ["expectedVersion", "inventory"]],
      ];
    for (const [name, value, keys] of cases) {
      for (const key of keys) {
        expect(accepts(name, withoutKey(value, key)), `${name} ohne ${key}`).toBe(false);
      }
    }
  });

  test.skip("[REQ-API-2] eingebettetes Layout und eingebetteter Bestand werden mit LayoutSchema bzw. InventorySchema geprüft", () => {
    const dupIds = {
      schemaVersion: 1,
      elements: [
        { id: "a", part: "gerade-342" },
        { id: "a", part: "gerade-342" },
      ],
    };
    expect(accepts("PutLayoutRequestSchema", { expectedVersion: 0, layout: dupIds })).toBe(false);
    expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, layout: dupIds })).toBe(false);
    expect(
      accepts("PutLayoutRequestSchema", {
        expectedVersion: 0,
        layout: { schemaVersion: 2, elements: [] },
      }),
    ).toBe(false);
    expect(
      accepts("PutLayoutRequestSchema", { expectedVersion: 0, layout: { elements: [] } }),
    ).toBe(false);
    expect(
      accepts("PutInventoryRequestSchema", {
        expectedVersion: 0,
        inventory: { schemaVersion: 1, counts: { "kurve-1-90": -1 } },
      }),
    ).toBe(false);
    expect(
      accepts("InventoryStateSchema", {
        ...INVENTORY_STATE,
        inventory: { schemaVersion: 2, counts: {} },
      }),
    ).toBe(false);
    // Unbekannte Teil-IDs sind schema-gültig (der Server prüft nicht gegen den Katalog)
    expect(
      accepts("PutInventoryRequestSchema", {
        expectedVersion: 0,
        inventory: { schemaVersion: 1, counts: { "gibt-es-nicht": 3 } },
      }),
    ).toBe(true);
  });

  test.skip("[REQ-API-2] der Name in Übersicht und Stand folgt REQ-API-1", () => {
    for (const bad of ["", " Oval", "a".repeat(201), 7]) {
      expect(accepts("LayoutSummarySchema", { ...SUMMARY, name: bad })).toBe(false);
      expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, name: bad })).toBe(false);
    }
    expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, name: "Acht / groß" })).toBe(true);
  });

  test.skip("[REQ-API-2] updatedAt ist ISO 8601 in UTC mit Millisekunden und Z; beim Bestand auch null", () => {
    for (const good of [T, "1999-01-01T00:00:00.000Z", new Date(0).toISOString()]) {
      expect(accepts("LayoutSummarySchema", { ...SUMMARY, updatedAt: good }), good).toBe(true);
      expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, updatedAt: good }), good).toBe(true);
      expect(accepts("InventoryStateSchema", { ...INVENTORY_STATE, updatedAt: good }), good).toBe(
        true,
      );
    }
    for (const bad of [
      "2026-11-25T08:15:00Z", // ohne Millisekunden
      "2026-11-25T08:15:00.0Z",
      "2026-11-25T08:15:00.000", // ohne Z
      "2026-11-25T08:15:00.000+01:00", // nicht UTC
      "2026-11-25 08:15:00.000Z",
      "2026-11-25",
      "",
      1764058500000,
    ]) {
      expect(accepts("LayoutSummarySchema", { ...SUMMARY, updatedAt: bad }), String(bad)).toBe(
        false,
      );
      expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, updatedAt: bad }), String(bad)).toBe(
        false,
      );
      expect(
        accepts("InventoryStateSchema", { ...INVENTORY_STATE, updatedAt: bad }),
        String(bad),
      ).toBe(false);
    }
    expect(accepts("InventoryStateSchema", INVENTORY_NEVER)).toBe(true);
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, updatedAt: null })).toBe(false);
    expect(accepts("LayoutStateSchema", { ...LAYOUT_STATE, updatedAt: null })).toBe(false);
  });

  test.skip("[REQ-API-2] defekt ist optional und, wenn vorhanden, ein Grund als Zeichenkette", () => {
    expect(accepts("LayoutSummarySchema", SUMMARY)).toBe(true);
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, defekt: "Zusatzfeld x" })).toBe(true);
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, defekt: 1 })).toBe(false);
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, defekt: true })).toBe(false);
    expect(accepts("LayoutSummarySchema", { ...SUMMARY, defekt: null })).toBe(false);
  });

  test.skip("[REQ-API-2] Eigenschaft: Kodieren und Dekodieren eines gültigen Werts ergibt denselben Wert", () => {
    for (const name of [
      "LayoutNameSchema",
      "LayoutSummarySchema",
      "LayoutStateSchema",
      "InventoryStateSchema",
      "PutLayoutRequestSchema",
      "PutInventoryRequestSchema",
    ]) {
      const schema = schemaOf(name);
      FastCheck.assert(
        FastCheck.property(Arbitrary.make(schema), (value) => {
          const encoded = Schema.encodeSync(schema)(value);
          // über JSON, wie auf der Leitung
          const decoded = Schema.decodeUnknownSync(schema)(JSON.parse(JSON.stringify(encoded)));
          expect(decoded).toEqual(value);
          expect(Schema.encodeSync(schema)(decoded)).toEqual(encoded);
        }),
        { numRuns: 100 },
      );
    }
  });

  test.skip("[REQ-API-2] LayoutSchema und InventorySchema bleiben die aus M1/M3a: Stand und Anfrage betten genau sie ein", () => {
    const base = schemaModule as unknown as {
      readonly LayoutSchema: Schema.Schema<Layout, unknown>;
      readonly InventorySchema: Schema.Schema<Inventory, unknown>;
    };
    FastCheck.assert(
      FastCheck.property(
        FastCheck.oneof(Arbitrary.make(base.LayoutSchema), FastCheck.anything()),
        (layout) => {
          const direct = Either.isRight(Schema.decodeUnknownEither(base.LayoutSchema)(layout));
          expect(accepts("PutLayoutRequestSchema", { expectedVersion: 1, layout })).toBe(direct);
        },
      ),
      { numRuns: 200 },
    );
    FastCheck.assert(
      FastCheck.property(
        FastCheck.oneof(Arbitrary.make(base.InventorySchema), FastCheck.anything()),
        (inventory) => {
          const direct = Either.isRight(
            Schema.decodeUnknownEither(base.InventorySchema)(inventory),
          );
          expect(accepts("PutInventoryRequestSchema", { expectedVersion: 1, inventory })).toBe(
            direct,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-API-3 Fehlerformen
// ---------------------------------------------------------------------------------------------

const ERRORS: ReadonlyArray<readonly [string, ReadonlyArray<Record<string, unknown>>]> = [
  ["UngueltigeAnfrage", [{ _tag: "UngueltigeAnfrage", reason: "expectedVersion: erwartet ≥ 0" }]],
  ["NichtGefunden", [{ _tag: "NichtGefunden", name: "Acht / groß" }]],
  [
    "VersionKonflikt",
    [
      { _tag: "VersionKonflikt", expectedVersion: 3, aktuell: { ...LAYOUT_STATE, version: 4 } },
      { _tag: "VersionKonflikt", expectedVersion: 0, aktuell: INVENTORY_STATE },
      { _tag: "VersionKonflikt", expectedVersion: 2, aktuell: null },
    ],
  ],
  [
    "GespeichertUngueltig",
    [
      { _tag: "GespeichertUngueltig", ziel: "Oval", version: 1, reason: "schemaVersion fehlt" },
      { _tag: "GespeichertUngueltig", ziel: "bestand", version: 4, reason: "counts fehlt" },
    ],
  ],
  ["ZuGross", [{ _tag: "ZuGross" }]],
  [
    "FremderHost",
    [
      { _tag: "FremderHost", host: "evil.example:8080" },
      { _tag: "FremderHost", host: null },
    ],
  ],
  ["ServerFehler", [{ _tag: "ServerFehler", text: "interner Fehler" }]],
];

describe("Fehlerformen", () => {
  test.skip("[REQ-API-3] jede Fehlerform dekodiert ihre JSON-Form mit _tag und kodiert sie unverändert zurück", () => {
    for (const [name, values] of ERRORS) {
      for (const value of values) {
        expect(accepts(name, value), `${name} ${JSON.stringify(value)}`).toBe(true);
        expect(reencode(name, value)).toEqual(value);
      }
    }
  });

  test.skip("[REQ-API-3] Zusatzfelder, fremder oder fehlender _tag und fehlende Pflichtfelder werden abgewiesen", () => {
    for (const [name, values] of ERRORS) {
      const value = values[0] as Record<string, unknown>;
      expect(accepts(name, { ...value, zusatz: 1 }), `${name} mit Zusatzfeld`).toBe(false);
      expect(accepts(name, { ...value, _tag: "Anders" }), `${name} mit fremdem _tag`).toBe(false);
      expect(accepts(name, withoutKey(value, "_tag")), `${name} ohne _tag`).toBe(false);
      for (const key of Object.keys(value).filter((k) => k !== "_tag")) {
        expect(accepts(name, withoutKey(value, key)), `${name} ohne ${key}`).toBe(false);
      }
    }
  });

  test.skip("[REQ-API-3] Feldtypen: Versionen ganzzahlig, aktuell nur Layout-Stand, Bestands-Stand oder null, host Text oder null", () => {
    const konflikt = { _tag: "VersionKonflikt", expectedVersion: 3, aktuell: null };
    expect(accepts("VersionKonflikt", { ...konflikt, expectedVersion: -1 })).toBe(false);
    expect(accepts("VersionKonflikt", { ...konflikt, expectedVersion: 1.5 })).toBe(false);
    expect(accepts("VersionKonflikt", { ...konflikt, expectedVersion: "3" })).toBe(false);
    expect(accepts("VersionKonflikt", { ...konflikt, aktuell: { version: 1 } })).toBe(false);
    expect(accepts("VersionKonflikt", { ...konflikt, aktuell: SUMMARY })).toBe(false);
    expect(
      accepts("VersionKonflikt", {
        ...konflikt,
        aktuell: { ...LAYOUT_STATE, layout: { schemaVersion: 1, elements: [], x: 1 } },
      }),
    ).toBe(false);
    const gespeichert = { _tag: "GespeichertUngueltig", ziel: "Oval", version: 1, reason: "x" };
    expect(accepts("GespeichertUngueltig", { ...gespeichert, version: "1" })).toBe(false);
    expect(accepts("GespeichertUngueltig", { ...gespeichert, version: 1.5 })).toBe(false);
    expect(accepts("GespeichertUngueltig", { ...gespeichert, ziel: 5 })).toBe(false);
    expect(accepts("FremderHost", { _tag: "FremderHost", host: 8080 })).toBe(false);
    expect(accepts("NichtGefunden", { _tag: "NichtGefunden", name: 1 })).toBe(false);
    expect(accepts("UngueltigeAnfrage", { _tag: "UngueltigeAnfrage", reason: 1 })).toBe(false);
    expect(accepts("ServerFehler", { _tag: "ServerFehler", text: null })).toBe(false);
  });

  test.skip("[REQ-API-3] Eigenschaft: Kodieren und Dekodieren jeder Fehlerform ergibt denselben Wert", () => {
    for (const [name] of ERRORS) {
      const schema = schemaOf(name);
      FastCheck.assert(
        FastCheck.property(Arbitrary.make(schema), (value) => {
          const encoded = Schema.encodeSync(schema)(value);
          const json = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>;
          expect(json._tag).toBe(name);
          expect(Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(json))).toEqual(
            encoded,
          );
        }),
        { numRuns: 50 },
      );
    }
  });
});
