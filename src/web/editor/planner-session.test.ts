/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Sitzung mit Bestand und Modus. Abnahmetests
 * REQ-BEST-2 bis REQ-BEST-9 (Sitzungsteil), REQ-SET-4, REQ-MODUS-1 bis -4 (Sitzungsteil),
 * REQ-EINK-5 (Sitzungsteil).
 *
 * Schnittstelle (Typen: src/web/test-support/bestand-fixtures.ts), Modul
 * `src/web/editor/planner-session.ts`:
 *   createPlannerSession({ catalog, templates, storage, clock }): PlannerSession
 *     alles der M2-Sitzung (dispatch, saveAs, load, importFile, …) plus
 *     mode, inventory (Getter), setMode, setCount, increment, decrement,
 *     addSet(templateId, confirmed), clearInventory(confirmed),
 *     inventoryDefectBackups(), inventoryDefectRawText(key), deleteInventoryDefect(key)
 *   Fehler landen als Meldung in `messages`, nie als Ausnahme.
 * Schlüssel (Spec): `carrera-planer:bestand`, `carrera-planer:bestand:defekt:<ISO-UTC>[-n]`,
 * `carrera-planer:modus`. Der gespeicherte Wert des Modus ist frei; geprüft wird über Neustart.
 */
import { ParseResult, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import * as schemaModule from "../../schema/index.js";
import {
  ASSEMBLY_IDS,
  AUSBAU1,
  AUSBAU3,
  countIn,
  INVENTORY_DEFECT_PREFIX,
  INVENTORY_KEY,
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
  SUMME3,
  storedCounts,
  T_AUSBAU1,
  T_AUSBAU3,
  T_MACH8,
  TEMPLATES,
} from "../test-support/bestand-fixtures.js";
import {
  ACHT,
  CATALOG,
  type Command,
  fixedClock,
  layoutJson,
  loadEditor,
  loadSession,
  MemoryStorage,
  OVAL,
  UNKNOWN_ID,
} from "../test-support/editor-fixtures.js";

const ISO = "2026-11-24T07:15:00.000Z";
const clock = fixedClock(ISO);

const open = (
  api: PlannerSessionApi,
  storage: MemoryStorage,
  templates: ReadonlyArray<SetTemplate> = TEMPLATES,
): PlannerSession => api.createPlannerSession({ catalog: CATALOG, templates, storage, clock });

const choose = (partId: string): Command => ({ type: "choosePart", partId });

const inventorySchema = (): Schema.Schema<InventoryDoc, unknown> => {
  const s = (schemaModule as unknown as { InventorySchema?: Schema.Schema<InventoryDoc, unknown> })
    .InventorySchema;
  if (s === undefined) throw new Error("src/schema exportiert InventorySchema nicht");
  return s;
};
/** Text der Schema-Prüfung für einen JSON-Text, der parst, aber InventorySchema verletzt. */
const inventoryReason = (raw: string): string => {
  const r = Schema.decodeUnknownEither(inventorySchema())(JSON.parse(raw));
  if (r._tag === "Right") throw new Error("Testdaten-Fehler: Bestand ist schema-gültig");
  return ParseResult.TreeFormatter.formatErrorSync(r.left);
};

const writesTo = (storage: MemoryStorage, from: number): string[] =>
  storage.log.slice(from).flatMap((o) => (o.op === "set" || o.op === "remove" ? [o.key] : []));

const NOT_JSON = '{ "schemaVersion": 1, "counts": {';
const BROKEN: ReadonlyArray<readonly [string, string]> = [
  ["kein JSON", NOT_JSON],
  ["schemaVersion 2", JSON.stringify({ schemaVersion: 2, counts: {} })],
  ["Anzahl −1", JSON.stringify({ schemaVersion: 1, counts: { "kurve-1-90": -1 } })],
  ["Zusatzfeld", JSON.stringify({ schemaVersion: 1, counts: {}, besitzer: "Tobias" })],
  ["Anzahl als Text", JSON.stringify({ schemaVersion: 1, counts: { "kurve-1-90": "8" } })],
  ["leerer Schlüssel", JSON.stringify({ schemaVersion: 1, counts: { "": 1 } })],
];

describe("Bestand speichern und laden", () => {
  test("[REQ-BEST-3] Start ohne Schlüssel: leerer Bestand, keine Meldung, nichts geschrieben", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    expect(normalized(s.inventory)).toEqual({});
    expect(s.messages).toEqual([]);
    expect(writesTo(storage, 0)).not.toContain(INVENTORY_KEY);
    expect(storage.data.has(INVENTORY_KEY)).toBe(false);
  });

  test("[REQ-BEST-3] nach jeder wirksamen Änderung sofort unter carrera-planer:bestand das kodierte Bestandsdokument", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    const expectStored = (counts: Record<string, number>): void => {
      const raw = storage.data.get(INVENTORY_KEY);
      expect(raw).toBeDefined();
      const doc = JSON.parse(raw as string) as InventoryDoc;
      expect(Object.keys(doc).sort()).toEqual(["counts", "schemaVersion"]);
      expect(doc.schemaVersion).toBe(1);
      expect(Schema.decodeUnknownEither(inventorySchema())(doc)._tag).toBe("Right");
      expect(normalized(doc.counts)).toEqual(counts);
      expect(normalized(s.inventory)).toEqual(counts);
    };
    s.setCount("kurve-1-90", "8");
    expectStored({ "kurve-1-90": 8 });
    s.decrement("kurve-1-90");
    expectStored({ "kurve-1-90": 7 });
    s.increment("gerade-342");
    expectStored({ "gerade-342": 1, "kurve-1-90": 7 });
    s.addSet(T_AUSBAU3.id, true);
    expectStored(normalized(plus({ "gerade-342": 1, "kurve-1-90": 7 }, AUSBAU3)));
    s.setCount("kurve-1-90", "0");
    expectStored(normalized(plus({ "gerade-342": 1 }, AUSBAU3)));
    s.clearInventory(true);
    expectStored({});
  });

  test("[REQ-BEST-3] Start lädt den gespeicherten Bestand", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({
      [INVENTORY_KEY]: JSON.stringify(inventoryDoc({ ...MACH8, "gerade-171": 0 })),
    });
    const s = open(api, storage);
    expect(normalized(s.inventory)).toEqual(normalized(MACH8));
    expect(s.messages).toEqual([]);
  });

  test("[REQ-BEST-4] Eigenschaft: Sichern und Laden in neuer Sitzung ergibt exakt dieselben Anzahlen", async () => {
    const api = await loadPlannerSession();
    type Op =
      | { readonly t: "set"; readonly id: string; readonly input: string }
      | { readonly t: "inc" | "dec"; readonly id: string }
      | { readonly t: "set-vorlage"; readonly n: number }
      | { readonly t: "leeren" };
    const ids = [...STOCKABLE_IDS, ...ASSEMBLY_IDS, UNKNOWN_ID];
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        t: fc.constant("set" as const),
        id: fc.constantFrom(...ids),
        input: fc.oneof(fc.nat({ max: 40 }).map(String), fc.constantFrom("-1", "2,5", "", "x")),
      }),
      fc.record({
        t: fc.constantFrom("inc" as const, "dec" as const),
        id: fc.constantFrom(...ids),
      }),
      fc.record({ t: fc.constant("set-vorlage" as const), n: fc.nat({ max: 3 }) }),
      fc.constant<Op>({ t: "leeren" }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const storage = new MemoryStorage();
        const s = open(api, storage);
        for (const op of ops) {
          if (op.t === "set") s.setCount(op.id, op.input);
          else if (op.t === "inc") s.increment(op.id);
          else if (op.t === "dec") s.decrement(op.id);
          else if (op.t === "set-vorlage") s.addSet((TEMPLATES[op.n] as SetTemplate).id, true);
          else s.clearInventory(true);
        }
        const again = open(api, storage);
        expect(normalized(again.inventory)).toEqual(normalized(s.inventory));
        expect(storedCounts(storage.data) ?? {}).toEqual(normalized(s.inventory));
      }),
      { numRuns: 150 },
    );
  });
});

