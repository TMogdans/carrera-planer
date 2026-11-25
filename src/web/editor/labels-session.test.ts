/**
 * Spec plan-beschriftung-symbole (.specify/specs/plan-beschriftung-symbole/spec.md): Schalter
 * „Namen“ in der Planer-Sitzung. Abnahmetests REQ-LBL-5 und REQ-LBL-6.
 *
 * ## Gewählte Schnittstelle (implement setzt genau diese um)
 *
 * `createPlannerSession` (src/web/editor/planner-session.ts) bekommt zusätzlich:
 *   labels: boolean            Getter, true = Schalter an
 *   setLabels(on: boolean)     Umschalten; schreibt sofort `an` bzw. `aus` unter
 *                              `carrera-planer:beschriftung`
 * und eine neue Meldung (PlannerMessage):
 *   { kind: "beschriftungUngueltig"; value: string; text: string }   ungültiger gespeicherter Wert
 * Speicherfehler beim Schreiben melden sich wie beim Modus als `speicherFehler`.
 *
 * Die Erweiterung steht als Typ hier im Test, weil `PlannerSession` in
 * src/web/test-support/bestand-fixtures.ts liegt (geschützter Satz). implement ergänzt
 * src/web/editor/types.ts entsprechend.
 */
import { describe, expect, test } from "vitest";
import {
  INVENTORY_KEY,
  loadPlannerSession,
  MODE_KEY,
  type PlannerMessage,
  type PlannerSession,
  type PlannerSessionApi,
  TEMPLATES,
} from "../test-support/bestand-fixtures.js";
import {
  CATALOG,
  type Command,
  fixedClock,
  layoutJson,
  loadSession,
  MemoryStorage,
  OVAL,
} from "../test-support/editor-fixtures.js";

const LABELS_KEY = "carrera-planer:beschriftung";

type LabelMessage = {
  readonly kind: "beschriftungUngueltig";
  readonly value: string;
  readonly text: string;
};
type LabelSession = Omit<PlannerSession, "messages"> & {
  readonly messages: ReadonlyArray<PlannerMessage | LabelMessage>;
  readonly labels: boolean;
  setLabels(on: boolean): void;
};

const clock = fixedClock("2026-11-25T07:15:00.000Z");

const open = (api: PlannerSessionApi, storage: MemoryStorage): LabelSession =>
  api.createPlannerSession({
    catalog: CATALOG,
    templates: TEMPLATES,
    storage,
    clock,
  }) as unknown as LabelSession;

/** Schlüssel aller Schreibzugriffe seit Logposition `mark`. */
const writesSince = (storage: MemoryStorage, mark: number): ReadonlyArray<string> =>
  storage.log.slice(mark).flatMap((o) => (o.op === "set" || o.op === "remove" ? [o.key] : []));

const choose = (partId: string): Command => ({ type: "choosePart", partId });

/** Oval aus Anhängen (Leistenrichtung links): Kurve, Kurve, Gerade, Kurve, Kurve, Gerade. */
const OVAL_COMMANDS: ReadonlyArray<Command> = OVAL.map((el) =>
  choose((el as { readonly part: string }).part),
);

