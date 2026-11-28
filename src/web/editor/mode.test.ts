/**
 * Spec M3a (.specify/specs/m3a-bestand/spec.md): Bestandsmodus als reine Logik. Abnahmetests
 * REQ-MODUS-2 bis REQ-MODUS-6 (Logikteil; Start und Speicherung des Modus, Laden per Sitzung und
 * Import prüft planner-session.test.ts).
 *
 * Schnittstelle (Typen: src/web/test-support/bestand-fixtures.ts), Modul
 * `src/web/editor/inventory.ts`:
 *   applyInMode(catalog, inventory, mode, state, command) → { state, rejection }
 *     „sandbox“: genau M2 `apply`, nie eine Abweisung. „bestand“: Abweisung nach REQ-MODUS-3,
 *     dann ist `state` der unveränderte Eingangszustand (keine neue Folge, kein Verlaufseintrag).
 *   stockPalette(catalog, inventory, elements) → Leisten-Einteilung mit Bestand, Rest, gesperrt.
 * Orakel für den Verbrauch ist der Kern (`consumption`), für M2-Befehle der M2-Editor (`apply`).
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { consumption } from "../../core/index.js";
import {
  AUSBAU3,
  anyInventoryArb,
  catalogElementsArb,
  countIn,
  type Inventory,
  type InventoryApi,
  loadInventory,
  MACH8,
  type Mode,
  type ModeResult,
  plus,
  type StockPaletteEntry,
  WIRELESS,
} from "../test-support/bestand-fixtures.js";
import {
  ACHT,
  anyCommandArb,
  CATALOG,
  type CatalogEntry,
  type Command,
  type EditorApi,
  type EditorState,
  elementsArb,
  type GenCommand,
  historyStates,
  type LayoutElement,
  loadEditor,
  loaded,
  OVAL,
  resolve,
  run,
  UNKNOWN_ID,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

const choose = (partId: string): Command => ({ type: "choosePart", partId });
const select = (id: string): Command => ({ type: "select", id });
const replaceWith = (id: string, partId: string): ReadonlyArray<Command> => [
  select(id),
  { type: "setAction", action: "ersetzen" },
  choose(partId),
];

/** Befehle nacheinander im Modus anwenden; sammelt die Abweisungen. */
const runIn = (
  I: InventoryApi,
  inventory: Inventory,
  mode: Mode,
  state: EditorState,
  commands: ReadonlyArray<Command>,
  catalog: ReadonlyArray<CatalogEntry> = CATALOG,
): { state: EditorState; results: ModeResult[] } => {
  const results: ModeResult[] = [];
  let s = state;
  for (const c of commands) {
    const r = I.applyInMode(catalog, inventory, mode, s, c);
    results.push(r);
    s = r.state;
  }
  return { state: s, results };
};

const partsOf = (elements: Elements): string[] =>
  elements.map((el) => ("part" in el ? el.part : `>${el.crosses}`));

/** Beobachtbarer Zustand samt Verlauf gleich. */
const expectSameState = (E: EditorApi, actual: EditorState, expected: EditorState): void => {
  expect(actual.elements).toEqual(expected.elements);
  expect(actual.selection).toBe(expected.selection);
  expect(actual.action).toBe(expected.action);
  expect(actual.paletteTurn).toBe(expected.paletteTurn);
  expect(E.canUndo(actual)).toBe(E.canUndo(expected));
  expect(E.canRedo(actual)).toBe(E.canRedo(expected));
};

const expectRejectedUnchanged = (E: EditorApi, r: ModeResult, before: EditorState): void => {
  expect(r.rejection).toBeDefined();
  expect(r.state.elements).toEqual(before.elements);
  expect(E.canUndo(r.state)).toBe(E.canUndo(before));
  expect(E.canRedo(r.state)).toBe(E.canRedo(before));
  expect(historyStates(E, r.state)).toEqual(historyStates(E, before));
};

/** Überzogen nach dem Kern: ein Teil mit Verbrauch > Bestand. */
const overdrawn = (inventory: Inventory, elements: Elements): boolean => {
  const c = consumption(CATALOG, elements);
  if (!c.ok) throw new Error("Testdaten-Fehler: Verbrauch nicht bestimmbar");
  return Object.entries(c.counts).some(([p, n]) => n > countIn(inventory, p));
};

const usage = (elements: Elements): Inventory => {
  const c = consumption(CATALOG, elements);
  if (!c.ok) throw new Error("Testdaten-Fehler: Verbrauch nicht bestimmbar");
  return c.counts;
};