describe("Kaputter Bestand", () => {
  test("[REQ-BEST-5] Rohtext unverändert unter Ausweichschlüssel mit UTC-Zeitstempel, leerer Bestand, Meldung mit Schlüssel und Grund", async () => {
    const api = await loadPlannerSession();
    const backupKey = `${INVENTORY_DEFECT_PREFIX}${ISO}`;
    for (const [label, raw] of BROKEN) {
      const storage = new MemoryStorage({ [INVENTORY_KEY]: raw });
      const s = open(api, storage);
      expect(storage.data.get(backupKey), label).toBe(raw);
      expect(normalized(s.inventory), label).toEqual({});
      const m = s.messages.find((x) => x.kind === "bestandVerschoben");
      expect(m, label).toBeDefined();
      if (m?.kind !== "bestandVerschoben") continue;
      expect(m.backupKey).toBe(backupKey);
      expect(m.text).toContain(backupKey);
      expect(m.reason.length).toBeGreaterThan(0);
      if (raw !== NOT_JSON) expect(m.reason, label).toContain(inventoryReason(raw));
      // erst Ausweichschlüssel geschrieben, danach sofort der leere Bestand (Überarbeitung 2)
      const writes = writesTo(storage, 0);
      const backupAt = writes.indexOf(backupKey);
      const inventoryAt = writes.indexOf(INVENTORY_KEY);
      expect(backupAt, label).toBeGreaterThanOrEqual(0);
      expect(inventoryAt, label).toBeGreaterThan(backupAt);
      expect(storedCounts(storage.data), label).toEqual({});
      // danach normales Sichern
      s.increment("gerade-342");
      expect(storedCounts(storage.data)).toEqual({ "gerade-342": 1 });
      expect(storage.data.get(backupKey)).toBe(raw);
    }
  });

  test("[REQ-BEST-5] ein Fund wird nur einmal verschoben: sofort leerer Bestand gespeichert, spätere Starts legen keinen weiteren Ausweichschlüssel an", async () => {
    const api = await loadPlannerSession();
    const defectKeys = (storage: MemoryStorage): string[] =>
      [...storage.data.keys()].filter((k) => k.startsWith(INVENTORY_DEFECT_PREFIX)).sort();
    for (const [label, raw] of BROKEN) {
      const storage = new MemoryStorage({ [INVENTORY_KEY]: raw });
      open(api, storage);
      // sofort nach dem Verschieben: gültiger leerer Bestand, ohne jede Bestandsänderung
      const stored = storage.data.get(INVENTORY_KEY);
      expect(stored, label).toBeDefined();
      const doc: unknown = JSON.parse(stored as string);
      expect(Schema.decodeUnknownEither(inventorySchema())(doc)._tag, label).toBe("Right");
      expect(storedCounts(storage.data), label).toEqual({});
      // weitere Starts, auch zu späterer Zeit, ohne neue Beschädigung
      for (const at of [ISO, "2026-11-24T09:00:00.000Z"]) {
        const mark = storage.log.length;
        const again = api.createPlannerSession({
          catalog: CATALOG,
          templates: TEMPLATES,
          storage,
          clock: fixedClock(at),
        });
        expect(defectKeys(storage), label).toEqual([`${INVENTORY_DEFECT_PREFIX}${ISO}`]);
        expect(again.inventoryDefectBackups(), label).toEqual([`${INVENTORY_DEFECT_PREFIX}${ISO}`]);
        expect(again.messages, label).toEqual([]);
        expect(normalized(again.inventory), label).toEqual({});
        expect(writesTo(storage, mark), label).toEqual([]);
      }
    }
  });

  test("[REQ-BEST-5] erneute Beschädigung nach dem Verschieben: der nächste Start legt einen zweiten Ausweichschlüssel an", async () => {
    const api = await loadPlannerSession();
    const later = "2026-11-24T08:30:00.000Z";
    const first = BROKEN[0]?.[1] as string;
    const second = BROKEN[2]?.[1] as string;
    const storage = new MemoryStorage({ [INVENTORY_KEY]: first });
    open(api, storage);
    open(api, storage); // Neuladen ohne Änderung
    storage.data.set(INVENTORY_KEY, second); // von Hand ein zweites Mal beschädigt
    const s = api.createPlannerSession({
      catalog: CATALOG,
      templates: TEMPLATES,
      storage,
      clock: fixedClock(later),
    });
    const m = s.messages.find((x) => x.kind === "bestandVerschoben");
    expect(m?.kind === "bestandVerschoben" && m.backupKey).toBe(
      `${INVENTORY_DEFECT_PREFIX}${later}`,
    );
    expect(storage.data.get(`${INVENTORY_DEFECT_PREFIX}${ISO}`)).toBe(first);
    expect(storage.data.get(`${INVENTORY_DEFECT_PREFIX}${later}`)).toBe(second);
    expect([...s.inventoryDefectBackups()].sort()).toEqual(
      [`${INVENTORY_DEFECT_PREFIX}${ISO}`, `${INVENTORY_DEFECT_PREFIX}${later}`].sort(),
    );
    expect(storedCounts(storage.data)).toEqual({});
    expect(normalized(s.inventory)).toEqual({});
  });

  test("[REQ-BEST-5] belegter Ausweichschlüssel: -2, -3 …; auflisten, Rohtext, löschen; keine Layout-Schlüssel", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage();
    const base = `${INVENTORY_DEFECT_PREFIX}${ISO}`;
    const raws = BROKEN.slice(0, 3).map(([, raw]) => raw);
    for (const raw of raws) {
      storage.data.set(INVENTORY_KEY, raw);
      open(api, storage); // gleiche Uhrzeit bei jedem Start
    }
    expect(storage.data.get(base)).toBe(raws[0]);
    expect(storage.data.get(`${base}-2`)).toBe(raws[1]);
    expect(storage.data.get(`${base}-3`)).toBe(raws[2]);

    // eine kaputte Layout-Sicherung daneben (M2)
    storage.data.set(m2.WORKING_KEY, "kaputtes Layout");
    storage.data.delete(INVENTORY_KEY);
    const s = open(api, storage);
    const layoutDefects = s.defectBackups();
    expect(layoutDefects).toHaveLength(1);
    expect([...s.inventoryDefectBackups()].sort()).toEqual([base, `${base}-2`, `${base}-3`].sort());
    expect(s.inventoryDefectRawText(`${base}-2`)).toBe(raws[1]);
    expect(s.savedNames()).toEqual([]);
    s.deleteInventoryDefect(`${base}-2`);
    expect(storage.data.has(`${base}-2`)).toBe(false);
    expect(storage.data.get(base)).toBe(raws[0]);
    expect([...s.inventoryDefectBackups()].sort()).toEqual([base, `${base}-3`].sort());
    expect(s.defectBackups()).toEqual(layoutDefects);
    expect(normalized(s.inventory)).toEqual({});
  });

  test("[REQ-BEST-5] scheitert das Verschieben, bleibt der kaputte Wert stehen und wird in der Sitzung nicht überschrieben; Änderungen nur im Speicher der Seite", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({ [INVENTORY_KEY]: NOT_JSON });
    storage.fail = (op, key) => op === "set" && key.startsWith(INVENTORY_DEFECT_PREFIX);
    let s: PlannerSession | undefined;
    expect(() => {
      s = open(api, storage);
    }).not.toThrow();
    const session = s as PlannerSession;
    expect(normalized(session.inventory)).toEqual({});
    const m = session.messages.find((x) => x.kind === "bestandNichtVerschoben");
    expect(m?.text.length).toBeGreaterThan(0);
    expect(() => {
      session.increment("gerade-342");
      session.addSet(T_MACH8.id, true);
      session.setCount("kurve-1-90", "2");
      session.clearInventory(true);
      session.increment("gerade-114");
    }).not.toThrow();
    expect(normalized(session.inventory)).toEqual({ "gerade-114": 1 });
    expect(storage.data.get(INVENTORY_KEY)).toBe(NOT_JSON);
    expect(writesTo(storage, 0)).not.toContain(INVENTORY_KEY);
  });

  test("[REQ-BEST-6] Speicher wirft beim Lesen oder Schreiben des Bestands: Meldung, Bestand der Seite bleibt, keine Ausnahme", async () => {
    const api = await loadPlannerSession();
    // Lesen scheitert
    const r = new MemoryStorage({ [INVENTORY_KEY]: JSON.stringify(inventoryDoc(MACH8)) });
    r.fail = (op, key) => op === "get" && key === INVENTORY_KEY;
    let s: PlannerSession | undefined;
    expect(() => {
      s = open(api, r);
    }).not.toThrow();
    const reader = s as PlannerSession;
    expect(normalized(reader.inventory)).toEqual({});
    expect(reader.messages.some((m) => m.kind === "speicherFehler")).toBe(true);
    reader.increment("gerade-342");
    expect(countIn(reader.inventory, "gerade-342")).toBe(1);

    // Schreiben scheitert
    const w = new MemoryStorage();
    const writer = open(api, w);
    w.fail = (op, key) => op === "set" && key === INVENTORY_KEY;
    const before = writer.messages.length;
    expect(() => writer.setCount("kurve-1-90", "8")).not.toThrow();
    expect(countIn(writer.inventory, "kurve-1-90")).toBe(8);
    expect(writer.messages.length).toBeGreaterThan(before);
    expect(writer.messages.at(-1)?.kind).toBe("speicherFehler");
    expect(() => {
      writer.increment("kurve-1-90");
      writer.decrement("gerade-342");
      writer.addSet(T_MACH8.id, true);
      writer.clearInventory(true);
    }).not.toThrow();
    expect(normalized(writer.inventory)).toEqual({});
    // die Strecke bleibt bedienbar
    writer.dispatch(choose("gerade-342"));
    expect(writer.state.elements).toHaveLength(1);

    // alles scheitert
    const all = new MemoryStorage();
    all.fail = () => true;
    let t: PlannerSession | undefined;
    expect(() => {
      t = open(api, all);
      (t as PlannerSession).increment("gerade-342");
      (t as PlannerSession).dispatch(choose("gerade-342"));
    }).not.toThrow();
    const broken = t as PlannerSession;
    expect(countIn(broken.inventory, "gerade-342")).toBe(1);
    expect(broken.state.elements).toHaveLength(1);
    // Liste, Rohtext und Löschen defekter Bestandssicherungen: keine Ausnahme, Meldung
    const key = `${INVENTORY_DEFECT_PREFIX}${ISO}`;
    let n = broken.messages.length;
    expect(broken.inventoryDefectBackups()).toEqual([]);
    expect(broken.messages.length).toBeGreaterThan(n);
    n = broken.messages.length;
    expect(broken.inventoryDefectRawText(key)).toBeUndefined();
    expect(broken.messages.length).toBeGreaterThan(n);
    n = broken.messages.length;
    expect(() => broken.deleteInventoryDefect(key)).not.toThrow();
    expect(broken.messages.length).toBeGreaterThan(n);
  });

  test("[REQ-BEST-7] gespeicherter Bestand mit unbekannter ID: geladen, gemeldet, beim nächsten Sichern unverändert mitgeschrieben", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({
      [INVENTORY_KEY]: '{"schemaVersion":1,"counts":{"kurve-1-90":8,"gibt-es-nicht":3}}',
    });
    const s = open(api, storage);
    expect(countIn(s.inventory, "kurve-1-90")).toBe(8);
    expect(countIn(s.inventory, "gibt-es-nicht")).toBe(3);
    const m = s.messages.find((x) => x.kind === "bestandIgnoriert");
    expect(m).toBeDefined();
    if (m?.kind === "bestandIgnoriert") {
      expect(m.partIds).toEqual(["gibt-es-nicht"]);
      expect(m.text).toContain("gibt-es-nicht");
    }
    expect(s.messages.some((x) => x.kind === "bestandVerschoben")).toBe(false);
    s.increment("gerade-342");
    expect(storedCounts(storage.data)).toEqual({
      "gerade-342": 1,
      "gibt-es-nicht": 3,
      "kurve-1-90": 8,
    });
  });

  test("[REQ-BEST-7] Baugruppen-IDs im Bestand werden ebenfalls gemeldet und mitgeführt", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({
      [INVENTORY_KEY]: JSON.stringify(inventoryDoc({ steilkehre: 1, looping: 2, "kurve-1-90": 1 })),
    });
    const s = open(api, storage);
    const m = s.messages.find((x) => x.kind === "bestandIgnoriert");
    expect(m?.kind === "bestandIgnoriert" && m.partIds).toEqual(["looping", "steilkehre"]);
    expect(m?.text).toContain("looping");
    expect(m?.text).toContain("steilkehre");
    s.addSet(T_AUSBAU1.id, true);
    expect(storedCounts(storage.data)).toEqual(
      normalized(plus({ steilkehre: 1, looping: 2, "kurve-1-90": 1 }, AUSBAU1)),
    );
  });
});