describe("Schalter speichern", () => {
  test("[REQ-LBL-5] ohne Schlüssel: an, ohne Meldung und ohne Schreiben", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    expect(s.labels).toBe(true);
    expect(s.messages).toEqual([]);
    expect(writesSince(storage, 0)).toEqual([]);
    expect(storage.data.has(LABELS_KEY)).toBe(false);
  });

  test("[REQ-LBL-5] jedes Umschalten schreibt sofort an/aus; eine neue Sitzung auf demselben Speicher übernimmt es", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    s.setLabels(false);
    expect(s.labels).toBe(false);
    expect(storage.data.get(LABELS_KEY)).toBe("aus");
    const reopened = open(api, storage);
    expect(reopened.labels).toBe(false);
    expect(reopened.messages).toEqual([]);

    reopened.setLabels(true);
    expect(reopened.labels).toBe(true);
    expect(storage.data.get(LABELS_KEY)).toBe("an");
    const again = open(api, storage);
    expect(again.labels).toBe(true);
    expect(again.messages).toEqual([]);

    // jedes Umschalten schreibt genau diesen Schlüssel
    for (const on of [false, true, false]) {
      const mark = storage.log.length;
      again.setLabels(on);
      expect(writesSince(storage, mark)).toEqual([LABELS_KEY]);
      expect(storage.data.get(LABELS_KEY)).toBe(on ? "an" : "aus");
    }
  });

  test("[REQ-LBL-5] gespeichert „aus“ beim Start: aus, ohne Meldung und ohne Schreiben", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage({ [LABELS_KEY]: "aus" });
    const s = open(api, storage);
    expect(s.labels).toBe(false);
    expect(s.messages).toEqual([]);
    expect(writesSince(storage, 0)).toEqual([]);
  });

  test("[REQ-LBL-5] ungültiger Wert: an, Meldung nennt den Wert, Wert bleibt bis zum Umschalten unverändert", async () => {
    const api = await loadPlannerSession();
    for (const value of ["vielleicht", "", "AN", "true", "aus ", "{}"]) {
      const storage = new MemoryStorage({ [LABELS_KEY]: value });
      const s = open(api, storage);
      expect({ value, labels: s.labels }).toEqual({ value, labels: true });
      const m = s.messages.find((x) => x.kind === "beschriftungUngueltig");
      expect(m, JSON.stringify(value)).toBeDefined();
      if (m?.kind === "beschriftungUngueltig") {
        expect(m.value).toBe(value);
        expect(m.text).toContain(value);
      }
      // unverändert im Speicher, kein Schreiben beim Start
      expect(storage.data.get(LABELS_KEY)).toBe(value);
      expect(writesSince(storage, 0)).toEqual([]);
      // andere Arbeit lässt den Wert stehen
      s.dispatch(choose("gerade-342"));
      expect(storage.data.get(LABELS_KEY)).toBe(value);
      // nach einmal Umschalten steht „aus“
      s.setLabels(!s.labels);
      expect(storage.data.get(LABELS_KEY)).toBe("aus");
      const again = open(api, storage);
      expect(again.labels).toBe(false);
      expect(again.messages.some((x) => x.kind === "beschriftungUngueltig")).toBe(false);
    }
  });

  test("[REQ-LBL-5] Schreiben scheitert: Zustand ändert sich trotzdem, Meldung speicherFehler, keine Ausnahme", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    storage.fail = (op, key) => op === "set" && key === LABELS_KEY;
    for (const on of [false, true, false]) {
      const n = s.messages.length;
      expect(() => s.setLabels(on)).not.toThrow();
      expect(s.labels).toBe(on);
      expect(s.messages.length).toBeGreaterThan(n);
      expect(s.messages.at(-1)?.kind).toBe("speicherFehler");
    }
    expect(storage.data.has(LABELS_KEY)).toBe(false);
    // bedienbar
    s.dispatch(choose("gerade-342"));
    expect(s.state.elements).toHaveLength(1);
  });

  test("[REQ-LBL-5] der Schlüssel erscheint weder in der Layout-Liste noch in einer Defekt-Liste", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    for (const value of ["aus", "an", "vielleicht"]) {
      const storage = new MemoryStorage({
        [LABELS_KEY]: value,
        [m2.layoutKey("Oval")]: JSON.stringify(layoutJson(OVAL)),
      });
      const s = open(api, storage);
      s.setLabels(false);
      s.setLabels(true);
      expect(storage.data.has(LABELS_KEY)).toBe(true);
      const plain = m2.createSession({ catalog: CATALOG, storage, clock });
      for (const session of [s, plain]) {
        expect(session.savedNames()).toEqual(["Oval"]);
        expect(session.defectBackups()).not.toContain(LABELS_KEY);
        expect(session.defectBackups()).toEqual([]);
      }
      expect(s.inventoryDefectBackups()).not.toContain(LABELS_KEY);
      expect(s.inventoryDefectBackups()).toEqual([]);
    }
  });
});

describe("Umschalten ist kein Befehl", () => {
  test("[REQ-LBL-6] Oval bauen, umschalten, Rückgängig: das letzte Teil verschwindet, der Schalter bleibt", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    for (const c of OVAL_COMMANDS) s.dispatch(c);
    expect(s.state.elements.map((e) => (e as { readonly part: string }).part)).toEqual(
      OVAL.map((e) => (e as { readonly part: string }).part),
    );
    s.setLabels(false);
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toHaveLength(5);
    expect(s.labels).toBe(false);
    s.dispatch({ type: "redo" });
    expect(s.state.elements).toHaveLength(6);
    expect(s.labels).toBe(false);
    s.setLabels(true);
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toHaveLength(5);
    expect(s.labels).toBe(true);
  });

  test("[REQ-LBL-6] Umschalten ändert weder Folge, Auswahl, Aktion noch Verlauf und schreibt den Arbeitsstand nicht", async () => {
    const api = await loadPlannerSession();
    const m2 = await loadSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    for (const c of OVAL_COMMANDS) s.dispatch(c);
    const third = s.state.elements[2]?.id as string;
    s.dispatch({ type: "select", id: third });
    s.dispatch({ type: "setAction", action: "ersetzen" });
    const before = s.state;
    const working = storage.data.get(m2.WORKING_KEY);
    expect(working).toBeDefined();
    const mark = storage.log.length;
    s.setLabels(false);
    s.setLabels(true);
    s.setLabels(false);
    expect(s.state.elements).toEqual(before.elements);
    expect(s.state.selection).toBe(third);
    expect(s.state.action).toBe("ersetzen");
    expect(s.state.paletteTurn).toBe(before.paletteTurn);
    // zeichengleicher Arbeitsstand, geschrieben wurde nur der Schalter
    expect(storage.data.get(m2.WORKING_KEY)).toBe(working);
    expect(new Set(writesSince(storage, mark))).toEqual(new Set([LABELS_KEY]));
    expect(writesSince(storage, mark)).not.toContain(MODE_KEY);
    expect(writesSince(storage, mark)).not.toContain(INVENTORY_KEY);
    // kein Verlaufseintrag: ein Rückgängig nimmt das letzte Anhängen zurück
    s.dispatch({ type: "undo" });
    expect(s.state.elements).toEqual(before.elements.slice(0, 5));
  });

  test("[REQ-LBL-6] ein Export enthält kein Feld zur Beschriftung und ist vor und nach dem Umschalten gleich", async () => {
    const api = await loadPlannerSession();
    const storage = new MemoryStorage();
    const s = open(api, storage);
    for (const c of OVAL_COMMANDS) s.dispatch(c);
    const before = s.exportFile();
    s.setLabels(false);
    const after = s.exportFile();
    expect(after).toEqual(before);
    const doc = JSON.parse(after.text) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(["elements", "schemaVersion"]);
    expect(after.text).not.toMatch(/beschriftung/i);
    expect(doc.elements).toEqual(s.state.elements);
  });
});
