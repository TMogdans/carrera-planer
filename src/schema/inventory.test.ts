/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Datenvertrag für Bestand, Set-Vorlagen und
 * Prägung. Abnahmetests REQ-BEST-1, REQ-SET-1, REQ-PRAEG-1.
 *
 * Öffentliche API (von spec-to-tests gewählt, wo die Spec sie offen lässt):
 * - `src/schema/index.ts` exportiert zusätzlich
 *     InventorySchema:   { schemaVersion: 1, counts: Record<nicht leere Teil-ID, ganze Zahl ≥ 0> }
 *     SetTemplateSchema: { id, name, articleNumber (genau 8 ASCII-Ziffern), source,
 *                          certainty: "hoch"|"mittel"|"niedrig",
 *                          contents: nicht leere Liste aus { part (nicht leer), count (ganz ≥ 1) } }
 * - `CatalogEntrySchema` bekommt das optionale Feld
 *     praegung: nicht leere Liste aus { value, source (nicht leer), certainty }
 *   value: nicht leer, kein Leerraum am Rand, nicht genau 8 ASCII-Ziffern.
 * - Abweisen mit den Standard-Optionen von Effect (wie M1): Zusatzfelder macht das Schema selbst
 *   zum Fehler.
 * - Roundtrip-Eigenschaften mit aus dem Schema abgeleiteten Generatoren (Arbitrary.make).
 *
 * Die M1-Tests (schema.test.ts) bleiben unverändert; diese Datei ergänzt sie.
 */
import { Arbitrary, Either, FastCheck, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "./index.js";

type Certainty = "hoch" | "mittel" | "niedrig";
type Praegung = { readonly value: string; readonly source: string; readonly certainty: Certainty };
type Inventory = {
  readonly schemaVersion: 1;
  readonly counts: Readonly<Record<string, number>>;
};
type SetTemplate = {
  readonly id: string;
  readonly name: string;
  readonly articleNumber: string;
  readonly source: string;
  readonly certainty: Certainty;
  readonly contents: ReadonlyArray<{ readonly part: string; readonly count: number }>;
};
type CatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly articleNumbers: ReadonlyArray<string> | "keineEigene";
  readonly source: string;
  readonly certainty: Certainty;
  readonly geometry: { readonly kind: string };
  readonly praegung?: ReadonlyArray<Praegung>;
};

const schemas = schemaModule as unknown as {
  readonly InventorySchema: Schema.Schema<Inventory, unknown>;
  readonly SetTemplateSchema: Schema.Schema<SetTemplate, unknown>;
  readonly CatalogEntrySchema: Schema.Schema<CatalogEntry, unknown>;
};

const accepted = (r: Either.Either<unknown, unknown>): boolean => Either.isRight(r);
const decodeInventory = (input: unknown) =>
  Schema.decodeUnknownEither(schemas.InventorySchema)(input);
const decodeTemplate = (input: unknown) =>
  Schema.decodeUnknownEither(schemas.SetTemplateSchema)(input);
const decodeEntry = (input: unknown) =>
  Schema.decodeUnknownEither(schemas.CatalogEntrySchema)(input);