describe("Nicht zählende Einträge mit Anzahl 0", () => {
  test("[REQ-BEST-7] unbekannte und Baugruppen-IDs mit Anzahl 0: unverändert mitgespeichert, nicht gemeldet", async () => {
    const api = await loadPlannerSession();
    const rawCounts = (storage: MemoryStorage): Record<string, number> =>
      (JSON.parse(storage.data.get(INVENTORY_KEY) as string) as InventoryDoc).counts;
    const expectZeroKept = (storage: MemoryStorage, id: string): void => {
      const counts = rawCounts(storage);
      expect({ id, kept: Object.hasOwn(counts, id) }).toEqual({ id, kept: true });
      expect({ id, n: counts[id] }).toEqual({ id, n: 0 });
    };

    // nur Nullen: keine Meldung
    const zeros = new MemoryStorage({
      [INVENTORY_KEY]:
        '{"schemaVersion":1,"counts":{"kurve-1-90":8,"gibt-es-nicht":0,"looping":0}}',
    });
    const s = open(api, zeros);
    expect(s.messages).toEqual([]);
    expect(countIn(s.inventory, "kurve-1-90")).toBe(8);
    s.increment("gerade-342");
    expectZeroKept(zeros, "gibt-es-nicht");
    expectZeroKept(zeros, "looping");
    expect(rawCounts(zeros)["kurve-1-90"]).toBe(8);
    expect(rawCounts(zeros)["gerade-342"]).toBe(1);
    // auch nach weiteren Änderungen und einem Neustart
    s.addSet(T_AUSBAU1.id, true);
    s.setCount("kurve-1-90", "3");
    const reopened = open(api, zeros);
    expect(reopened.messages).toEqual([]);
    reopened.decrement("gerade-342");
    expectZeroKept(zeros, "gibt-es-nicht");
    expectZeroKept(zeros, "looping");

    // gemischt: gemeldet wird nur die ID mit Anzahl ≥ 1
    const mixed = new MemoryStorage({
      [INVENTORY_KEY]:
        '{"schemaVersion":1,"counts":{"kurve-1-90":8,"gibt-es-nicht":0,"steilkehre":2}}',
    });
    const t = open(api, mixed);
    const m = t.messages.filter((x) => x.kind === "bestandIgnoriert");
    expect(m).toHaveLength(1);
    expect(m[0]?.kind === "bestandIgnoriert" && m[0].partIds).toEqual(["steilkehre"]);
    expect(m[0]?.text).not.toContain("gibt-es-nicht");
    t.increment("gerade-342");
    expectZeroKept(mixed, "gibt-es-nicht");
    expect(rawCounts(mixed).steilkehre).toBe(2);
  });
});

