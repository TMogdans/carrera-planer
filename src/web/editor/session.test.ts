/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Editor-Logik — Speichern und Laden, Export und
 * Import. Abnahmetests REQ-STORE-1 bis REQ-STORE-11.
 *
 * Schnittstelle (Typen: src/web/test-support/editor-fixtures.ts), Modul `src/web/editor/session.ts`:
 *   STORAGE_PREFIX: string, WORKING_KEY: string, layoutKey(name): string
 *   createSession({ catalog, storage, clock }): Session
 *     Beim Erzeugen: Arbeitsstand von WORKING_KEY laden (REQ-STORE-2), kaputten Arbeitsstand
 *     verschieben (REQ-STORE-7).
 *   Session (Getter state, name, messages spiegeln den aktuellen Stand):
 *     dispatch(command)             Befehl aus editor.ts; nach wirksamem Befehl Autosicherung
 *     saveAs(name, { overwrite }?)  → { ok: true } | { ok: false, reason: nameLeer|existiert|speicherFehler }
 *     savedNames(), load(name), deleteSaved(name)
 *     defectBackups(), defectRawText(key), deleteDefect(key)
 *     exportFile() → { fileName, text }, importFile(fileName, text)
 *   Fehler landen als EditorMessage in `messages` (angehängt), nie als Ausnahme.
 *   Speicher = Web-Storage-Verhalten (getItem/setItem/removeItem/key/length), Uhr liefert
 *   { utc: Date, local: { year, month, day, hour, minute } }.
 *
 * Bestätigungsdialoge (Überschreiben, Löschen) sind UI; die Logik verlangt fürs Überschreiben
 * `overwrite: true` und löscht auf Aufruf.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  ACHT,
  ACHT_G171,
  CATALOG,
  type Command,
  decodeLayout,
  editCommandArb,
  fixedClock,
  type LayoutElement,
  layoutJson,
  loadEditor,
  loadSession,
  loadStatus,
  MemoryStorage,
  OVAL,
  resolve,
  type Session,
  type SessionApi,
  schemaReason,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

const ISO = "2026-11-24T07:15:00.000Z";
const clock = fixedClock(ISO);

const open = (api: SessionApi, storage: MemoryStorage, c = clock): Session =>
  api.createSession({ catalog: CATALOG, storage, clock: c });

const withLayout = (api: SessionApi, storage: MemoryStorage, elements: Elements): Session => {
  const s = open(api, storage);
  s.dispatch({ type: "load", elements });
  return s;
};

const lastMessage = (s: Session) => s.messages[s.messages.length - 1];

/** Kaputte gespeicherte Werte mit Grund (REQ-STORE-5). */
const BROKEN_SCHEMA: ReadonlyArray<readonly [string, string]> = [
  ["schemaVersion fehlt", JSON.stringify({ elements: [] })],
  ["fremde Schema-Version", JSON.stringify({ schemaVersion: 2, elements: [] })],
  ["unbekanntes Zusatzfeld", JSON.stringify({ schemaVersion: 1, elements: [], name: "Oval" })],
  [
    "Zusatzfeld im Element",
    JSON.stringify({ schemaVersion: 1, elements: [{ id: "a", part: "gerade-342", farbe: "rot" }] }),
  ],
  ["falscher Typ", JSON.stringify({ schemaVersion: 1, elements: "gerade" })],
  [
    "doppelte Element-ID",
    JSON.stringify({
      schemaVersion: 1,
      elements: [
        { id: "a", part: "gerade-342" },
        { id: "a", part: "gerade-342" },
      ],
    }),
  ],
  [
    "leere Element-ID",
    JSON.stringify({ schemaVersion: 1, elements: [{ id: "", part: "gerade-342" }] }),
  ],
];
const NOT_JSON = "{ schemaVersion: 1, elements: [";

