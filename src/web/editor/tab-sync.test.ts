/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md), Überarbeitung 3: Abgleich des Bestands zwischen
 * Tabs. Abnahmetests REQ-BEST-10 (dazu REQ-BEST-6 für den Lesefehler beim Abgleich).
 *
 * Schnittstelle (Typen: src/web/test-support/bestand-fixtures.ts), Modul
 * `src/web/editor/planner-session.ts`:
 *   PlannerSession.storageChanged(key: string | null): void
 *     key = geänderter Schlüssel, null = „alles geändert“ (im Browser `event.key` des
 *     `storage`-Ereignisses). Nur `carrera-planer:bestand` und null lösen einen Abgleich aus.
 *   Meldung bei kaputtem Wert: { kind: "bestandAbgleichKaputt", reason, text }.
 *
 * Wirkungsnachweis wie in der Spec: zwei Sitzungen („Tabs“) über **eine** Speicher-Attrappe, die
 * jeden Zugriff protokolliert. Das `storage`-Ereignis des Browsers wird durch den Aufruf von
 * `storageChanged` im jeweils anderen Tab nachgestellt.
 */
import { ParseResult, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import * as schemaModule from "../../schema/index.js";
import {
  anyInventoryArb,
  countIn,
  INVENTORY_DEFECT_PREFIX,
  INVENTORY_KEY,
  type Inventory,
  type InventoryDoc,
  inventoryDoc,
  loadInventory,
  loadPlannerSession,
  MACH8,
  MODE_KEY,
  normalized,
  type PlannerSession,
  type PlannerSessionApi,
  plus,
  type SetTemplate,
  STOCKABLE_IDS,
  storedCounts,
  T_AUSBAU1,
  T_MACH8,
  TEMPLATES,
} from "../test-support/bestand-fixtures.js";
import {
  CATALOG,
  type Command,
  fixedClock,
  layoutJson,
  loadEditor,
  loadSession,
  MemoryStorage,
  OVAL,
} from "../test-support/editor-fixtures.js";

const ISO = "2026-11-24T07:15:00.000Z";
const clock = fixedClock(ISO);

const open = (api: PlannerSessionApi, storage: MemoryStorage): PlannerSession =>
  api.createPlannerSession({ catalog: CATALOG, templates: TEMPLATES, storage, clock });

const choose = (partId: string): Command => ({ type: "choosePart", partId });

const writesTo = (storage: MemoryStorage, from: number): string[] =>
  storage.log.slice(from).flatMap((o) => (o.op === "set" || o.op === "remove" ? [o.key] : []));

const defectKeys = (storage: MemoryStorage): string[] =>
  [...storage.data.keys()].filter((k) => k.startsWith(INVENTORY_DEFECT_PREFIX)).sort();

const inventorySchema = (): Schema.Schema<InventoryDoc, unknown> => {
  const s = (schemaModule as unknown as { InventorySchema?: Schema.Schema<InventoryDoc, unknown> })
    .InventorySchema;
  if (s === undefined) throw new Error("src/schema exportiert InventorySchema nicht");
  return s;
};
/** Text der Schema-Prüfung für einen JSON-Text, der parst, aber InventorySchema verletzt. */
const schemaText = (raw: string): string => {
  const r = Schema.decodeUnknownEither(inventorySchema())(JSON.parse(raw));
  if (r._tag === "Right") throw new Error("Testdaten-Fehler: Bestand ist schema-gültig");
  return ParseResult.TreeFormatter.formatErrorSync(r.left);
};

const NOT_JSON = '{ "schemaVersion": 1, "counts": {';
const BROKEN: ReadonlyArray<readonly [string, string]> = [
  ["kaputt (Smoke-Fall 16)", "kaputt"],
  ["kein JSON", NOT_JSON],
  ["schemaVersion 2", JSON.stringify({ schemaVersion: 2, counts: {} })],
  ["Anzahl −1", JSON.stringify({ schemaVersion: 1, counts: { "kurve-1-90": -1 } })],
  ["Zusatzfeld", JSON.stringify({ schemaVersion: 1, counts: {}, besitzer: "Tobias" })],
  ["Anzahl als Text", JSON.stringify({ schemaVersion: 1, counts: { "kurve-1-90": "8" } })],
  ["leerer Schlüssel", JSON.stringify({ schemaVersion: 1, counts: { "": 1 } })],
];
const parses = (raw: string): boolean => {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
};

/** Ein Tab mit gültigem gespeichertem Bestand (ohne Meldungen gestartet). */
const tabWith = (
  api: PlannerSessionApi,
  storage: MemoryStorage,
  inv: Inventory,
): PlannerSession => {
  storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(inv)));
  return open(api, storage);
};