describe("Bestand und Layouts getrennt", () => {
  test("[REQ-BEST-8] Bestandsänderungen schreiben nur carrera-planer:bestand und ändern weder Folge, Verlauf, Namen noch Arbeitsstand", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const E = await loadEditor();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.dispatch({ type: "load", elements: OVAL });
    s.dispatch(choose("gerade-114"));
    expect(s.saveAs("Oval")).toEqual({ ok: true });
    const state = s.state;
    const working = storage.data.get(m2.WORKING_KEY);
    const mark = storage.log.length;

    s.setCount("kurve-1-90", "8");
    s.increment("gerade-342");
    s.decrement("gerade-342");
    s.decrement("gerade-342"); // bei 0: unwirksam
    s.setCount("kurve-1-90", "-3"); // abgewiesen
    s.setCount("steilkehre", "1"); // abgewiesen
    s.addSet(T_MACH8.id, true);
    s.addSet(T_MACH8.id, false);
    s.clearInventory(false);
    s.clearInventory(true);

    expect(new Set(writesTo(storage, mark))).toEqual(new Set([INVENTORY_KEY]));
    expect(s.state.elements).toEqual(state.elements);
    expect(E.canUndo(s.state)).toBe(true);
    expect(E.canRedo(s.state)).toBe(false);
    expect(s.name).toBe("Oval");
    expect(storage.data.get(m2.WORKING_KEY)).toBe(working);
    // Rückgängig nimmt das letzte Streckenteil zurück, nicht die Bestandsänderung
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toEqual(OVAL);
    expect(normalized(s.inventory)).toEqual({});
  });

  test("[REQ-BEST-8] Folgeänderungen schreiben den Bestand nicht", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.addSet(T_MACH8.id, true);
    const mark = storage.log.length;
    for (const c of [
      choose("gerade-342"),
      choose("kurve-1-90"),
      { type: "load", elements: ACHT },
      { type: "undo" },
      { type: "redo" },
      { type: "new" },
    ] as ReadonlyArray<Command>) {
      s.dispatch(c);
    }
    s.saveAs("Leer");
    s.importFile("oval.json", JSON.stringify(layoutJson(OVAL)));
    expect(writesTo(storage, mark)).not.toContain(INVENTORY_KEY);
    expect(writesTo(storage, mark).some((k) => k.startsWith(INVENTORY_DEFECT_PREFIX))).toBe(false);
  });

  test("[REQ-BEST-8] Layout-Liste und Layout-Defektliste enthalten keine Bestandsschlüssel, die Bestand-Defektliste keine Layout-Schlüssel", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage({
      [INVENTORY_KEY]: JSON.stringify({ schemaVersion: 2, counts: {} }),
      [m2.WORKING_KEY]: JSON.stringify({ schemaVersion: 2, elements: [] }),
      [m2.layoutKey("Oval")]: JSON.stringify(layoutJson(OVAL)),
      [MODE_KEY]: "kaputt",
    });
    const plain = m2.createSession({ catalog: CATALOG, storage, clock });
    const s = open(api, storage);
    s.setMode("bestand");
    s.increment("gerade-342");
    const inventoryKeys = [...storage.data.keys()].filter(
      (k) => k === INVENTORY_KEY || k.startsWith(INVENTORY_DEFECT_PREFIX) || k === MODE_KEY,
    );
    expect(inventoryKeys.length).toBeGreaterThanOrEqual(3);
    for (const session of [s, plain]) {
      expect(session.savedNames()).toEqual(["Oval"]);
      const layoutDefects = session.defectBackups();
      expect(layoutDefects).toHaveLength(1);
      for (const k of inventoryKeys) expect(layoutDefects).not.toContain(k);
    }
    const inventoryDefects = s.inventoryDefectBackups();
    expect(inventoryDefects).toEqual([`${INVENTORY_DEFECT_PREFIX}${ISO}`]);
    expect(inventoryDefects).not.toContain(s.defectBackups()[0]);
  });

  test("[REQ-BEST-9] „Bestand leeren“ nur mit Bestätigung; leert alles, auch nicht zählende Einträge", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({
      [INVENTORY_KEY]: JSON.stringify(
        inventoryDoc({ ...MACH8, "gibt-es-nicht": 3, steilkehre: 1 }),
      ),
    });
    const s = open(api, storage);
    const mark = storage.log.length;
    s.clearInventory(false);
    expect(normalized(s.inventory)).toEqual(
      normalized({ ...MACH8, "gibt-es-nicht": 3, steilkehre: 1 }),
    );
    expect(writesTo(storage, mark)).toEqual([]);
    s.clearInventory(true);
    expect(normalized(s.inventory)).toEqual({});
    expect(storedCounts(storage.data)).toEqual({});
    expect(normalized(open(api, storage).inventory)).toEqual({});
  });
});