describe("Sandbox", () => {
  test("[REQ-MODUS-2] Eigenschaft: in der Sandbox ergibt jeder Befehl bei beliebigem Bestand denselben Zustand wie M2 apply", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    fc.assert(
      fc.property(
        anyInventoryArb,
        fc.option(elementsArb, { nil: undefined }),
        fc.array(anyCommandArb, { maxLength: 30 }),
        (inventory, start, gens) => {
          let m2 = start === undefined ? E.initialState() : loaded(E, start);
          let sb = m2;
          for (const g of gens) {
            const c = resolve(m2, g);
            const r = I.applyInMode(CATALOG, inventory, "sandbox", sb, c);
            expect(r.rejection).toBeUndefined();
            m2 = E.apply(CATALOG, m2, c);
            sb = r.state;
            expectSameState(E, sb, m2);
          }
          expect(historyStates(E, sb)).toEqual(historyStates(E, m2));
        },
      ),
      { numRuns: 200 },
    );
  });

  test("[REQ-MODUS-2] Sandbox mit leerem Bestand: jedes platzierbare Teil ist anhängbar, über jeden Bestand hinaus", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const many = Array.from({ length: 9 }, () => choose("kurve-1-90"));
    const { state, results } = runIn(I, {}, "sandbox", E.initialState(), many);
    expect(state.elements).toHaveLength(9);
    expect(results.every((r) => r.rejection === undefined)).toBe(true);
    const viaM2 = run(E, E.initialState(), many);
    expect(state.elements).toEqual(viaM2.elements);
  });
});