describe("Abgleich: Wirkungsnachweis der Spec", () => {
  test.skip("[REQ-BEST-10] A fügt Mach 8 hinzu, B bekommt die Meldung und erhöht Gerade 342: alle 27 Mach-8-Teile, Gerade 342 mit 5; B schreibt zwischen Meldung und Zähleränderung nichts", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const a = open(api, storage);
    const b = open(api, storage);
    a.addSet(T_MACH8.id, true);
    expect(storedCounts(storage.data)).toEqual(normalized(MACH8));
    const messagesBefore = b.messages.length;

    const mark = storage.log.length;
    b.storageChanged(INVENTORY_KEY);
    expect(writesTo(storage, mark)).toEqual([]);
    expect(normalized(b.inventory)).toEqual(normalized(MACH8));
    // gültiger Abgleich: keine Meldung
    expect(b.messages).toHaveLength(messagesBefore);

    b.increment("gerade-342");
    const expected = normalized({ ...MACH8, "gerade-342": 5 });
    expect(storedCounts(storage.data)).toEqual(expected);
    expect(Object.values(storedCounts(storage.data) ?? {}).reduce((s, n) => s + n, 0)).toBe(28);
    // und A sieht nach eigener Meldung denselben Stand
    a.storageChanged(INVENTORY_KEY);
    expect(normalized(a.inventory)).toEqual(expected);
    expect(normalized(open(api, storage).inventory)).toEqual(expected);
  });

  test.skip("[REQ-BEST-10] Gegenprobe ohne Meldung: B überschreibt den Bestand von A (das veraltete Tab, das der Abgleich schließt)", async () => {
    // Diese Probe prüft die Testkonstruktion: ohne storageChanged gewinnt der letzte Schreiber.
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const a = open(api, storage);
    const b = open(api, storage);
    a.addSet(T_MACH8.id, true);
    b.increment("gerade-342");
    expect(storedCounts(storage.data)).toEqual({ "gerade-342": 1 });
  });
});