describe("Bestand ändern in der Sitzung", () => {
  test("[REQ-BEST-2] abgewiesene Änderungen: Bestand und Speicher bleiben, Meldung", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.setCount("kurve-1-90", "8");
    const mark = storage.log.length;
    for (const [partId, input] of [
      ["kurve-1-90", "-3"],
      ["kurve-1-90", "2,5"],
      ["kurve-1-90", ""],
      ["kurve-1-90", "acht"],
      ["steilkehre", "1"],
      [UNKNOWN_ID, "1"],
    ] as const) {
      const before = s.messages.length;
      s.setCount(partId, input);
      expect(normalized(s.inventory)).toEqual({ "kurve-1-90": 8 });
      const m = s.messages.at(-1);
      expect({ input, grew: s.messages.length > before }).toEqual({ input, grew: true });
      expect(m?.kind).toBe("bestandAbgewiesen");
      if (m?.kind === "bestandAbgewiesen") {
        expect(m.partId).toBe(partId);
        expect(m.text.length).toBeGreaterThan(0);
      }
    }
    for (const id of ["looping", UNKNOWN_ID]) {
      const before = s.messages.length;
      s.increment(id);
      s.decrement(id);
      expect(s.messages.length).toBe(before + 2);
    }
    // −1 bei Anzahl 0 ändert nichts, schreibt nicht und liefert keine Meldung
    const n = s.messages.length;
    s.decrement("gerade-171");
    expect(normalized(s.inventory)).toEqual({ "kurve-1-90": 8 });
    expect(writesTo(storage, mark)).toEqual([]);
    expect(s.messages).toHaveLength(n);
  });

  test("[REQ-BEST-2] −1 bei Anzahl 0 in der Sitzung: keine Änderung, kein Schreiben, keine Meldung", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    const n = s.messages.length;
    s.decrement("kurve-1-90"); // leerer Bestand
    expect(storage.data.has(INVENTORY_KEY)).toBe(false);
    expect(s.messages).toHaveLength(n);
    // nach dem Herunterzählen auf 0
    s.setCount("gerade-114", "1");
    s.decrement("gerade-114");
    expect(countIn(s.inventory, "gerade-114")).toBe(0);
    expect(storedCounts(storage.data)).toEqual({});
    const mark = storage.log.length;
    const n0 = s.messages.length;
    s.decrement("gerade-114");
    s.decrement("gerade-114");
    expect(countIn(s.inventory, "gerade-114")).toBe(0);
    expect(writesTo(storage, mark)).toEqual([]);
    expect(s.messages).toHaveLength(n0);
    expect(s.messages.some((m) => m.kind === "bestandAbgewiesen")).toBe(false);
  });

  test("[REQ-SET-4] Vorlage gewählt und bestätigt: addiert und sichert; Abbrechen ändert nichts; Beispiel Summe und zweites Mach 8", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.addSet(T_MACH8.id, false);
    expect(normalized(s.inventory)).toEqual({});
    expect(storage.data.has(INVENTORY_KEY)).toBe(false);
    for (const t of [T_MACH8, T_AUSBAU1, T_AUSBAU3]) s.addSet(t.id, true);
    expect(normalized(s.inventory)).toEqual(normalized(SUMME3));
    expect(storedCounts(storage.data)).toEqual(normalized(SUMME3));
    s.addSet(T_MACH8.id, true);
    expect(countIn(s.inventory, "gerade-342")).toBe(18);
    expect(countIn(s.inventory, "looping-teil")).toBe(16);
    expect(storedCounts(storage.data)).toEqual(normalized(plus(SUMME3, MACH8)));
  });

  test("[REQ-SET-4] die Sitzung nutzt die eingereichten Vorlagen; nicht zählende Einträge bleiben", async () => {
    const api = await loadPlannerSession();
    const own: SetTemplate = {
      id: "eigene",
      name: "Eigene",
      articleNumber: "20069999",
      source: "Test",
      certainty: "niedrig",
      contents: [{ part: "gerade-171", count: 3 }],
    };
    const storage = new MemoryStorage({
      [INVENTORY_KEY]: JSON.stringify(inventoryDoc({ "gibt-es-nicht": 3, "gerade-171": 1 })),
    });
    const s = open(api, storage, [own]);
    s.addSet("eigene", true);
    expect(normalized(s.inventory)).toEqual({ "gerade-171": 4, "gibt-es-nicht": 3 });
    s.addSet(T_MACH8.id, true); // nicht eingereicht
    expect(normalized(s.inventory)).toEqual({ "gerade-171": 4, "gibt-es-nicht": 3 });
  });
});