describe("Bestandsprüfung der Befehle", () => {
  test("[REQ-MODUS-3] Bestand Mach 8, leere Folge: fünfmal Gerade 342 → vier angehängt, der fünfte abgewiesen mit Teilnamen", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const { state, results } = runIn(
      I,
      MACH8,
      "bestand",
      E.initialState(),
      Array.from({ length: 5 }, () => choose("gerade-342")),
    );
    expect(partsOf(state.elements)).toEqual(Array(4).fill("gerade-342"));
    expect(results.slice(0, 4).map((r) => r.rejection)).toEqual(Array(4).fill(undefined));
    const fifth = results[4] as ModeResult;
    expect(fifth.rejection?.partId).toBe("gerade-342");
    expect(fifth.rejection?.name).toBe("Gerade 342");
    expect(fifth.rejection?.text).toContain("Gerade 342");
    expectRejectedUnchanged(E, fifth, (results[3] as ModeResult).state);
    // die ersten vier wirken genau wie in M2
    expectSameState(
      E,
      (results[3] as ModeResult).state,
      run(
        E,
        E.initialState(),
        Array.from({ length: 4 }, () => choose("gerade-342")),
      ),
    );
  });

  test("[REQ-MODUS-3] siebenmal Kurve 1/90° → sechs angehängt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const { state, results } = runIn(
      I,
      MACH8,
      "bestand",
      E.initialState(),
      Array.from({ length: 7 }, () => choose("kurve-1-90")),
    );
    expect(partsOf(state.elements)).toEqual(Array(6).fill("kurve-1-90"));
    expect(results.filter((r) => r.rejection !== undefined)).toHaveLength(1);
    expect(results[6]?.rejection?.name).toBe("Kurve 1/90°");
  });

  test("[REQ-MODUS-3] Oval mit Mach 8: Gerade → Engstelle wirkt, die zweite Engstelle und Kurve 1/45° werden abgewiesen", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const oval = loaded(E, OVAL);
    const first = runIn(I, MACH8, "bestand", oval, replaceWith("o3", "engstelle"));
    expect(first.results.every((r) => r.rejection === undefined)).toBe(true);
    expect(partsOf(first.state.elements)).toEqual([
      "kurve-1-90",
      "kurve-1-90",
      "engstelle",
      "kurve-1-90",
      "kurve-1-90",
      "gerade-342",
    ]);

    const prep = run(E, first.state, replaceWith("o6", "engstelle").slice(0, 2));
    const second = I.applyInMode(CATALOG, MACH8, "bestand", prep, choose("engstelle"));
    expectRejectedUnchanged(E, second, prep);
    expect(second.rejection?.partId).toBe("engstelle");
    expect(second.rejection?.text).toContain("Engstelle");

    const prep45 = run(E, first.state, replaceWith("o1", "kurve-1-45").slice(0, 2));
    const third = I.applyInMode(CATALOG, MACH8, "bestand", prep45, choose("kurve-1-45"));
    expectRejectedUnchanged(E, third, prep45);
    expect(third.rejection?.text).toContain("Kurve 1/45°");
  });

  test("[REQ-MODUS-3] „davor einfügen“ wird wie Anhängen geprüft; Ersetzen durch ein vorhandenes Teil wirkt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const four = run(
      E,
      E.initialState(),
      Array.from({ length: 4 }, () => choose("gerade-342")),
    );
    const firstId = four.elements[0]?.id as string;
    const prep = run(E, four, [select(firstId), { type: "setAction", action: "davorEinfuegen" }]);
    expectRejectedUnchanged(
      E,
      I.applyInMode(CATALOG, MACH8, "bestand", prep, choose("gerade-342")),
      prep,
    );
    const ok = I.applyInMode(CATALOG, MACH8, "bestand", prep, choose("gerade-114"));
    expect(ok.rejection).toBeUndefined();
    expectSameState(E, ok.state, E.apply(CATALOG, prep, choose("gerade-114")));

    // Kurve durch Spurwechselkurve ersetzen: Verbrauch der Spurwechselkurve steigt auf 1 ≤ 1
    const oval = loaded(E, OVAL);
    const inv = plus(MACH8, { spurwechselkurve: 1 });
    const r = runIn(I, inv, "bestand", oval, replaceWith("o1", "spurwechselkurve"));
    expect(r.results.every((x) => x.rejection === undefined)).toBe(true);
    expect(partsOf(r.state.elements)[0]).toBe("spurwechselkurve");
  });

  test("[REQ-MODUS-3] keine Ersatzteile gleicher Geometrie: Spurwechselkurve deckt keine fehlende Kurve 1/90°", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const inv: Inventory = { "kurve-1-90": 1, spurwechselkurve: 5 };
    const { state, results } = runIn(I, inv, "bestand", E.initialState(), [
      choose("kurve-1-90"),
      choose("kurve-1-90"),
    ]);
    expect(state.elements).toHaveLength(1);
    expect(results[1]?.rejection?.partId).toBe("kurve-1-90");
  });

  test("[REQ-MODUS-3] „Richtung umschalten“, „Querung anhängen“ und „Löschen“ werden nie abgewiesen, auch überzogen", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const firstHalf = loaded(E, ACHT.slice(0, 5)); // Kreuzung … Gerade 114, Querung möglich
    expect(E.crossingTarget(CATALOG, firstHalf.elements)).toBe("e1");
    for (const inventory of [{}, MACH8] as Inventory[]) {
      const cross = I.applyInMode(CATALOG, inventory, "bestand", firstHalf, {
        type: "appendCrossing",
      });
      expect(cross.rejection).toBeUndefined();
      expectSameState(E, cross.state, E.apply(CATALOG, firstHalf, { type: "appendCrossing" }));

      const sel = E.apply(CATALOG, firstHalf, select("e2"));
      const flip = I.applyInMode(CATALOG, inventory, "bestand", sel, { type: "flipSelected" });
      expect(flip.rejection).toBeUndefined();
      expectSameState(E, flip.state, E.apply(CATALOG, sel, { type: "flipSelected" }));

      const del = I.applyInMode(CATALOG, inventory, "bestand", sel, { type: "deleteSelected" });
      expect(del.rejection).toBeUndefined();
      expect(del.state.elements).toHaveLength(4);
    }
  });

  test("[REQ-MODUS-3] Verbrauch nach dem Befehl nicht bestimmbar: Hinzufügen und Ersetzen werden abgewiesen, Löschen wirkt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const inv: Inventory = { "gerade-342": 10, "gerade-114": 10, "kurve-1-90": 10 };
    const s = loaded(E, [
      { id: "u", part: UNKNOWN_ID },
      { id: "g", part: "gerade-342" },
    ]);
    const appendR = I.applyInMode(CATALOG, inv, "bestand", s, choose("gerade-342"));
    expectRejectedUnchanged(E, appendR, s);
    expect(appendR.rejection?.text.length).toBeGreaterThan(0);

    const replacePrep = run(E, s, [select("g"), { type: "setAction", action: "ersetzen" }]);
    expectRejectedUnchanged(
      E,
      I.applyInMode(CATALOG, inv, "bestand", replacePrep, choose("gerade-114")),
      replacePrep,
    );
    const beforePrep = run(E, s, [select("g"), { type: "setAction", action: "davorEinfuegen" }]);
    expectRejectedUnchanged(
      E,
      I.applyInMode(CATALOG, inv, "bestand", beforePrep, choose("kurve-1-90")),
      beforePrep,
    );

    const delPrep = E.apply(CATALOG, s, select("g"));
    const del = I.applyInMode(CATALOG, inv, "bestand", delPrep, { type: "deleteSelected" });
    expect(del.rejection).toBeUndefined();
    expect(partsOf(del.state.elements)).toEqual([UNKNOWN_ID]);
    // dieselbe Folge in der Sandbox: Anhängen wirkt
    expect(
      I.applyInMode(CATALOG, inv, "sandbox", s, choose("gerade-342")).state.elements,
    ).toHaveLength(3);
  });

  test("[REQ-MODUS-3] Verbrauch vor dem Befehl nicht bestimmbar: zählt je Teil als 0; Beispiel [unbekanntes Teil] → Gerade 342 bei Bestand 0 abgewiesen, bei 1 wirkt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const s = loaded(E, [{ id: "u", part: UNKNOWN_ID }]);
    const prep = run(E, s, [select("u"), { type: "setAction", action: "ersetzen" }]);

    for (const inv of [
      {},
      { "gerade-342": 0 },
      { "gerade-114": 5, "kurve-1-90": 5 },
    ] as Inventory[]) {
      const r = I.applyInMode(CATALOG, inv, "bestand", prep, choose("gerade-342"));
      expectRejectedUnchanged(E, r, prep);
      expect(r.rejection?.partId).toBe("gerade-342");
      expect(r.rejection?.name).toBe("Gerade 342");
      expect(r.rejection?.text).toContain("Gerade 342");
    }
    for (const inv of [{ "gerade-342": 1 }, MACH8] as Inventory[]) {
      const r = I.applyInMode(CATALOG, inv, "bestand", prep, choose("gerade-342"));
      expect(r.rejection).toBeUndefined();
      expectSameState(E, r.state, E.apply(CATALOG, prep, choose("gerade-342")));
      expect(partsOf(r.state.elements)).toEqual(["gerade-342"]);
    }
  });

  test("[REQ-MODUS-3] Verbrauch vor dem Befehl nicht bestimmbar: die Sperre prüft jedes Teil der neuen Folge, nicht nur das neue", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    // [unbekannt, Gerade 342, Gerade 342]: das unbekannte Element durch Gerade 342 ersetzen
    const s = loaded(E, [
      { id: "u", part: UNKNOWN_ID },
      { id: "g1", part: "gerade-342" },
      { id: "g2", part: "gerade-342" },
    ]);
    const prep = run(E, s, [select("u"), { type: "setAction", action: "ersetzen" }]);
    const ok = I.applyInMode(CATALOG, { "gerade-342": 3 }, "bestand", prep, choose("gerade-342"));
    expect(ok.rejection).toBeUndefined();
    expect(partsOf(ok.state.elements)).toEqual(Array(3).fill("gerade-342"));
    const short = I.applyInMode(
      CATALOG,
      { "gerade-342": 2 },
      "bestand",
      prep,
      choose("gerade-342"),
    );
    expectRejectedUnchanged(E, short, prep);
    expect(short.rejection?.partId).toBe("gerade-342");

    // ein vorhandenes, schon überzogenes Teil zählt vorher als 0 und damit als gestiegen
    const withCurve = loaded(E, [
      { id: "u", part: UNKNOWN_ID },
      { id: "k", part: "kurve-1-90", turn: "links" },
    ]);
    const prepCurve = run(E, withCurve, [select("u"), { type: "setAction", action: "ersetzen" }]);
    const curveShort = I.applyInMode(
      CATALOG,
      { "gerade-342": 5 },
      "bestand",
      prepCurve,
      choose("gerade-342"),
    );
    expectRejectedUnchanged(E, curveShort, prepCurve);
    expect(curveShort.rejection?.partId).toBe("kurve-1-90");
    expect(curveShort.rejection?.name).toBe("Kurve 1/90°");
    const curveOk = I.applyInMode(
      CATALOG,
      { "gerade-342": 1, "kurve-1-90": 1 },
      "bestand",
      prepCurve,
      choose("gerade-342"),
    );
    expect(curveOk.rejection).toBeUndefined();
    expect(partsOf(curveOk.state.elements)).toEqual(["gerade-342", "kurve-1-90"]);
  });

  test("[REQ-MODUS-3] Eigenschaft: vorher nicht bestimmbar, nachher bestimmbar → abgewiesen genau dann, wenn ein Teil mit Verbrauch über dem Bestand liegt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const placeable = E.paletteEntries(CATALOG)
      .filter((e) => e.kind === "platzierbar")
      .map((e) => e.partId);
    fc.assert(
      fc.property(
        catalogElementsArb,
        fc.constantFrom(...placeable),
        anyInventoryArb,
        fc.nat(),
        (rest, part, inventory, pos) => {
          // genau ein unbekanntes Element an beliebiger Stelle; Querungen auf es gibt es nicht
          const onlyParts = rest.filter((el) => "part" in el);
          const at = pos % (onlyParts.length + 1);
          const elements: Elements = [
            ...onlyParts.slice(0, at),
            { id: "u", part: UNKNOWN_ID },
            ...onlyParts.slice(at),
          ];
          const prep = run(E, loaded(E, elements), [
            select("u"),
            { type: "setAction", action: "ersetzen" },
          ]);
          const viaM2 = E.apply(CATALOG, prep, choose(part));
          const after = usage(viaM2.elements);
          const over = Object.entries(after).some(([p, n]) => n > 0 && n > countIn(inventory, p));
          const r = I.applyInMode(CATALOG, inventory, "bestand", prep, choose(part));
          expect(r.rejection !== undefined).toBe(over);
          if (over) expectRejectedUnchanged(E, r, prep);
          else expectSameState(E, r.state, viaM2);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("[REQ-MODUS-3] Befehle ohne Folgeänderung (Auswahl, Aktion, Leistenrichtung) wirken wie in M2", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const s = loaded(E, OVAL);
    const commands: ReadonlyArray<Command> = [
      select("o2"),
      { type: "selectNext" },
      { type: "selectPrevious" },
      { type: "setAction", action: "ersetzen" },
      { type: "togglePaletteTurn" },
      { type: "clearSelection" },
      choose("looping"), // nicht platzierbar: unwirksam wie in M2
      choose(UNKNOWN_ID),
    ];
    let a = s;
    let b = s;
    for (const c of commands) {
      const r = I.applyInMode(CATALOG, {}, "bestand", a, c);
      expect(r.rejection, c.type).toBeUndefined();
      a = r.state;
      b = E.apply(CATALOG, b, c);
      expectSameState(E, a, b);
    }
  });
});

describe("Laden, Neu, Rückgängig im Bestandsmodus", () => {
  test("[REQ-MODUS-4] Bestand Ausbauset 3, Oval geladen (Kurve überzogen um 4): Kurve anhängen abgewiesen, Gerade 342 wirkt, Kurve löschen wirkt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const load = I.applyInMode(CATALOG, AUSBAU3, "bestand", E.initialState(), {
      type: "load",
      elements: OVAL,
    });
    expect(load.rejection).toBeUndefined();
    expect(load.state.elements).toEqual(OVAL);
    expect(overdrawn(AUSBAU3, load.state.elements)).toBe(true);

    expectRejectedUnchanged(
      E,
      I.applyInMode(CATALOG, AUSBAU3, "bestand", load.state, choose("kurve-1-90")),
      load.state,
    );
    const g = I.applyInMode(CATALOG, AUSBAU3, "bestand", load.state, choose("gerade-342"));
    expect(g.rejection).toBeUndefined();
    expect(g.state.elements).toHaveLength(7);
    const sel = E.apply(CATALOG, load.state, select("o1"));
    const del = I.applyInMode(CATALOG, AUSBAU3, "bestand", sel, { type: "deleteSelected" });
    expect(del.rejection).toBeUndefined();
    expect(del.state.elements).toEqual(OVAL.slice(1));
  });

  test("[REQ-MODUS-4] Neu, Rückgängig und Wiederholen werden nie wegen des Bestands abgewiesen, auch wenn der Verbrauch steigt", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    // in der Sandbox fünf Geraden, eine gelöscht
    const five = run(
      E,
      E.initialState(),
      Array.from({ length: 5 }, () => choose("gerade-342")),
    );
    const four = run(E, five, [select(five.elements[0]?.id as string), { type: "deleteSelected" }]);
    for (const inventory of [MACH8, {}] as Inventory[]) {
      const undo = I.applyInMode(CATALOG, inventory, "bestand", four, { type: "undo" });
      expect(undo.rejection).toBeUndefined();
      expectSameState(E, undo.state, E.apply(CATALOG, four, { type: "undo" }));
      expect(undo.state.elements).toHaveLength(5);
      const redo = I.applyInMode(CATALOG, inventory, "bestand", undo.state, { type: "redo" });
      expect(redo.rejection).toBeUndefined();
      expect(redo.state.elements).toHaveLength(4);
      const fresh = I.applyInMode(CATALOG, inventory, "bestand", four, { type: "new" });
      expect(fresh.rejection).toBeUndefined();
      expect(fresh.state.elements).toEqual([]);
      const loadAgain = I.applyInMode(CATALOG, inventory, "bestand", fresh.state, {
        type: "load",
        elements: ACHT,
      });
      expect(loadAgain.rejection).toBeUndefined();
      expect(loadAgain.state.elements).toEqual(ACHT);
    }
  });
});