describe("Abgleich: gültiger Wert", () => {
  test.skip("[REQ-BEST-10] gültiger Wert ersetzt den Bestand der Seite vollständig, ohne Meldung, ohne Schreiben", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, { "kurve-1-90": 8, "gerade-171": 2 });
    expect(b.messages).toEqual([]);
    // ein anderes Tab schreibt einen Bestand ohne Kurve und Gerade 171
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc({ "gerade-342": 3 })));
    const mark = storage.log.length;
    b.storageChanged(INVENTORY_KEY);
    expect(normalized(b.inventory)).toEqual({ "gerade-342": 3 });
    expect(countIn(b.inventory, "kurve-1-90")).toBe(0);
    expect(b.messages).toEqual([]);
    expect(writesTo(storage, mark)).toEqual([]);
    // der Wert wird aus dem Speicher gelesen (nicht aus dem Ereignis)
    expect(storage.log.slice(mark).some((o) => o.op === "get" && o.key === INVENTORY_KEY)).toBe(
      true,
    );
  });

  test.skip("[REQ-BEST-10] null heißt „alles geändert“ und gleicht den Bestand ab", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, { "kurve-1-90": 8 });
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(MACH8)));
    const mark = storage.log.length;
    b.storageChanged(null);
    expect(normalized(b.inventory)).toEqual(normalized(MACH8));
    expect(b.messages).toEqual([]);
    expect(writesTo(storage, mark)).toEqual([]);
  });

  test.skip("[REQ-BEST-10] Einträge nach REQ-BEST-7 gelten mit; gemeldet werden nur neue nicht zählende IDs mit Anzahl ≥ 1", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const start = { "kurve-1-90": 2, "gibt-es-nicht": 3 };
    const b = tabWith(api, storage, start);
    const startMessages = b.messages.length; // REQ-BEST-7 beim Start: gibt-es-nicht
    expect(b.messages.filter((m) => m.kind === "bestandIgnoriert")).toHaveLength(1);

    // nur bereits bekannte nicht zählende ID: keine Meldung
    const same = { "gerade-342": 1, "gibt-es-nicht": 3 };
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(same)));
    b.storageChanged(INVENTORY_KEY);
    expect(normalized(b.inventory)).toEqual(normalized(same));
    expect(b.messages).toHaveLength(startMessages);

    // neue Baugruppen-ID mit Anzahl ≥ 1 und neue unbekannte ID mit Anzahl 0
    const next = { "gerade-342": 1, "gibt-es-nicht": 3, steilkehre: 2, "kurve-9-90": 0 };
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(next)));
    b.storageChanged(INVENTORY_KEY);
    expect(normalized(b.inventory)).toEqual(normalized(next));
    expect(countIn(b.inventory, "steilkehre")).toBe(2);
    expect(b.messages).toHaveLength(startMessages + 1);
    const m = b.messages.at(-1);
    expect(m?.kind).toBe("bestandIgnoriert");
    if (m?.kind === "bestandIgnoriert") {
      expect(m.partIds).toEqual(["steilkehre"]);
      expect(m.text).toContain("steilkehre");
      expect(m.text).not.toContain("gibt-es-nicht");
      expect(m.text).not.toContain("kurve-9-90");
    }
    // beim nächsten Sichern unverändert mitgeschrieben
    b.increment("gerade-342");
    expect(storedCounts(storage.data)).toEqual({
      "gerade-342": 2,
      "gibt-es-nicht": 3,
      steilkehre: 2,
    });
    const raw = JSON.parse(storage.data.get(INVENTORY_KEY) as string) as InventoryDoc;
    expect(Object.hasOwn(raw.counts, "kurve-9-90")).toBe(true);
    expect(raw.counts["kurve-9-90"]).toBe(0);
  });

  test.skip("[REQ-BEST-10] Eigenschaft: jeder gültige gespeicherte Bestand wird exakt übernommen, ohne Schreiben und ohne Meldung außer REQ-BEST-7", async () => {
    const api = await loadPlannerSession();
    fc.assert(
      fc.property(anyInventoryArb, anyInventoryArb, (before, after) => {
        const storage = new MemoryStorage();
        const b = tabWith(api, storage, before);
        const n = b.messages.length;
        storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(after)));
        const mark = storage.log.length;
        b.storageChanged(INVENTORY_KEY);
        expect(normalized(b.inventory)).toEqual(normalized(after));
        expect(writesTo(storage, mark)).toEqual([]);
        const added = b.messages.slice(n);
        expect(added.every((m) => m.kind === "bestandIgnoriert")).toBe(true);
        expect(added.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 150 },
    );
  });
});

describe("Abgleich: Schlüssel fehlt", () => {
  test.skip("[REQ-BEST-10] Schlüssel in einem anderen Tab gelöscht: Bestand leer, ohne Meldung, ohne Schreiben", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, { ...MACH8, "gibt-es-nicht": 3 });
    const n = b.messages.length;
    storage.data.delete(INVENTORY_KEY);
    for (const key of [INVENTORY_KEY, null]) {
      const mark = storage.log.length;
      b.storageChanged(key);
      expect(normalized(b.inventory)).toEqual({});
      expect(b.messages).toHaveLength(n);
      expect(writesTo(storage, mark)).toEqual([]);
      expect(storage.data.has(INVENTORY_KEY)).toBe(false);
    }
    // danach normales Sichern
    b.increment("gerade-342");
    expect(storedCounts(storage.data)).toEqual({ "gerade-342": 1 });
  });
});