describe("Modus in der Sitzung", () => {
  test("[REQ-MODUS-1] Start ohne gespeicherten Modus: Sandbox ohne Meldung; Wechsel bleibt über Neustart", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    expect(s.mode).toBe("sandbox");
    expect(s.messages).toEqual([]);
    s.setMode("bestand");
    expect(s.mode).toBe("bestand");
    expect(storage.data.has(MODE_KEY)).toBe(true);
    const reopened = open(api, storage);
    expect(reopened.mode).toBe("bestand");
    expect(reopened.messages).toEqual([]);
    s.setMode("sandbox");
    const back = open(api, storage);
    expect(back.mode).toBe("sandbox");
    expect(back.messages).toEqual([]);
  });

  test("[REQ-MODUS-1] Moduswechsel ändert weder Folge, Verlauf, Auswahl, Aktion noch Namen und schreibt den Arbeitsstand nicht", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const E = await loadEditor();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.dispatch({ type: "load", elements: OVAL });
    s.saveAs("Oval");
    s.dispatch({ type: "select", id: "o3" });
    s.dispatch({ type: "setAction", action: "ersetzen" });
    const before = s.state;
    const mark = storage.log.length;
    s.setMode("bestand");
    s.setMode("sandbox");
    s.setMode("bestand");
    expect(s.state.elements).toEqual(before.elements);
    expect(s.state.selection).toBe("o3");
    expect(s.state.action).toBe("ersetzen");
    expect(s.state.paletteTurn).toBe(before.paletteTurn);
    expect(E.canUndo(s.state)).toBe(E.canUndo(before));
    expect(E.canRedo(s.state)).toBe(false);
    expect(s.name).toBe("Oval");
    const writes = writesTo(storage, mark);
    expect(writes).not.toContain(m2.WORKING_KEY);
    expect(writes).not.toContain(INVENTORY_KEY);
    expect(new Set(writes)).toEqual(new Set([MODE_KEY]));
    // kein Verlaufseintrag: ein Rückgängig nimmt das Laden zurück
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toEqual([]);
  });

  test("[REQ-MODUS-1] ungültiger gespeicherter Modus: Sandbox mit Meldung; beim nächsten Wechsel überschrieben", async () => {
    const api = await loadPlannerSession();
    for (const value of ["kaputt", "", "{}", "1", "   "]) {
      const storage = new MemoryStorage({ [MODE_KEY]: value });
      const s = open(api, storage);
      expect({ value, mode: s.mode }).toEqual({ value, mode: "sandbox" });
      const m = s.messages.find((x) => x.kind === "modusUngueltig");
      expect(m, value).toBeDefined();
      if (m?.kind === "modusUngueltig") {
        expect(m.value).toBe(value);
        expect(m.text.length).toBeGreaterThan(0);
      }
      s.setMode("bestand");
      expect(storage.data.get(MODE_KEY)).not.toBe(value);
      const again = open(api, storage);
      expect(again.mode).toBe("bestand");
      expect(again.messages.some((x) => x.kind === "modusUngueltig")).toBe(false);
    }
  });

  test("[REQ-MODUS-1] Speicher wirft beim Lesen oder Schreiben des Modus: Meldung speicherFehler, Modus wechselt trotzdem, keine Ausnahme", async () => {
    const api = await loadPlannerSession();
    // Lesen scheitert (gespeichert wäre „bestand“): Sandbox, Meldung, Wechsel wirkt
    const r = new MemoryStorage();
    open(api, r).setMode("bestand");
    r.fail = (op, key) => op === "get" && key === MODE_KEY;
    let s: PlannerSession | undefined;
    expect(() => {
      s = open(api, r);
    }).not.toThrow();
    const reader = s as PlannerSession;
    expect(reader.mode).toBe("sandbox");
    expect(reader.messages.some((m) => m.kind === "speicherFehler")).toBe(true);
    expect(reader.messages.some((m) => m.kind === "modusUngueltig")).toBe(false);
    expect(() => reader.setMode("bestand")).not.toThrow();
    expect(reader.mode).toBe("bestand");
    reader.dispatch(choose("gerade-342")); // leerer Bestand: abgewiesen, aber bedienbar
    expect(reader.state.elements).toEqual([]);
    expect(reader.messages.at(-1)?.kind).toBe("befehlAbgewiesen");

    // Schreiben scheitert: jeder Wechsel wirkt und meldet speicherFehler
    const w = new MemoryStorage();
    const writer = open(api, w);
    w.fail = (op, key) => op === "set" && key === MODE_KEY;
    for (const mode of ["bestand", "sandbox", "bestand"] as const) {
      const n = writer.messages.length;
      expect(() => writer.setMode(mode)).not.toThrow();
      expect(writer.mode).toBe(mode);
      expect(writer.messages.length).toBeGreaterThan(n);
      expect(writer.messages.at(-1)?.kind).toBe("speicherFehler");
    }
    expect(w.data.has(MODE_KEY)).toBe(false);
    // bedienbar: Bestand und Strecke reagieren weiter
    writer.increment("gerade-342");
    writer.dispatch(choose("gerade-342"));
    expect(writer.state.elements).toHaveLength(1);
  });

  test("[REQ-MODUS-2] Sitzung im Modus „Sandbox“: Bestand beeinflusst keinen Befehl", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    const ref = m2.createSession({ catalog: CATALOG, storage: new MemoryStorage(), clock });
    s.addSet(T_MACH8.id, true);
    const commands: ReadonlyArray<Command> = [
      ...Array.from({ length: 9 }, () => choose("kurve-1-90")),
      ...Array.from({ length: 6 }, () => choose("gerade-342")),
      choose("kurve-1-45"),
      { type: "select", id: "e1" },
      { type: "setAction", action: "ersetzen" },
      choose("engstelle"),
      { type: "undo" },
      { type: "redo" },
    ];
    for (const c of commands) {
      s.dispatch(c);
      ref.dispatch(c);
      expect(s.state.elements).toEqual(ref.state.elements);
    }
    expect(s.state.elements).toHaveLength(16);
    expect(s.messages.some((m) => m.kind === "befehlAbgewiesen")).toBe(false);
  });

  test("[REQ-MODUS-3] Sitzung im Modus „Bestand“: abgewiesener Befehl meldet das Teil, ändert nichts und sichert nichts", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.addSet(T_MACH8.id, true);
    s.setMode("bestand");
    for (let i = 0; i < 4; i++) s.dispatch(choose("gerade-342"));
    const working = storage.data.get(m2.WORKING_KEY);
    const mark = storage.log.length;
    s.dispatch(choose("gerade-342"));
    expect(s.state.elements).toHaveLength(4);
    const m = s.messages.at(-1);
    expect(m?.kind).toBe("befehlAbgewiesen");
    if (m?.kind === "befehlAbgewiesen") {
      expect(m.partId).toBe("gerade-342");
      expect(m.text).toContain("Gerade 342");
    }
    expect(writesTo(storage, mark)).toEqual([]);
    expect(storage.data.get(m2.WORKING_KEY)).toBe(working);
    // Bestand erhöhen → wirkt wieder
    s.increment("gerade-342");
    s.dispatch(choose("gerade-342"));
    expect(s.state.elements).toHaveLength(5);
  });

  test("[REQ-MODUS-4] im Modus „Bestand“: Laden, Import, Neu, Rückgängig, Wiederholen und Moduswechsel nie abgewiesen", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage({
      [m2.layoutKey("Oval")]: JSON.stringify(layoutJson(OVAL)),
      [INVENTORY_KEY]: JSON.stringify(inventoryDoc(AUSBAU3)),
    });
    const s = open(api, storage);
    s.setMode("bestand");
    s.load("Oval");
    expect(s.state.elements).toEqual(OVAL);
    s.dispatch(choose("kurve-1-90")); // überzogen: abgewiesen
    expect(s.state.elements).toEqual(OVAL);
    s.dispatch(choose("gerade-342")); // 3 ≤ 8: wirkt
    expect(s.state.elements).toHaveLength(7);
    s.importFile("acht.json", JSON.stringify(layoutJson(ACHT)));
    expect(s.state.elements).toEqual(ACHT);
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toHaveLength(7);
    s.dispatch({ type: "redo" });
    expect(s.state.elements).toEqual(ACHT);
    s.dispatch({ type: "new" });
    expect(s.state.elements).toEqual([]);
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toEqual(ACHT);
    s.setMode("sandbox");
    s.setMode("bestand");
    expect(s.mode).toBe("bestand");
    expect(s.state.elements).toEqual(ACHT);
    const rejected = s.messages.filter((m) => m.kind === "befehlAbgewiesen");
    expect(rejected).toHaveLength(1);
  });
});