describe("Leiste im Bestandsmodus", () => {
  type Row = Pick<StockPaletteEntry, "partId" | "kind" | "stock" | "rest" | "locked">;
  const rows = (entries: ReadonlyArray<StockPaletteEntry>): Row[] =>
    entries.map(({ partId, kind, stock, rest, locked }) => ({ partId, kind, stock, rest, locked }));
  const nameOf = (id: string): string => CATALOG.find((e) => e.id === id)?.name as string;

  test("[REQ-MODUS-5] Beispiel Bestand Mach 8, Folge Oval: Einträge, Bestand, Rest, gesperrt", async () => {
    const I = await loadInventory();
    const entries = I.stockPalette(CATALOG, MACH8, OVAL);
    const p = (partId: string, stock: number, rest: number): Row => ({
      partId,
      kind: "platzierbar",
      stock,
      rest,
      locked: false,
    });
    expect(rows(entries)).toEqual([
      p("gerade-342", 4, 2),
      p("gerade-114", 1, 1),
      p("kurve-1-90", 6, 2),
      p("engstelle", 1, 1),
      p("kreuzung", 1, 1),
      p("anschlussstueck", 1, 1),
      p("rundenzaehler", 1, 1),
      { partId: "looping-teil", kind: "ausgeblendet", stock: 8, rest: 8, locked: false },
      { partId: "steilkehre-teil", kind: "ausgeblendet", stock: 4, rest: 4, locked: false },
      { partId: "looping", kind: "masseFehlen", stock: undefined, rest: undefined, locked: false },
      {
        partId: "steilkehre",
        kind: "masseFehlen",
        stock: undefined,
        rest: undefined,
        locked: false,
      },
    ]);
    for (const e of entries) expect(e.name).toBe(nameOf(e.partId));
  });

  test("[REQ-MODUS-5] Bestand Ausbauset 3: beide Baugruppen entfallen; nicht platzierbare Teile sind nie gesperrt (gilt vor und nach Vermessung #1)", async () => {
    const I = await loadInventory();
    const entries = I.stockPalette(CATALOG, AUSBAU3, []);
    expect(entries.map((e) => [e.partId, e.stock, e.rest, e.locked])).toEqual([
      ["gerade-342", 8, 8, false],
      ["kurve-1-45", 4, 4, false],
      ["steilkurve-1-45", 4, 4, false],
    ]);
    // L-Teil (Maße fehlen, ausgeblendet) per Laden verbraucht: Rest −1, aber nicht platzierbar
    // → nicht gesperrt
    const withL: Inventory = { ...AUSBAU3, "looping-teil": 4 };
    const loadedL: Elements = Array.from({ length: 5 }, (_, i) => ({
      id: `l${i}`,
      part: "looping-teil",
    }));
    const l = I.stockPalette(CATALOG, withL, loadedL).find((e) => e.partId === "looping-teil");
    expect(l).toMatchObject({ kind: "ausgeblendet", stock: 4, rest: -1, locked: false });
    expect(I.stockPalette(CATALOG, {}, [])).toEqual([]);
  });

  test("[REQ-MODUS-5] Bestand Ausbauset 3 nach Vermessung #1: Steilkurve platzierbar mit Rest; nach vier Steilkurven Rest 0 und gesperrt, fünf geladen Rest −1 gesperrt", async () => {
    const I = await loadInventory();
    expect(rows(I.stockPalette(CATALOG, AUSBAU3, []))).toEqual([
      { partId: "gerade-342", kind: "platzierbar", stock: 8, rest: 8, locked: false },
      { partId: "kurve-1-45", kind: "platzierbar", stock: 4, rest: 4, locked: false },
      { partId: "steilkurve-1-45", kind: "platzierbar", stock: 4, rest: 4, locked: false },
    ]);
    const steile = (n: number): Elements =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        part: "steilkurve-1-45",
        turn: "links" as const,
      }));
    const steilOf = (n: number) =>
      I.stockPalette(CATALOG, AUSBAU3, steile(n)).find((e) => e.partId === "steilkurve-1-45");
    expect(steilOf(3)).toMatchObject({ kind: "platzierbar", stock: 4, rest: 1, locked: false });
    expect(steilOf(4)).toMatchObject({ kind: "platzierbar", stock: 4, rest: 0, locked: true });
    expect(steilOf(5)).toMatchObject({ kind: "platzierbar", stock: 4, rest: -1, locked: true });
    // Wireless Upgrade Kit: Wireless-Anschluss platzierbar mit Rest 1
    expect(rows(I.stockPalette(CATALOG, WIRELESS, []))).toEqual([
      { partId: "wireless-anschluss", kind: "platzierbar", stock: 1, rest: 1, locked: false },
    ]);
  });

  test("[REQ-MODUS-5] Rest ≤ 0 sperrt platzierbare Einträge, auch negativ; Baugruppen nach Bestand ihrer Bestandteile", async () => {
    const I = await loadInventory();
    const fourStraights: Elements = Array.from({ length: 4 }, (_, i) => ({
      id: `g${i}`,
      part: "gerade-342",
    }));
    expect(I.stockPalette(CATALOG, MACH8, fourStraights)[0]).toMatchObject({
      partId: "gerade-342",
      stock: 4,
      rest: 0,
      locked: true,
    });
    const nineCurves: Elements = Array.from({ length: 9 }, (_, i) => ({
      id: `k${i}`,
      part: "kurve-1-90",
      turn: "links" as const,
    }));
    expect(
      I.stockPalette(CATALOG, MACH8, nineCurves).find((e) => e.partId === "kurve-1-90"),
    ).toMatchObject({ stock: 6, rest: -3, locked: true });

    const ids = (inv: Inventory): string[] => I.stockPalette(CATALOG, inv, []).map((e) => e.partId);
    // Steilkehre braucht 4 K + 2 Kurven 1/90°, Looping 8 L — Bestand, nicht Rest, entscheidet
    expect(ids({ "steilkehre-teil": 4, "kurve-1-90": 2 })).toContain("steilkehre");
    expect(ids({ "steilkehre-teil": 4, "kurve-1-90": 1 })).not.toContain("steilkehre");
    expect(ids({ "steilkehre-teil": 3, "kurve-1-90": 6 })).not.toContain("steilkehre");
    expect(ids({ "looping-teil": 8 })).toContain("looping");
    expect(ids({ "looping-teil": 7 })).not.toContain("looping");
    const steilkehreUsed = I.stockPalette(CATALOG, MACH8, [
      { id: "a", part: "steilkehre" },
      { id: "b", part: "steilkehre" },
    ]);
    expect(steilkehreUsed.map((e) => e.partId)).toContain("steilkehre");
    expect(steilkehreUsed.find((e) => e.partId === "steilkehre-teil")).toMatchObject({
      stock: 4,
      rest: -4,
      locked: false,
    });
  });

  test("[REQ-MODUS-5] Verbrauch nicht bestimmbar: alle platzierbaren gesperrt, Rest unbestimmt", async () => {
    const I = await loadInventory();
    const entries = I.stockPalette(CATALOG, MACH8, [...OVAL, { id: "u", part: UNKNOWN_ID }]);
    expect(entries.map((e) => e.partId)).toEqual(
      I.stockPalette(CATALOG, MACH8, OVAL).map((e) => e.partId),
    );
    for (const e of entries) {
      expect({ id: e.partId, rest: e.rest }).toEqual({ id: e.partId, rest: undefined });
      expect({ id: e.partId, locked: e.locked }).toEqual({
        id: e.partId,
        locked: e.kind === "platzierbar",
      });
    }
    expect(entries.find((e) => e.partId === "kurve-1-90")?.stock).toBe(6);
  });

  test("[REQ-MODUS-5] nicht zählende Bestandseinträge (REQ-BEST-7) erscheinen nicht und zählen nicht", async () => {
    const I = await loadInventory();
    const inv: Inventory = { ...MACH8, steilkehre: 5, looping: 3, [UNKNOWN_ID]: 9 };
    expect(I.stockPalette(CATALOG, inv, OVAL)).toEqual(I.stockPalette(CATALOG, MACH8, OVAL));
    expect(I.stockPalette(CATALOG, { steilkehre: 5, [UNKNOWN_ID]: 9 }, [])).toEqual([]);
  });

  test("[REQ-MODUS-5] gesperrt heißt genau: Antippen würde im Modus „Bestand“ abgewiesen", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const cases: ReadonlyArray<readonly [Inventory, Elements]> = [
      [MACH8, []],
      [MACH8, OVAL],
      [MACH8, ACHT],
      [AUSBAU3, OVAL],
      [{ "gerade-342": 1 }, [{ id: "g", part: "gerade-342" }]],
      [MACH8, [{ id: "u", part: UNKNOWN_ID }]],
    ];
    for (const [inv, elements] of cases) {
      const s = loaded(E, elements);
      for (const e of I.stockPalette(CATALOG, inv, elements)) {
        if (e.kind !== "platzierbar") continue;
        const r = I.applyInMode(CATALOG, inv, "bestand", s, choose(e.partId));
        expect({ id: e.partId, rejected: r.rejection !== undefined }).toEqual({
          id: e.partId,
          rejected: e.locked,
        });
      }
    }
  });
});