describe("Abgleich: kaputter Wert", () => {
  test.skip("[REQ-BEST-10] kaputter Wert: Bestand der Seite bleibt, Meldung mit Grund, nicht verschoben, kein Schreiben", async () => {
    const api = await loadPlannerSession();
    for (const [label, raw] of BROKEN) {
      const storage = new MemoryStorage();
      const own = { ...MACH8, "gibt-es-nicht": 3 };
      const b = tabWith(api, storage, own);
      const n = b.messages.length;
      storage.data.set(INVENTORY_KEY, raw);
      const mark = storage.log.length;
      expect(() => b.storageChanged(INVENTORY_KEY), label).not.toThrow();
      expect(normalized(b.inventory), label).toEqual(normalized(own));
      expect(writesTo(storage, mark), label).toEqual([]);
      expect(storage.data.get(INVENTORY_KEY), label).toBe(raw);
      expect(defectKeys(storage), label).toEqual([]);
      expect(b.messages.length, label).toBe(n + 1);
      const m = b.messages.at(-1);
      expect(m?.kind, label).toBe("bestandAbgleichKaputt");
      if (m?.kind !== "bestandAbgleichKaputt") continue;
      expect(m.reason.length, label).toBeGreaterThan(0);
      expect(m.text.length, label).toBeGreaterThan(0);
      if (parses(raw)) expect(m.reason, label).toContain(schemaText(raw));
      expect(
        b.messages.some((x) => x.kind === "bestandVerschoben"),
        label,
      ).toBe(false);
    }
  });

  test.skip("[REQ-BEST-10] nach kaputtem Wert schreibt keine Bestandsänderung in dieser Sitzung; Änderungen leben nur im Speicher der Seite", async () => {
    const api = await loadPlannerSession();
    for (const [label, raw] of BROKEN) {
      const storage = new MemoryStorage();
      const b = tabWith(api, storage, MACH8);
      storage.data.set(INVENTORY_KEY, raw);
      b.storageChanged(INVENTORY_KEY);
      const mark = storage.log.length;
      expect(() => {
        b.increment("gerade-342");
        b.setCount("kurve-1-90", "3");
        b.decrement("gerade-114");
        b.addSet(T_AUSBAU1.id, true);
      }, label).not.toThrow();
      const expected = normalized(
        plus(
          { ...MACH8, "gerade-342": 5, "kurve-1-90": 3, "gerade-114": 0 },
          {
            "kurve-1-90": 2,
            "spurwechsel-gerade": 2,
            "gerade-342": 2,
          },
        ),
      );
      expect(normalized(b.inventory), label).toEqual(expected);
      b.clearInventory(true);
      expect(normalized(b.inventory), label).toEqual({});
      b.increment("gerade-171");
      expect(normalized(b.inventory), label).toEqual({ "gerade-171": 1 });
      const writes = writesTo(storage, mark);
      expect(writes, label).not.toContain(INVENTORY_KEY);
      expect(
        writes.some((k) => k.startsWith(INVENTORY_DEFECT_PREFIX)),
        label,
      ).toBe(false);
      expect(storage.data.get(INVENTORY_KEY), label).toBe(raw);
      expect(defectKeys(storage), label).toEqual([]);
    }
  });

  test.skip("[REQ-BEST-10] verschoben wird erst beim nächsten Start (REQ-BEST-5), genau einmal", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, MACH8);
    const c = tabWith(api, storage, MACH8);
    storage.data.set(INVENTORY_KEY, "kaputt");
    // jedes offene Tab bekommt das Ereignis; keines verschiebt
    b.storageChanged(INVENTORY_KEY);
    c.storageChanged(INVENTORY_KEY);
    b.storageChanged(INVENTORY_KEY);
    expect(defectKeys(storage)).toEqual([]);
    b.increment("gerade-342");
    expect(storage.data.get(INVENTORY_KEY)).toBe("kaputt");
    // Neuladen von B: Verschieben nach REQ-BEST-5
    const reloaded = open(api, storage);
    expect(defectKeys(storage)).toEqual([`${INVENTORY_DEFECT_PREFIX}${ISO}`]);
    expect(storage.data.get(`${INVENTORY_DEFECT_PREFIX}${ISO}`)).toBe("kaputt");
    expect(reloaded.messages.some((m) => m.kind === "bestandVerschoben")).toBe(true);
    expect(normalized(reloaded.inventory)).toEqual({});
  });
});