describe("Speichern und Laden", () => {
  test.skip("[REQ-STORE-1] Gespeichert wird genau das kodierte Layout als JSON (schemaVersion, elements), sonst nichts", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const s = withLayout(api, storage, ACHT);
    const working = storage.data.get(api.WORKING_KEY);
    expect(working).toBeDefined();
    expect(JSON.parse(working as string)).toStrictEqual(layoutJson(ACHT));
    expect(decodeLayout(JSON.parse(working as string))._tag).toBe("Right");

    expect(s.saveAs("Acht")).toEqual({ ok: true });
    const named = storage.data.get(api.layoutKey("Acht"));
    expect(JSON.parse(named as string)).toStrictEqual(layoutJson(ACHT));
    // jeder Wert im Speicher ist ein Layout (keine Hülle, kein Name im Wert)
    for (const [key, value] of storage.data) {
      expect(JSON.parse(value), key).toStrictEqual(layoutJson(ACHT));
    }
    expect(api.layoutKey("Acht")).toContain("Acht");
  });

  test.skip("[REQ-STORE-2] Nach jedem wirksamen Befehl Autosicherung unter festem Schlüssel; beim Start wird sie geladen", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    expect(s.state.elements).toEqual([]);
    expect(s.messages).toEqual([]);
    const commands: ReadonlyArray<Command> = [
      { type: "choosePart", partId: "kurve-1-90" },
      { type: "choosePart", partId: "gerade-342" },
      { type: "togglePaletteTurn" },
      { type: "choosePart", partId: "kurve-1-45" },
    ];
    for (const c of commands) {
      s.dispatch(c);
      expect(JSON.parse(storage.data.get(api.WORKING_KEY) as string)).toStrictEqual(
        layoutJson(s.state.elements),
      );
    }
    s.dispatch({ type: "select", id: (s.state.elements[0] as LayoutElement).id });
    s.dispatch({ type: "deleteSelected" });
    expect(JSON.parse(storage.data.get(api.WORKING_KEY) as string)).toStrictEqual(
      layoutJson(s.state.elements),
    );
    const reopened = open(api, storage);
    expect(reopened.state.elements).toEqual(s.state.elements);
    expect(reopened.messages).toEqual([]);
  });

  test.skip("[REQ-STORE-2] Rückgängig und Wiederholen sichern; Auswahl, Aktion und Leistenrichtung lösen keine Sicherung aus", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    const saved = () => JSON.parse(storage.data.get(api.WORKING_KEY) as string) as unknown;
    s.dispatch({ type: "choosePart", partId: "gerade-342" });
    s.dispatch({ type: "choosePart", partId: "gerade-171" });
    const two = s.state.elements;
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toHaveLength(1);
    expect(saved()).toStrictEqual(layoutJson(s.state.elements));
    // Neuladen nach Rückgängig zeigt den Stand nach dem Rückgängig
    expect(open(api, storage).state.elements).toEqual(s.state.elements);
    s.dispatch({ type: "redo" });
    expect(s.state.elements).toEqual(two);
    expect(saved()).toStrictEqual(layoutJson(two));
    expect(open(api, storage).state.elements).toEqual(two);

    const writes = () =>
      storage.log.filter((o) => (o.op === "set" || o.op === "remove") && o.key === api.WORKING_KEY)
        .length;
    const before = writes();
    const neutral: ReadonlyArray<Command> = [
      { type: "select", id: (two[0] as LayoutElement).id },
      { type: "selectNext" },
      { type: "selectPrevious" },
      { type: "setAction", action: "ersetzen" },
      { type: "setAction", action: "davorEinfuegen" },
      { type: "togglePaletteTurn" },
      { type: "clearSelection" },
    ];
    for (const c of neutral) s.dispatch(c);
    expect(s.state.elements).toEqual(two);
    expect(writes()).toBe(before);
  });

  test.skip("[REQ-STORE-3] Speichern unter Namen: getrimmt, nicht leer, Überschreiben nur bestätigt, alphabetische Liste, Löschen", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const s = withLayout(api, storage, OVAL);
    expect(s.saveAs("  Oval \t")).toEqual({ ok: true });
    expect(s.savedNames()).toEqual(["Oval"]);
    expect(s.name).toBe("Oval");
    expect(storage.data.has(api.layoutKey("Oval"))).toBe(true);

    const before = storage.snapshot();
    expect(s.saveAs("   ")).toEqual({ ok: false, reason: "nameLeer" });
    expect(s.saveAs("")).toEqual({ ok: false, reason: "nameLeer" });
    expect(storage.snapshot()).toEqual(before);

    s.dispatch({ type: "load", elements: ACHT });
    expect(s.saveAs("Oval")).toEqual({ ok: false, reason: "existiert" });
    expect(JSON.parse(storage.data.get(api.layoutKey("Oval")) as string)).toStrictEqual(
      layoutJson(OVAL),
    );
    expect(s.saveAs("Oval", { overwrite: true })).toEqual({ ok: true });
    expect(JSON.parse(storage.data.get(api.layoutKey("Oval")) as string)).toStrictEqual(
      layoutJson(ACHT),
    );

    s.saveAs("Acht");
    s.saveAs("Kreis");
    expect(s.savedNames()).toEqual(["Acht", "Kreis", "Oval"]);
    s.deleteSaved("Kreis");
    expect(s.savedNames()).toEqual(["Acht", "Oval"]);
    // localeCompare „de“, Groß-/Kleinschreibung ignoriert (Codepunkt-Ordnung wäre anders)
    for (const n of ["zebra", "apfel", "Ärger", "kreis", "Bär"]) s.saveAs(n);
    expect(s.savedNames()).toEqual(["Acht", "apfel", "Ärger", "Bär", "kreis", "Oval", "zebra"]);
    expect(storage.data.has(api.layoutKey("Kreis"))).toBe(false);
  });

  test.skip("[REQ-STORE-3] Laden ersetzt die Folge als Befehl (rückgängig machbar) und hebt die Auswahl auf", async () => {
    const api = await loadSession();
    const E = await loadEditor();
    const storage = new MemoryStorage();
    const s = withLayout(api, storage, OVAL);
    s.saveAs("Oval");
    s.dispatch({ type: "load", elements: ACHT });
    s.dispatch({ type: "select", id: "e3" });
    s.load("Oval");
    expect(s.state.elements).toEqual(OVAL);
    expect(s.state.selection).toBeUndefined();
    expect(s.name).toBe("Oval");
    expect(E.canUndo(s.state)).toBe(true);
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toEqual(ACHT);
  });

  test.skip("[REQ-STORE-3] Eigenschaft: jeder nicht leere Name lässt sich speichern und auflisten, ohne Arbeitsstand oder defekte Sicherungen zu berühren", async () => {
    const api = await loadSession();
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string({ minLength: 1, maxLength: 20 }).filter((n) => n.trim().length > 0),
          { minLength: 1, maxLength: 5, selector: (n) => n.trim() },
        ),
        (names) => {
          const storage = new MemoryStorage();
          const s = withLayout(api, storage, OVAL);
          const working = storage.data.get(api.WORKING_KEY);
          for (const n of names) expect(s.saveAs(n)).toEqual({ ok: true });
          expect([...s.savedNames()].sort()).toEqual(names.map((n) => n.trim()).sort());
          expect(storage.data.get(api.WORKING_KEY)).toBe(working);
          expect(s.defectBackups()).toEqual([]);
        },
      ),
    );
  });

  test.skip("[REQ-STORE-4] Eigenschaft: Speichern und Laden ergibt exakt dieselbe Folge", async () => {
    const api = await loadSession();
    fc.assert(
      fc.property(fc.array(editCommandArb, { maxLength: 30 }), (gens) => {
        const storage = new MemoryStorage();
        const s = open(api, storage);
        for (const g of gens) s.dispatch(resolve(s.state, g));
        const built = s.state.elements;
        expect(s.saveAs("Probe", { overwrite: true })).toEqual({ ok: true });
        s.dispatch({ type: "new" });
        s.load("Probe");
        expect(s.state.elements).toStrictEqual(JSON.parse(JSON.stringify(built)));
        expect(s.state.elements).toEqual(built);
      }),
      { numRuns: 100 },
    );
  });

  test.skip("[REQ-STORE-5] Kaputter gespeicherter Wert: Laden scheitert laut mit Name und Schema-Grund, nichts verändert oder gelöscht", async () => {
    const api = await loadSession();
    const E = await loadEditor();
    for (const [label, raw] of [...BROKEN_SCHEMA, ["kein JSON", NOT_JSON] as const]) {
      const storage = new MemoryStorage();
      const s = withLayout(api, storage, ACHT);
      storage.data.set(api.layoutKey("Kaputt"), raw);
      const before = storage.snapshot();
      const undoBefore = E.canUndo(s.state);
      s.load("Kaputt");
      expect(s.state.elements, label).toEqual(ACHT);
      expect(E.canUndo(s.state)).toBe(undoBefore);
      s.dispatch({ type: "undo" });
      expect(s.state.elements, `${label}: kein Verlaufseintrag`).toEqual([]);
      expect(storage.data.get(api.layoutKey("Kaputt")), label).toBe(raw);
      for (const [k, v] of before) {
        if (k !== api.WORKING_KEY) expect(storage.data.get(k)).toBe(v);
      }
      const m = s.messages.find((x) => x.kind === "ladenFehlgeschlagen");
      expect(m, label).toBeDefined();
      if (m?.kind !== "ladenFehlgeschlagen") continue;
      expect(m.name).toBe("Kaputt");
      expect(m.text).toContain("Kaputt");
      expect(m.reason.length).toBeGreaterThan(0);
      if (raw !== NOT_JSON) expect(m.reason, label).toContain(schemaReason(raw));
    }
  });

  test.skip("[REQ-STORE-6] Schema-gültig, aber Kern-Fehler: wird geladen, Fehler erscheinen wie bei der Bearbeitung", async () => {
    const api = await loadSession();
    const S = await loadStatus();
    const cases: ReadonlyArray<readonly [Elements, string]> = [
      [[...OVAL, { id: "l", part: "looping" }], "Maße fehlen, nicht platzierbar"],
      [[{ id: "u", part: "gibt-es-nicht" }], "Teil unbekannt"],
      [[{ id: "k", part: "kurve-1-90" }], "Kurvenrichtung fehlt"],
      [ACHT.slice(1), "Querung verweist auf keine frühere Kreuzung"],
      [ACHT_G171, "Strecke kommt nicht am Queranschluss an"],
    ];
    for (const [elements, text] of cases) {
      const storage = new MemoryStorage();
      const s = open(api, storage);
      storage.data.set(api.layoutKey("X"), JSON.stringify(layoutJson(elements)));
      s.load("X");
      expect(s.state.elements).toEqual(elements);
      expect(s.messages.filter((m) => m.kind === "ladenFehlgeschlagen")).toEqual([]);
      expect(S.errorEntries(CATALOG, s.state.elements).map((e) => e.text)).toContain(text);
    }
  });

  test.skip("[REQ-STORE-7] Kaputter Arbeitsstand beim Start: Rohtext unverändert unter Ausweichschlüssel mit UTC-Zeitstempel, Start leer, Meldung, normales Weitersichern", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: 2, elements: [] });
    storage.data.set(api.WORKING_KEY, raw);
    const s = open(api, storage);
    const backupKey = `${api.STORAGE_PREFIX}:defekt:${ISO}`;
    expect(storage.data.get(backupKey)).toBe(raw);
    expect(s.state.elements).toEqual([]);
    const m = lastMessage(s);
    expect(m?.kind).toBe("arbeitsstandVerschoben");
    if (m?.kind === "arbeitsstandVerschoben") {
      expect(m.backupKey).toBe(backupKey);
      expect(m.text).toContain(backupKey);
      expect(m.reason).toContain(schemaReason(raw));
    }
    // Reihenfolge: erst Ausweichschlüssel geschrieben, dann erst Arbeitsstand angefasst
    const backupWrite = storage.log.findIndex((o) => o.op === "set" && o.key === backupKey);
    const workingTouch = storage.log.findIndex(
      (o) => (o.op === "set" || o.op === "remove") && o.key === api.WORKING_KEY,
    );
    expect(backupWrite).toBeGreaterThanOrEqual(0);
    if (workingTouch >= 0) expect(workingTouch).toBeGreaterThan(backupWrite);
    // danach normales Sichern
    s.dispatch({ type: "choosePart", partId: "gerade-342" });
    expect(JSON.parse(storage.data.get(api.WORKING_KEY) as string)).toStrictEqual(
      layoutJson(s.state.elements),
    );
    expect(storage.data.get(backupKey)).toBe(raw);
  });

  test.skip("[REQ-STORE-7] Belegter Ausweichschlüssel: -2, -3 …, ein früherer Fund wird nie überschrieben; auflisten, Rohtext, löschen, nicht ladbar", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const base = `${api.STORAGE_PREFIX}:defekt:${ISO}`;
    const raws = [
      NOT_JSON,
      "kaputt 2",
      JSON.stringify({ schemaVersion: 1, elements: [{ id: "" }] }),
    ];
    for (const raw of raws) {
      storage.data.set(api.WORKING_KEY, raw);
      open(api, storage); // gleiche Uhrzeit bei jedem Start
    }
    expect(storage.data.get(base)).toBe(raws[0]);
    expect(storage.data.get(`${base}-2`)).toBe(raws[1]);
    expect(storage.data.get(`${base}-3`)).toBe(raws[2]);

    storage.data.delete(api.WORKING_KEY);
    const s = open(api, storage);
    expect([...s.defectBackups()].sort()).toEqual([base, `${base}-2`, `${base}-3`].sort());
    expect(s.defectRawText(`${base}-2`)).toBe("kaputt 2");
    // defekte Sicherungen und der Arbeitsstand sind keine ladbaren Layouts
    expect(s.savedNames()).toEqual([]);
    s.deleteDefect(`${base}-2`);
    expect(storage.data.has(`${base}-2`)).toBe(false);
    expect(storage.data.get(base)).toBe(raws[0]);
    expect([...s.defectBackups()].sort()).toEqual([base, `${base}-3`].sort());
  });

  test.skip("[REQ-STORE-7] Scheitert das Verschieben, bleibt der kaputte Wert unter dem Arbeitsstand-Schlüssel und wird in der Sitzung nicht überschrieben", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    storage.data.set(api.WORKING_KEY, NOT_JSON);
    storage.fail = (op, key) => op === "set" && key.includes(":defekt:");
    const s = open(api, storage);
    expect(s.state.elements).toEqual([]);
    const m = lastMessage(s);
    expect(m?.kind).toBe("arbeitsstandNichtVerschoben");
    expect(m?.text.length).toBeGreaterThan(0);
    s.dispatch({ type: "choosePart", partId: "gerade-342" });
    s.dispatch({ type: "choosePart", partId: "gerade-171" });
    expect(s.state.elements).toHaveLength(2); // bedienbar
    expect(storage.data.get(api.WORKING_KEY)).toBe(NOT_JSON);
  });

  test.skip("[REQ-STORE-8] Speicher wirft (lesen/schreiben/aufzählen): Meldung, Folge bleibt im Speicher der Seite, keine Ausnahme", async () => {
    const api = await loadSession();
    // Lesen beim Start scheitert
    const r = new MemoryStorage();
    r.fail = () => true;
    let s: Session | undefined;
    expect(() => {
      s = open(api, r);
    }).not.toThrow();
    expect(s?.state.elements).toEqual([]);
    expect(s?.messages.some((m) => m.kind === "speicherFehler")).toBe(true);

    // Schreiben scheitert: Befehle wirken weiter, Meldung
    const w = new MemoryStorage();
    const t = open(api, w);
    w.fail = (op) => op === "set";
    expect(() => t.dispatch({ type: "load", elements: OVAL })).not.toThrow();
    expect(t.state.elements).toEqual(OVAL);
    expect(t.messages.some((m) => m.kind === "speicherFehler")).toBe(true);
    expect(() => t.dispatch({ type: "choosePart", partId: "gerade-114" })).not.toThrow();
    expect(t.state.elements).toHaveLength(7);
    let saved: unknown;
    expect(() => {
      saved = t.saveAs("Oval");
    }).not.toThrow();
    expect(saved).toEqual({ ok: false, reason: "speicherFehler" });

    // Aufzählen und Laden scheitern
    w.fail = () => true;
    expect(() => t.savedNames()).not.toThrow();
    expect(t.savedNames()).toEqual([]);
    expect(() => t.defectBackups()).not.toThrow();
    const count = t.messages.length;
    expect(() => t.load("Oval")).not.toThrow();
    expect(t.state.elements).toHaveLength(7);
    expect(t.messages.length).toBeGreaterThan(count);
    expect(() => t.exportFile()).not.toThrow();
  });
});

