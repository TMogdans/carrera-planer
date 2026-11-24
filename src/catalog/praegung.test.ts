/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Prägungen im Katalog. Abnahmetests REQ-PRAEG-2
 * und REQ-PRAEG-3.
 *
 * Feld `praegung` am Katalogeintrag (REQ-PRAEG-1): optionale, nicht leere Liste aus
 * { value, source, certainty }. Die Prüfung aus REQ-PRAEG-3 steht hier im Test
 * (`duplicatePraegungen`); ihr Wirkungsnachweis mit verändertem Katalog zeigt, dass sie greift.
 * Die M1-Katalogtests (catalog.test.ts) bleiben unverändert.
 */
import { Either, Schema } from "effect";
import { describe, expect, test } from "vitest";
import * as schemaModule from "../schema/index.js";
import * as catalogModule from "./index.js";

type Praegung = {
  readonly value: string;
  readonly source: string;
  readonly certainty: "hoch" | "mittel" | "niedrig";
};
type CatalogEntry = {
  readonly id: string;
  readonly praegung?: ReadonlyArray<Praegung>;
};

const cat = (): ReadonlyArray<CatalogEntry> =>
  (catalogModule as unknown as { readonly CATALOG: ReadonlyArray<CatalogEntry> }).CATALOG;
const schemaApi = schemaModule as unknown as {
  readonly CatalogEntrySchema: Schema.Schema<CatalogEntry, unknown>;
};

/** Tabelle „Prägungen M3a“: Eintrag → [Wert, Sicherheit, Teil der Quelle]. */
const EXPECTED: Readonly<Record<string, readonly [string, string, string]>> = {
  "steilkehre-teil": ["141903-1B", "niedrig", "gokarli.de"],
  "gerade-342": ["142202-1", "niedrig", "Kleinanzeigen"],
};

/** Prüfung aus REQ-PRAEG-3: Prägungswerte, die mehr als einen Eintrag benennen. */
const duplicatePraegungen = (catalog: ReadonlyArray<CatalogEntry>): string[] => {
  const owners = new Map<string, Set<string>>();
  for (const e of catalog) {
    for (const p of e.praegung ?? []) {
      owners.set(p.value, (owners.get(p.value) ?? new Set()).add(e.id));
    }
  }
  return [...owners].filter(([, ids]) => ids.size > 1).map(([value]) => value);
};

describe("Prägungen", () => {
  test.skip("[REQ-PRAEG-2] genau die Prägungen der Tabelle; alle anderen Einträge ohne Feld praegung", () => {
    const withField = cat()
      .filter((e) => "praegung" in e)
      .map((e) => e.id)
      .sort();
    expect(withField).toEqual(Object.keys(EXPECTED).sort());
    for (const [id, [value, certainty, sourcePart]] of Object.entries(EXPECTED)) {
      const e = cat().find((x) => x.id === id);
      expect(e?.praegung?.map((p) => [p.value, p.certainty])).toEqual([[value, certainty]]);
      expect(e?.praegung?.[0]?.source).toContain(sourcePart);
    }
    // nicht das Looping-Teil (L): ob K und L baugleich sind, ist offen (#28)
    expect("praegung" in (cat().find((e) => e.id === "looping-teil") ?? {})).toBe(false);
  });

  test.skip("[REQ-PRAEG-2] Katalog mit Prägungen besteht weiter das Katalog-Schema", () => {
    for (const e of cat()) {
      const r = Schema.decodeUnknownEither(schemaApi.CatalogEntrySchema)(e);
      expect({ id: e.id, valid: Either.isRight(r) }).toEqual({ id: e.id, valid: true });
      if (Either.isRight(r)) expect(r.right).toEqual(e);
    }
  });

  test.skip("[REQ-PRAEG-3] Prägungswerte sind über den ganzen Katalog eindeutig", () => {
    expect(duplicatePraegungen(cat())).toEqual([]);
  });

  test.skip("[REQ-PRAEG-3] Wirkungsnachweis: bekommt das Looping-Teil (L) ebenfalls 141903-1B, schlägt die Prüfung fehl", () => {
    const changed = cat().map(
      (e): CatalogEntry =>
        e.id === "looping-teil"
          ? { ...e, praegung: [{ value: "141903-1B", source: "Test", certainty: "niedrig" }] }
          : e,
    );
    expect(duplicatePraegungen(changed)).toEqual(["141903-1B"]);
  });
});