describe("Abgleich: Schreibschutz endet", () => {
  test.skip("[REQ-BEST-10] nach kaputtem Wert hebt ein gültiger Abgleich den Schreibschutz auf", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, MACH8);
    storage.data.set(INVENTORY_KEY, "kaputt");
    b.storageChanged(INVENTORY_KEY);
    b.increment("gerade-114"); // nur im Speicher der Seite
    expect(storage.data.get(INVENTORY_KEY)).toBe("kaputt");
    // ein anderes Tab startet, verschiebt und schreibt den leeren Bestand, dann eine Änderung
    const a = open(api, storage);
    a.increment("kurve-1-45");
    b.storageChanged(INVENTORY_KEY);
    expect(normalized(b.inventory)).toEqual({ "kurve-1-45": 1 });
    b.increment("gerade-342");
    expect(storedCounts(storage.data)).toEqual({ "gerade-342": 1, "kurve-1-45": 1 });
  });

  test.skip("[REQ-BEST-10] Start mit gescheitertem Verschieben (REQ-BEST-5): ein gültiger Abgleich hebt den Schreibschutz auf", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({ [INVENTORY_KEY]: NOT_JSON });
    storage.fail = (op, key) => op === "set" && key.startsWith(INVENTORY_DEFECT_PREFIX);
    const b = open(api, storage);
    expect(b.messages.some((m) => m.kind === "bestandNichtVerschoben")).toBe(true);
    storage.fail = () => false;
    b.increment("gerade-114");
    expect(storage.data.get(INVENTORY_KEY)).toBe(NOT_JSON);
    // ein anderes Tab repariert den Wert
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(MACH8)));
    const n = b.messages.length;
    b.storageChanged(INVENTORY_KEY);
    expect(normalized(b.inventory)).toEqual(normalized(MACH8));
    expect(b.messages).toHaveLength(n);
    b.increment("gerade-342");
    expect(storedCounts(storage.data)).toEqual(normalized({ ...MACH8, "gerade-342": 5 }));
  });
});

describe("Abgleich: andere Schlüssel", () => {
  test.skip("[REQ-BEST-10] Layouts, Arbeitsstand, carrera-planer:modus, Ausweichschlüssel und fremde Schlüssel lösen keinen Abgleich aus", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, MACH8);
    expect(b.mode).toBe("sandbox");
    // der Speicher ändert sich in allen Schlüsseln gleichzeitig
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc({ "gerade-171": 9 })));
    storage.data.set(MODE_KEY, "bestand");
    storage.data.set(m2.WORKING_KEY, JSON.stringify(layoutJson(OVAL)));
    storage.data.set(m2.layoutKey("Oval"), JSON.stringify(layoutJson(OVAL)));
    storage.data.set(`${INVENTORY_DEFECT_PREFIX}${ISO}`, "kaputt");
    const n = b.messages.length;
    const mark = storage.log.length;
    for (const key of [
      MODE_KEY,
      m2.WORKING_KEY,
      m2.layoutKey("Oval"),
      `${INVENTORY_DEFECT_PREFIX}${ISO}`,
      `${INVENTORY_KEY}:x`,
      "carrera-planer",
      "fremd",
      "",
    ]) {
      b.storageChanged(key);
      expect({ key, inv: normalized(b.inventory) }).toEqual({ key, inv: normalized(MACH8) });
      expect({ key, mode: b.mode }).toEqual({ key, mode: "sandbox" });
      expect({ key, elements: b.state.elements }).toEqual({ key, elements: [] });
    }
    expect(b.messages).toHaveLength(n);
    expect(writesTo(storage, mark)).toEqual([]);
    // erst die Meldung des Bestandsschlüssels gleicht ab
    b.storageChanged(INVENTORY_KEY);
    expect(normalized(b.inventory)).toEqual({ "gerade-171": 9 });
    expect(b.mode).toBe("sandbox");
  });

  test.skip("[REQ-BEST-10] kaputter Wert unter carrera-planer:modus mit Meldung des Modus-Schlüssels: keine Modus-Meldung, Modus bleibt", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = open(api, storage);
    b.setMode("bestand");
    const n = b.messages.length;
    for (const value of ["kaputt", "sandbox"]) {
      storage.data.set(MODE_KEY, value);
      b.storageChanged(MODE_KEY);
      b.storageChanged(null);
      expect(b.mode).toBe("bestand");
      expect(b.messages).toHaveLength(n);
    }
  });
});