describe("Invariante des Bestandsmodus", () => {
  /** Startfolge aus Katalogteilen und ein Bestand, der sie deckt (Verbrauch + Zuschlag). */
  const startArb = fc
    .tuple(
      catalogElementsArb,
      fc.dictionary(fc.constantFrom(...CATALOG.map((e) => e.id)), fc.nat({ max: 2 }), {
        maxKeys: 6,
      }),
    )
    .map(([elements, extra]) => ({ elements, inventory: plus(usage(elements), extra) }));
  const commandsArb = fc.array(
    anyCommandArb.filter((g) => g.type !== "load"),
    { maxLength: 30 },
  );

  const holds = (
    E: EditorApi,
    I: InventoryApi,
    mode: Mode,
    start: { elements: Elements; inventory: Inventory },
    gens: ReadonlyArray<GenCommand>,
  ): boolean => {
    let s = loaded(E, start.elements);
    if (overdrawn(start.inventory, s.elements)) throw new Error("Start überzogen");
    for (const g of gens) {
      s = I.applyInMode(CATALOG, start.inventory, mode, s, resolve(s, g)).state;
      if (overdrawn(start.inventory, s.elements)) return false;
    }
    return true;
  };

  test("[REQ-MODUS-6] Eigenschaft: aus einer nicht überzogenen Folge entsteht im Bestandsmodus nie eine überzogene; Gegenprobe Sandbox", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    fc.assert(
      fc.property(startArb, commandsArb, (start, gens) => {
        expect(holds(E, I, "bestand", start, gens)).toBe(true);
      }),
      { numRuns: 300 },
    );
    // Gegenprobe: derselbe Generator findet in der Sandbox ein Gegenbeispiel
    const sandbox = fc.check(
      fc.property(startArb, commandsArb, (start, gens) => holds(E, I, "sandbox", start, gens)),
      { numRuns: 300 },
    );
    expect(sandbox.failed).toBe(true);
  });
});