describe("Einkaufsliste in der Sitzung", () => {
  test("[REQ-EINK-5] in beiden Modi; im Modus „Bestand“ nur nach Laden, Import oder Bestandsänderung nicht leer", async () => {
    const api = await loadPlannerSession();
    const I = await loadInventory();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    const short = () => I.shoppingShort(I.shoppingList(CATALOG, s.inventory, s.state.elements));
    s.addSet(T_MACH8.id, true);
    // Sandbox: neun Kurven → fehlen 3
    for (let i = 0; i < 9; i++) s.dispatch(choose("kurve-1-90"));
    expect(short()).toBe("fehlen 3 Teile");
    // Bestand: dieselbe Folge bleibt, Kurzform gleich
    s.setMode("bestand");
    expect(s.state.elements).toHaveLength(9);
    expect(short()).toBe("fehlen 3 Teile");
    s.dispatch({ type: "new" });
    expect(short()).toBe("Bestand reicht");
    for (const c of [
      ...Array.from({ length: 8 }, () => choose("kurve-1-90")),
      ...Array.from({ length: 6 }, () => choose("gerade-342")),
    ]) {
      s.dispatch(c);
      expect(short()).toBe("Bestand reicht");
    }
    // im Bestandsmodus wurden je zwei Kurven und Geraden abgewiesen: 6 Kurven, 4 Geraden
    expect(s.state.elements).toHaveLength(10);
    // Bestandsänderung
    s.setCount("kurve-1-90", "4");
    expect(short()).toBe("fehlen 2 Teile");
    s.setCount("kurve-1-90", "8");
    expect(short()).toBe("Bestand reicht");
    // Import
    s.importFile(
      "neun.json",
      JSON.stringify(
        layoutJson(
          Array.from({ length: 11 }, (_, i) => ({
            id: `k${i}`,
            part: "kurve-1-90",
            turn: "links",
          })),
        ),
      ),
    );
    expect(short()).toBe("fehlen 3 Teile");
    // Laden (Acht braucht Kreuzung und Anschlussstück)
    s.dispatch({ type: "new" });
    s.setCount("kreuzung", "0");
    s.setCount("anschlussstueck", "0");
    expect(short()).toBe("Bestand reicht");
    s.dispatch({ type: "load", elements: ACHT });
    expect(short()).toBe("fehlen 2 Teile");
  });
});