describe("Abgleich: Strecke, Verlauf und Modus bleiben; Rest, Sperre, Leiste und Einkaufsliste folgen", () => {
  test.skip("[REQ-BEST-10] Folge, Verlauf, Auswahl, Aktion, Leistenrichtung, Name und Modus unverändert; kein Verlaufseintrag; nichts geschrieben", async () => {
    const api = await loadPlannerSession();
    const E = await loadEditor();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, MACH8);
    b.setMode("bestand");
    b.dispatch({ type: "load", elements: OVAL });
    expect(b.saveAs("Oval")).toEqual({ ok: true });
    b.dispatch({ type: "togglePaletteTurn" });
    b.dispatch({ type: "select", id: "o3" });
    b.dispatch({ type: "setAction", action: "davorEinfuegen" });
    const before = b.state;
    for (const [key, inv] of [
      [INVENTORY_KEY, { "gerade-342": 1 }],
      [null, plus(MACH8, MACH8)],
      [INVENTORY_KEY, {}],
    ] as const) {
      storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc(inv)));
      const mark = storage.log.length;
      b.storageChanged(key);
      expect(normalized(b.inventory)).toEqual(normalized(inv));
      expect(writesTo(storage, mark)).toEqual([]);
      expect(b.state.elements).toEqual(before.elements);
      expect(b.state.selection).toBe("o3");
      expect(b.state.action).toBe("davorEinfuegen");
      expect(b.state.paletteTurn).toBe(before.paletteTurn);
      expect(E.canUndo(b.state)).toBe(true);
      expect(E.canRedo(b.state)).toBe(false);
      expect(b.name).toBe("Oval");
      expect(b.mode).toBe("bestand");
    }
    // kein Verlaufseintrag: ein Rückgängig nimmt das Laden zurück, Wiederholen bringt es wieder
    b.dispatch({ type: "undo" });
    expect(b.state.elements).toEqual([]);
    expect(E.canUndo(b.state)).toBe(false);
    b.dispatch({ type: "redo" });
    expect(b.state.elements).toEqual(OVAL);
  });

  test.skip("[REQ-BEST-10] Smoke-Fall 16 als Logik: Oval im Modus „Bestand“, A setzt Kurve 1/90° auf 3 → Rest −1 gesperrt, „fehlt 1 Teil“, Strecke bleibt, weitere Kurve abgewiesen", async () => {
    const api = await loadPlannerSession();
    const I = await loadInventory();
    const storage = new MemoryStorage();
    const a = open(api, storage);
    const b = open(api, storage);
    a.addSet(T_MACH8.id, true);
    b.storageChanged(INVENTORY_KEY);
    b.setMode("bestand");
    b.dispatch({ type: "load", elements: OVAL });
    const palette = () => I.stockPalette(CATALOG, b.inventory, b.state.elements);
    const entry = (id: string) => palette().find((e) => e.partId === id);
    const short = () => I.shoppingShort(I.shoppingList(CATALOG, b.inventory, b.state.elements));
    expect(entry("kurve-1-90")).toMatchObject({ stock: 6, rest: 2, locked: false });
    expect(short()).toBe("Bestand reicht");

    a.setCount("kurve-1-90", "3");
    b.storageChanged(INVENTORY_KEY);
    expect(b.state.elements).toEqual(OVAL);
    expect(entry("kurve-1-90")).toMatchObject({ stock: 3, rest: -1, locked: true });
    expect(entry("gerade-342")).toMatchObject({ stock: 4, rest: 2, locked: false });
    expect(short()).toBe("fehlt 1 Teil");
    const list = I.shoppingList(CATALOG, b.inventory, b.state.elements);
    expect(list.ok && list.rows.map((r) => [r.partId, r.needed, r.have, r.missing])).toEqual([
      ["kurve-1-90", 4, 3, 1],
    ]);

    // die Sperre der Sitzung folgt dem neuen Bestand
    const n = b.messages.length;
    b.dispatch(choose("kurve-1-90"));
    expect(b.state.elements).toEqual(OVAL);
    expect(b.messages.at(-1)?.kind).toBe("befehlAbgewiesen");
    b.dispatch(choose("gerade-342"));
    expect(b.state.elements).toHaveLength(7);
    expect(b.messages.filter((m) => m.kind === "befehlAbgewiesen")).toHaveLength(
      b.messages.slice(0, n).filter((m) => m.kind === "befehlAbgewiesen").length + 1,
    );
  });

  test.skip("[REQ-BEST-10] Sperre folgt auch nach oben: leerer Bestand im Modus „Bestand“, A fügt Mach 8 hinzu → B kann anhängen", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const a = open(api, storage);
    const b = open(api, storage);
    b.setMode("bestand");
    b.dispatch(choose("gerade-342"));
    expect(b.state.elements).toEqual([]);
    a.addSet(T_MACH8.id, true);
    b.storageChanged(INVENTORY_KEY);
    for (let i = 0; i < 5; i++) b.dispatch(choose("gerade-342"));
    expect(b.state.elements).toHaveLength(4);
    // A senkt Gerade 342 auf 2: B behält 4 (Überzug angezeigt, nicht verhindert), Löschen wirkt
    a.setCount("gerade-342", "2");
    b.storageChanged(null);
    expect(b.state.elements).toHaveLength(4);
    const id = b.state.elements[3]?.id as string;
    b.dispatch({ type: "select", id });
    b.dispatch({ type: "deleteSelected" });
    expect(b.state.elements).toHaveLength(3);
  });
});