describe("Nachtrag #1: Wireless-Anschluss und Steilkurve 1/45° im Bestandsmodus", () => {
  test("[REQ-MODUS-3] Bestand Ausbauset 3 + Wireless Upgrade Kit: vier Steilkurven und ein Wireless-Anschluss werden angehängt, die fünfte Steilkurve und der zweite Wireless-Anschluss abgewiesen", async () => {
    const E = await loadEditor();
    const I = await loadInventory();
    const inv = plus(AUSBAU3, WIRELESS);
    const { state, results } = runIn(I, inv, "bestand", E.initialState(), [
      ...Array.from({ length: 5 }, () => choose("steilkurve-1-45")),
      choose("wireless-anschluss"),
      choose("wireless-anschluss"),
    ]);
    expect(partsOf(state.elements)).toEqual([
      ...Array(4).fill("steilkurve-1-45"),
      "wireless-anschluss",
    ]);
    expect(results.map((r) => r.rejection?.partId)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "steilkurve-1-45",
      undefined,
      "wireless-anschluss",
    ]);
    expect(results[4]?.rejection?.name).toBe("Steilkurve 1/45°");
    expect(results[6]?.rejection?.name).toBe("Wireless-Anschluss");
    // Sandbox: dieselben Befehle wirken alle
    const sandbox = runIn(I, inv, "sandbox", E.initialState(), [
      ...Array.from({ length: 5 }, () => choose("steilkurve-1-45")),
      choose("wireless-anschluss"),
      choose("wireless-anschluss"),
    ]);
    expect(sandbox.state.elements).toHaveLength(7);
  });
});