const withoutKey = (o: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const INVENTORY: Inventory = {
  schemaVersion: 1,
  counts: { "kurve-1-90": 8, "gerade-342": 0, "gibt-es-nicht": 3 },
};

const TEMPLATE: SetTemplate = {
  id: "ausbauset-1",
  name: "Ausbauset 1",
  articleNumber: "20061600",
  source: "Händlerangabe",
  certainty: "niedrig",
  contents: [
    { part: "kurve-1-90", count: 2 },
    { part: "spurwechsel-gerade", count: 2 },
    { part: "gerade-342", count: 2 },
  ],
};

const ENTRY: CatalogEntry = {
  id: "steilkehre-teil",
  name: "Steilkehre-Teil (K)",
  articleNumbers: "keineEigene",
  source: "Karton Mach 8 (nur in Baugruppe)",
  certainty: "niedrig",
  geometry: { kind: "masseFehlen" },
};
const P: Praegung = { value: "141903-1B", source: "gokarli.de", certainty: "niedrig" };

describe("Bestand-Schema", () => {
  test.skip("[REQ-BEST-1] gültiger Bestand: schemaVersion 1, Anzahlen ganz ≥ 0, auch unbekannte Teil-IDs", () => {
    for (const doc of [
      INVENTORY,
      { schemaVersion: 1, counts: {} },
      { schemaVersion: 1, counts: { "looping-teil": 0 } },
      { schemaVersion: 1, counts: { steilkehre: 1, x: 1000000 } },
    ]) {
      const r = decodeInventory(doc);
      expect({ doc, accepted: accepted(r) }).toEqual({ doc, accepted: true });
      if (Either.isRight(r)) expect(r.right).toEqual(doc);
    }
  });

  test.skip("[REQ-BEST-1] Zusatzfelder, fehlende/fremde Version, negative/gebrochene/Text-Anzahlen und leerer Schlüssel werden abgewiesen", () => {
    const invalid: ReadonlyArray<readonly [string, unknown]> = [
      ["Zusatzfeld", { ...INVENTORY, name: "Kiste" }],
      ["schemaVersion fehlt", withoutKey(INVENTORY, "schemaVersion")],
      ["counts fehlt", withoutKey(INVENTORY, "counts")],
      ["Version 2", { ...INVENTORY, schemaVersion: 2 }],
      ["Version 0", { ...INVENTORY, schemaVersion: 0 }],
      ["Version als Text", { ...INVENTORY, schemaVersion: "1" }],
      ["negativ", { schemaVersion: 1, counts: { "kurve-1-90": -1 } }],
      ["gebrochen", { schemaVersion: 1, counts: { "kurve-1-90": 2.5 } }],
      ["Text", { schemaVersion: 1, counts: { "kurve-1-90": "3" } }],
      ["null", { schemaVersion: 1, counts: { "kurve-1-90": null } }],
      ["unendlich", { schemaVersion: 1, counts: { "kurve-1-90": Number.POSITIVE_INFINITY } }],
      ["NaN", { schemaVersion: 1, counts: { "kurve-1-90": Number.NaN } }],
      ["leerer Schlüssel", { schemaVersion: 1, counts: { "": 2 } }],
      ["leerer Schlüssel neben gültigem", { schemaVersion: 1, counts: { "kurve-1-90": 1, "": 0 } }],
      ["counts als Liste", { schemaVersion: 1, counts: [["kurve-1-90", 1]] }],
      ["counts als Text", { schemaVersion: 1, counts: "kurve-1-90" }],
      ["null", null],
      ["Liste", []],
    ];
    for (const [label, input] of invalid) {
      expect({ label, accepted: accepted(decodeInventory(input)) }).toEqual({
        label,
        accepted: false,
      });
    }
  });

  test.skip("[REQ-BEST-1] Kodieren und Dekodieren eines gültigen Bestands ergibt denselben Wert (Eigenschaft)", () => {
    const roundtrip = (v: Inventory): Inventory =>
      Schema.decodeUnknownSync(schemas.InventorySchema)(
        Schema.encodeSync(schemas.InventorySchema)(v),
      );
    expect(roundtrip(INVENTORY)).toEqual(INVENTORY);
    // Bekannte Grenze (kein Gegenstand der Spec): Ein eigener Schlüssel `__proto__` geht beim
    // Dekodieren von Effect-Records verloren (effect@3.22, gemessen). Er ist keine Teil-ID und
    // wird deshalb aus dem Generator ausgeschlossen, damit die Eigenschaft nicht zufällig rötet.
    FastCheck.assert(
      FastCheck.property(
        Arbitrary.make(schemas.InventorySchema).filter(
          (inv) => !Object.keys(inv.counts).includes("__proto__"),
        ),
        (inv) => {
          expect(roundtrip(inv)).toEqual(inv);
        },
      ),
    );
  });
});

describe("Set-Vorlagen-Schema", () => {
  test.skip("[REQ-SET-1] gültige Vorlage wird angenommen, alle drei Sicherheiten", () => {
    for (const certainty of ["hoch", "mittel", "niedrig"]) {
      const t = { ...TEMPLATE, certainty };
      const r = decodeTemplate(t);
      expect({ certainty, accepted: accepted(r) }).toEqual({ certainty, accepted: true });
      if (Either.isRight(r)) expect(r.right).toEqual(t);
    }
    expect(accepted(decodeTemplate({ ...TEMPLATE, contents: [{ part: "x", count: 1 }] }))).toBe(
      true,
    );
  });

  test.skip("[REQ-SET-1] Pflichtfelder, leere Felder, Zusatzfelder, Artikelnummer und count werden geprüft", () => {
    const invalid: ReadonlyArray<readonly [string, unknown]> = [
      ...["id", "name", "articleNumber", "source", "certainty", "contents"].map(
        (k): readonly [string, unknown] => [`${k} fehlt`, withoutKey(TEMPLATE, k)],
      ),
      ...["id", "name", "source"].map((k): readonly [string, unknown] => [
        `${k} leer`,
        { ...TEMPLATE, [k]: "" },
      ]),
      ["Zusatzfeld", { ...TEMPLATE, preis: 30 }],
      ["Zusatzfeld im Inhalt", { ...TEMPLATE, contents: [{ part: "x", count: 1, farbe: "rot" }] }],
      ["Sicherheit unbekannt", { ...TEMPLATE, certainty: "ungeprüft" }],
      ["Art.-Nr. 7 Ziffern", { ...TEMPLATE, articleNumber: "2006160" }],
      ["Art.-Nr. 9 Ziffern", { ...TEMPLATE, articleNumber: "200616000" }],
      ["Art.-Nr. mit Buchstabe", { ...TEMPLATE, articleNumber: "2006160a" }],
      ["Art.-Nr. mit Leerraum", { ...TEMPLATE, articleNumber: " 20061600" }],
      ["Art.-Nr. als Zahl", { ...TEMPLATE, articleNumber: 20061600 }],
      ["Art.-Nr. als Liste", { ...TEMPLATE, articleNumber: ["20061600"] }],
      ["Inhalt leer", { ...TEMPLATE, contents: [] }],
      ["count 0", { ...TEMPLATE, contents: [{ part: "kurve-1-90", count: 0 }] }],
      ["count negativ", { ...TEMPLATE, contents: [{ part: "kurve-1-90", count: -1 }] }],
      ["count gebrochen", { ...TEMPLATE, contents: [{ part: "kurve-1-90", count: 1.5 }] }],
      ["count als Text", { ...TEMPLATE, contents: [{ part: "kurve-1-90", count: "2" }] }],
      ["count fehlt", { ...TEMPLATE, contents: [{ part: "kurve-1-90" }] }],
      ["part leer", { ...TEMPLATE, contents: [{ part: "", count: 1 }] }],
      ["part fehlt", { ...TEMPLATE, contents: [{ count: 1 }] }],
      ["Inhalt als Objekt", { ...TEMPLATE, contents: { "kurve-1-90": 2 } }],
    ];
    for (const [label, input] of invalid) {
      expect({ label, accepted: accepted(decodeTemplate(input)) }).toEqual({
        label,
        accepted: false,
      });
    }
  });

  test.skip("[REQ-SET-1] Kodieren und Dekodieren ergibt denselben Wert (Eigenschaft)", () => {
    const roundtrip = (v: SetTemplate): SetTemplate =>
      Schema.decodeUnknownSync(schemas.SetTemplateSchema)(
        Schema.encodeSync(schemas.SetTemplateSchema)(v),
      );
    expect(roundtrip(TEMPLATE)).toEqual(TEMPLATE);
    FastCheck.assert(
      FastCheck.property(Arbitrary.make(schemas.SetTemplateSchema), (t) => {
        expect(roundtrip(t)).toEqual(t);
      }),
    );
  });
});

describe("Prägung im Katalog-Schema", () => {
  test.skip("[REQ-PRAEG-1] praegung ist optional; Eintrag mit einer oder mehreren Prägungen wird angenommen", () => {
    expect(accepted(decodeEntry(ENTRY))).toBe(true);
    for (const praegung of [
      [P],
      [P, { value: "142202-1", source: "Kleinanzeigen", certainty: "hoch" }],
      [{ ...P, certainty: "mittel" }],
      [{ ...P, value: "2006160" }], // 7 Ziffern: keine Artikelnummer
      [{ ...P, value: "200616021" }], // 9 Ziffern
      [{ ...P, value: "141903 1B" }], // Leerraum innen
      [{ ...P, value: "K" }],
    ]) {
      const entry = { ...ENTRY, praegung };
      const r = decodeEntry(entry);
      expect({ praegung, accepted: accepted(r) }).toEqual({ praegung, accepted: true });
      if (Either.isRight(r)) expect(r.right).toEqual(entry);
    }
    // auch zusammen mit Artikelnummern
    const withNumbers = {
      ...ENTRY,
      id: "gerade-342",
      articleNumbers: ["20061602"],
      praegung: [{ value: "142202-1", source: "Kleinanzeigen", certainty: "niedrig" }],
    };
    expect(accepted(decodeEntry(withNumbers))).toBe(true);
  });

  test.skip("[REQ-PRAEG-1] leere Liste, Zusatzfeld, fehlende/leere Quelle, Leerraum am Rand und genau 8 Ziffern werden abgewiesen", () => {
    const invalid: ReadonlyArray<readonly [string, unknown]> = [
      ["leere Liste", []],
      ["Zusatzfeld", [{ ...P, foto: "k.jpg" }]],
      ["source fehlt", [withoutKey(P, "source")]],
      ["source leer", [{ ...P, source: "" }]],
      ["certainty fehlt", [withoutKey(P, "certainty")]],
      ["certainty unbekannt", [{ ...P, certainty: "sicher" }]],
      ["value fehlt", [withoutKey(P, "value")]],
      ["value leer", [{ ...P, value: "" }]],
      ["Leerraum vorn", [{ ...P, value: " 141903-1B" }]],
      ["Leerraum hinten", [{ ...P, value: "141903-1B " }]],
      ["Tab vorn", [{ ...P, value: "\t141903-1B" }]],
      ["Zeilenumbruch hinten", [{ ...P, value: "141903-1B\n" }]],
      ["nur Leerraum", [{ ...P, value: "   " }]],
      ["genau 8 Ziffern", [{ ...P, value: "20061613" }]],
      ["8 Ziffern neben gültiger", [P, { ...P, value: "00000000" }]],
      ["value als Zahl", [{ ...P, value: 141903 }]],
      ["kein Array", P],
      ["Text statt Liste", "141903-1B"],
    ];
    for (const [label, praegung] of invalid) {
      expect({ label, accepted: accepted(decodeEntry({ ...ENTRY, praegung })) }).toEqual({
        label,
        accepted: false,
      });
    }
  });

  test.skip("[REQ-PRAEG-1] articleNumbers bleibt unverändert: eine Prägung als Artikelnummer wird weiter abgewiesen", () => {
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: ["141903-1B"] }))).toBe(false);
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: ["20061602"] }))).toBe(true);
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: "keineEigene" }))).toBe(true);
    expect(accepted(decodeEntry({ ...ENTRY, articleNumbers: [] }))).toBe(false);
  });

  test.skip("[REQ-PRAEG-1] Kodieren und Dekodieren eines Eintrags mit Prägung ergibt denselben Wert (Eigenschaft)", () => {
    const roundtrip = (v: CatalogEntry): CatalogEntry =>
      Schema.decodeUnknownSync(schemas.CatalogEntrySchema)(
        Schema.encodeSync(schemas.CatalogEntrySchema)(v),
      );
    const entry = { ...ENTRY, praegung: [P] };
    expect(roundtrip(entry)).toEqual(entry);
    let withPraegung = 0;
    FastCheck.assert(
      FastCheck.property(Arbitrary.make(schemas.CatalogEntrySchema), (e) => {
        if (e.praegung !== undefined) withPraegung++;
        expect(roundtrip(e)).toEqual(e);
      }),
    );
    // Kanarienvogel: der Generator erzeugt wirklich Einträge mit Prägung
    expect(withPraegung).toBeGreaterThan(0);
  });
});