describe("Abgleich: zwei Tabs bleiben gleich", () => {
  test.skip("[REQ-BEST-10] Eigenschaft: beliebige Bestandsänderungen abwechselnd in A und B, jeweils mit Meldung an das andere Tab → beide Tabs und Speicher stimmen überein, keine Änderung geht verloren", async () => {
    const api = await loadPlannerSession();
    type Op =
      | { readonly tab: 0 | 1; readonly t: "set"; readonly id: string; readonly n: number }
      | { readonly tab: 0 | 1; readonly t: "inc" | "dec"; readonly id: string }
      | { readonly tab: 0 | 1; readonly t: "vorlage"; readonly k: number }
      | { readonly tab: 0 | 1; readonly t: "leeren" };
    const tab = fc.constantFrom<0 | 1>(0, 1);
    const id = fc.constantFrom(...STOCKABLE_IDS);
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ tab, t: fc.constant("set" as const), id, n: fc.nat({ max: 20 }) }),
      fc.record({ tab, t: fc.constantFrom("inc" as const, "dec" as const), id }),
      fc.record({ tab, t: fc.constant("vorlage" as const), k: fc.nat({ max: 3 }) }),
      fc.record({ tab, t: fc.constant("leeren" as const) }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 20 }), (ops) => {
        const storage = new MemoryStorage();
        const tabs = [open(api, storage), open(api, storage)] as const;
        // Orakel: ein einziger Bestand, auf den jede Änderung wirkt
        let oracle: Record<string, number> = {};
        for (const op of ops) {
          const s = tabs[op.tab];
          const other = tabs[op.tab === 0 ? 1 : 0];
          if (op.t === "set") {
            s.setCount(op.id, String(op.n));
            oracle = { ...oracle, [op.id]: op.n };
          } else if (op.t === "inc") {
            s.increment(op.id);
            oracle = { ...oracle, [op.id]: (oracle[op.id] ?? 0) + 1 };
          } else if (op.t === "dec") {
            s.decrement(op.id);
            oracle = { ...oracle, [op.id]: Math.max(0, (oracle[op.id] ?? 0) - 1) };
          } else if (op.t === "vorlage") {
            const t = TEMPLATES[op.k] as SetTemplate;
            s.addSet(t.id, true);
            for (const c of t.contents)
              oracle = { ...oracle, [c.part]: (oracle[c.part] ?? 0) + c.count };
          } else {
            s.clearInventory(true);
            oracle = {};
          }
          const mark = storage.log.length;
          other.storageChanged(INVENTORY_KEY);
          expect(writesTo(storage, mark)).toEqual([]);
          expect(storedCounts(storage.data) ?? {}).toEqual(normalized(oracle));
          expect(normalized(tabs[0].inventory)).toEqual(normalized(oracle));
          expect(normalized(tabs[1].inventory)).toEqual(normalized(oracle));
        }
        expect(tabs[0].messages).toEqual([]);
        expect(tabs[1].messages).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });
});

describe("Abgleich: Speicher wirft beim Lesen", () => {
  test.skip("[REQ-BEST-6] Speicher wirft beim Lesen im Abgleich: Meldung speicherFehler, Bestand der Seite bleibt, keine Ausnahme", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const b = tabWith(api, storage, MACH8);
    storage.data.set(INVENTORY_KEY, JSON.stringify(inventoryDoc({ "gerade-171": 9 })));
    storage.fail = (op, key) => op === "get" && key === INVENTORY_KEY;
    const n = b.messages.length;
    expect(() => b.storageChanged(INVENTORY_KEY)).not.toThrow();
    expect(normalized(b.inventory)).toEqual(normalized(MACH8));
    expect(b.messages.length).toBeGreaterThan(n);
    expect(b.messages.at(-1)?.kind).toBe("speicherFehler");
    storage.fail = () => false;
    b.increment("gerade-342");
    expect(countIn(b.inventory, "gerade-342")).toBe(5);
  });
});