describe("Export und Import", () => {
  test.skip("[REQ-STORE-9] Export: Text = kodiertes Layout als JSON; Dateiname aus dem zuletzt verwendeten Namen", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const s = withLayout(api, storage, ACHT);
    s.saveAs(" Acht ");
    const file = s.exportFile();
    expect(file.fileName).toBe("Acht.json");
    expect(JSON.parse(file.text)).toStrictEqual(layoutJson(ACHT));
    expect(decodeLayout(JSON.parse(file.text))._tag).toBe("Right");

    storage.data.set(api.layoutKey("Oval"), JSON.stringify(layoutJson(OVAL)));
    s.load("Oval");
    expect(s.exportFile().fileName).toBe("Oval.json");
    s.importFile("Bogen.JSON", JSON.stringify(layoutJson(OVAL.slice(0, 2))));
    expect(s.exportFile().fileName).toBe("Bogen.json");
  });

  test.skip("[REQ-STORE-9] Dateiname: verbotene Zeichen, C0 und DEL werden zu _, C1 bleibt", async () => {
    const api = await loadSession();
    const s = withLayout(api, new MemoryStorage(), OVAL);
    s.saveAs('a/b\\c:d*e?f"g<h>i|j\u0001k\u001fl\u007fm\u0000n');
    expect(s.exportFile().fileName).toBe("a_b_c_d_e_f_g_h_i_j_k_l_m_n.json");
    // C1-Zeichen (U+0080–U+009F) bleiben erhalten
    s.saveAs("x\u0085y\u009fz");
    expect(s.exportFile().fileName).toBe("x\u0085y\u009fz.json");
  });

  test.skip("[REQ-STORE-9] Ohne Namen: strecke-JJJJ-MM-TT-HHmm.json aus den lokalen Bestandteilen der Uhr, nie aus UTC", async () => {
    const api = await loadSession();
    const at = (
      iso: string,
      local: { year: number; month: number; day: number; hour: number; minute: number },
    ) =>
      api.createSession({
        catalog: CATALOG,
        storage: new MemoryStorage(),
        clock: fixedClock(iso, local),
      });
    const a = at("2026-11-24T07:15:00.000Z", {
      year: 2026,
      month: 11,
      day: 24,
      hour: 8,
      minute: 15,
    });
    a.dispatch({ type: "load", elements: OVAL });
    expect(a.exportFile().fileName).toBe("strecke-2026-11-24-0815.json");
    // UTC ist ein anderer Tag als die Ortszeit
    const b = at("2027-01-04T23:07:00.000Z", { year: 2027, month: 1, day: 5, hour: 0, minute: 7 });
    expect(b.exportFile().fileName).toBe("strecke-2027-01-05-0007.json");
    const c = at("2026-03-09T22:59:00.000Z", {
      year: 2026,
      month: 3,
      day: 9,
      hour: 23,
      minute: 59,
    });
    expect(c.exportFile().fileName).toBe("strecke-2026-03-09-2359.json");
    expect(JSON.parse(b.exportFile().text)).toStrictEqual(layoutJson([]));
  });

  test.skip("[REQ-STORE-9] Eigenschaft: Export und anschließender Import ergibt exakt dieselbe Folge, mit und ohne Namen", async () => {
    const api = await loadSession();
    fc.assert(
      fc.property(fc.array(editCommandArb, { maxLength: 30 }), fc.boolean(), (gens, named) => {
        const s = open(api, new MemoryStorage());
        for (const g of gens) s.dispatch(resolve(s.state, g));
        if (named) s.saveAs("Probe", { overwrite: true });
        const built = s.state.elements;
        const file = s.exportFile();
        const target = open(api, new MemoryStorage());
        target.importFile(file.fileName, file.text);
        expect(target.state.elements).toEqual(built);
        expect(target.messages.filter((m) => m.kind === "importFehlgeschlagen")).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  test.skip("[REQ-STORE-10] Import ersetzt die Folge (Befehl, rückgängig machbar, Auswahl aufgehoben), Name ohne .json als Vorschlag, nichts gespeichert", async () => {
    const api = await loadSession();
    const storage = new MemoryStorage();
    const s = withLayout(api, storage, OVAL);
    s.dispatch({ type: "select", id: "o2" });
    s.importFile("Acht.json", JSON.stringify(layoutJson(ACHT), null, 2));
    expect(s.state.elements).toEqual(ACHT);
    expect(s.state.selection).toBeUndefined();
    expect(s.name).toBe("Acht");
    expect(s.savedNames()).toEqual([]);
    expect(storage.data.has(api.layoutKey("Acht"))).toBe(false);
    // Autosicherung läuft wie nach jeder Folgeänderung
    expect(JSON.parse(storage.data.get(api.WORKING_KEY) as string)).toStrictEqual(layoutJson(ACHT));
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toEqual(OVAL);

    for (const [fileName, name] of [
      ["ACHT.JSON", "ACHT"],
      ["acht.Json", "acht"],
      ["strecke-2026-11-24-0815.json", "strecke-2026-11-24-0815"],
      ["strecke.json.bak", "strecke.json.bak"],
      ["ohne-endung", "ohne-endung"],
    ] as const) {
      s.importFile(fileName, JSON.stringify(layoutJson(OVAL)));
      expect(s.name, fileName).toBe(name);
    }
  });

  test.skip("[REQ-STORE-10] Schema-gültige Datei mit Kern-Fehlern wird importiert wie beim Laden", async () => {
    const api = await loadSession();
    const S = await loadStatus();
    const s = open(api, new MemoryStorage());
    const elements: Elements = [...OVAL.slice(0, 3), { id: "l", part: "looping" }];
    s.importFile("Looping.json", JSON.stringify(layoutJson(elements)));
    expect(s.state.elements).toEqual(elements);
    expect(S.errorEntries(CATALOG, s.state.elements).map((e) => e.text)).toEqual([
      "Maße fehlen, nicht platzierbar",
    ]);
  });

  test.skip("[REQ-STORE-11] Gescheiterter Import: Folge, Verlauf, Speicher unverändert; Meldung mit Dateiname und Fehlerart", async () => {
    const api = await loadSession();
    const E = await loadEditor();
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ["foto.jpg", "ÿØÿà\u0000\u0010JFIF", "keine JSON-Datei"],
      ["leer.json", "", "keine JSON-Datei"],
      ["kaputt.json", NOT_JSON, "keine JSON-Datei"],
      [
        "ohne-version.json",
        JSON.stringify({ elements: [] }),
        "keine Strecke dieses Planers oder andere Version",
      ],
      [
        "v2.json",
        JSON.stringify({ schemaVersion: 2, elements: [] }),
        "keine Strecke dieses Planers oder andere Version",
      ],
      [
        "v-text.json",
        JSON.stringify({ schemaVersion: "1", elements: [] }),
        "keine Strecke dieses Planers oder andere Version",
      ],
      [
        "zusatz.json",
        JSON.stringify({ schemaVersion: 1, elements: [], name: "x" }),
        "Strecke ungültig",
      ],
      ["typ.json", JSON.stringify({ schemaVersion: 1, elements: {} }), "Strecke ungültig"],
      [
        "doppelt.json",
        JSON.stringify({
          schemaVersion: 1,
          elements: [
            { id: "a", part: "gerade-114" },
            { id: "a", part: "gerade-114" },
          ],
        }),
        "Strecke ungültig",
      ],
      [
        "leere-id.json",
        JSON.stringify({ schemaVersion: 1, elements: [{ id: "", part: "gerade-114" }] }),
        "Strecke ungültig",
      ],
    ];
    for (const [fileName, text, art] of cases) {
      const storage = new MemoryStorage();
      const s = withLayout(api, storage, OVAL);
      s.saveAs("Oval");
      s.dispatch({ type: "select", id: "o4" });
      const before = storage.snapshot();
      const name = s.name;
      s.importFile(fileName, text);
      expect(s.state.elements, fileName).toEqual(OVAL);
      expect(storage.snapshot(), fileName).toEqual(before);
      expect(s.name).toBe(name);
      const m = lastMessage(s);
      // Verlauf unverändert: ein Rückgängig nimmt das Laden zurück, Wiederholen ist nicht da
      expect(E.canRedo(s.state)).toBe(false);
      s.dispatch({ type: "undo" });
      expect(s.state.elements, fileName).toEqual([]);
      expect(m?.kind, fileName).toBe("importFehlgeschlagen");
      if (m?.kind !== "importFehlgeschlagen") continue;
      expect(m.fileName).toBe(fileName);
      expect(m.art, fileName).toBe(art);
      expect(m.text).toContain(fileName);
      expect(m.text).toContain(art);
      if (art === "Strecke ungültig") {
        expect(m.reason, fileName).toContain(schemaReason(text));
        expect(m.text).toContain(m.reason);
      }
    }
  });
});
