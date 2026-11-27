/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Editor-Logik — Befehle, Auswahl, Verlauf,
 * Element-IDs. Abnahmetests REQ-EDIT-1 bis REQ-EDIT-17.
 *
 * Schnittstelle (Typen und Begründung: src/web/test-support/editor-fixtures.ts):
 *   Modul `src/web/editor/editor.ts`
 *     initialState(): EditorState
 *     apply(catalog, state, command): EditorState     rein, Zustand unveränderlich
 *     canUndo(state), canRedo(state): boolean
 *     flipAvailable(catalog, state): boolean
 *     crossingTarget(catalog, elements): string | undefined
 *   EditorState = { elements, selection: id | undefined, action, paletteTurn } (+ opaker Verlauf)
 *   Command = choosePart | appendCrossing | togglePaletteTurn | flipSelected | deleteSelected | new
 *           | load | select | selectPrevious | selectNext | clearSelection | setAction | undo | redo
 *
 * Geometrische Erwartungen (geschlossen/offen, Versatz) prüfen die Tests direkt mit dem Kern
 * (`closure`) an der vom Editor erzeugten Folge; die Anzeige (Lücke, Winkel) prüft status.test.ts.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { closure } from "../../core/index.js";
import {
  ACHT,
  type Action,
  anyCommandArb,
  CATALOG,
  type CatalogEntry,
  type Command,
  decodeLayout,
  type EditorApi,
  type EditorState,
  editCommandArb,
  elementsArb,
  historyStates,
  isCurve,
  type LayoutElement,
  loadEditor,
  loaded,
  ORIGIN,
  OVAL,
  PLACEABLE_IDS,
  replaceAt,
  resolve,
  run,
  sameElements,
  UNKNOWN_ID,
  UNPLACEABLE_IDS,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;

const status = (elements: Elements, catalog: ReadonlyArray<CatalogEntry> = CATALOG): string => {
  const r = closure(catalog, elements, ORIGIN);
  return r.ok ? r.closure.status : "fehlerhaft";
};

const idsOf = (elements: Elements): string[] => elements.map((e) => e.id);

const selectAndAct = (E: EditorApi, s: EditorState, id: string, action: Action): EditorState =>
  run(E, s, [
    { type: "select", id },
    { type: "setAction", action },
  ]);

const choose = (partId: string): Command => ({ type: "choosePart", partId });

describe("Befehle", () => {
  test("[REQ-EDIT-1] Anhängen am Ende; Kurve mit Leistenrichtung, andere Teile ohne Richtung", async () => {
    const E = await loadEditor();
    const s0 = E.initialState();
    expect(s0.elements).toEqual([]);
    expect(s0.paletteTurn).toBe("links");
    const four = run(
      E,
      s0,
      [1, 2, 3, 4].map(() => choose("kurve-1-90")),
    );
    expect(four.elements).toHaveLength(4);
    for (const el of four.elements) {
      expect(el).toMatchObject({ part: "kurve-1-90", turn: "links" });
    }
    expect(status(four.elements)).toBe("geschlossen");

    const withStraight = E.apply(CATALOG, four, choose("gerade-342"));
    expect(withStraight.elements.slice(0, 4)).toEqual(four.elements);
    const last = withStraight.elements[4] as LayoutElement;
    expect(last).toMatchObject({ part: "gerade-342" });
    expect("turn" in last).toBe(false);
    expect("crosses" in last).toBe(false);
  });

  test("[REQ-EDIT-1] Eigenschaft: angehängte Teile in Tipp-Reihenfolge, Richtung nach Leiste, IDs eindeutig und nicht leer", async () => {
    const E = await loadEditor();
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom(...PLACEABLE_IDS).map((p) => choose(p)),
            fc.constant<Command>({ type: "togglePaletteTurn" }),
          ),
          { maxLength: 30 },
        ),
        (commands) => {
          let s = E.initialState();
          const expected: Array<{ part: string; turn: string | undefined }> = [];
          for (const c of commands) {
            if (c.type === "choosePart") {
              expected.push({
                part: c.partId,
                turn: isCurve(CATALOG, c.partId) ? s.paletteTurn : undefined,
              });
            }
            s = E.apply(CATALOG, s, c);
          }
          // Querungen, die REQ-EDIT-22 beim Treffen eines Queranschlusses zusätzlich anhängt,
          // sind keine angetippten Teile; sie tragen nur ID und Verweis.
          const parts = s.elements.filter((el) => !("crosses" in el));
          for (const el of s.elements.filter((e) => "crosses" in e)) {
            expect(Object.keys(el).sort()).toEqual(["crosses", "id"]);
          }
          expect(
            parts.map((el) => ({
              part: "part" in el ? el.part : undefined,
              turn: "turn" in el ? el.turn : undefined,
            })),
          ).toEqual(expected);
          const ids = idsOf(s.elements);
          expect(new Set(ids).size).toBe(ids.length);
          for (const id of ids) expect(id.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  test("[REQ-EDIT-2] Nicht platzierbare und unbekannte Einträge kommen nie in die Folge, ohne Verlaufseintrag", async () => {
    const E = await loadEditor();
    const base = loaded(E, OVAL);
    const rejected = [...UNPLACEABLE_IDS, UNKNOWN_ID];
    expect(rejected).toEqual(
      expect.arrayContaining(["looping", "steilkehre", "looping-teil", "wireless-anschluss"]),
    );
    const modes: ReadonlyArray<EditorState> = [
      base,
      selectAndAct(E, base, "o3", "keine"),
      selectAndAct(E, base, "o3", "ersetzen"),
      selectAndAct(E, base, "o3", "davorEinfuegen"),
    ];
    for (const s of modes) {
      for (const partId of rejected) {
        const after = E.apply(CATALOG, s, choose(partId));
        expect(after.elements, `${partId} bei Aktion ${s.action}`).toEqual(OVAL);
        // kein Verlaufseintrag: ein Rückgängig führt hinter das Laden zurück
        expect(E.apply(CATALOG, after, { type: "undo" }).elements).toEqual([]);
        expect(E.canRedo(after)).toBe(false);
      }
    }
    const empty = E.apply(CATALOG, E.initialState(), choose("looping"));
    expect(empty.elements).toEqual([]);
    expect(E.canUndo(empty)).toBe(false);
  });

  test("[REQ-EDIT-3] Leistenrichtung umschalten: gilt für künftige Kurven, Folge und Verlauf unverändert", async () => {
    const E = await loadEditor();
    const s0 = E.initialState();
    expect(s0.paletteTurn).toBe("links");
    const s1 = E.apply(CATALOG, s0, { type: "togglePaletteTurn" });
    expect(s1.paletteTurn).toBe("rechts");
    expect(s1.elements).toEqual([]);
    expect(E.canUndo(s1)).toBe(false);

    const withCurve = E.apply(CATALOG, s1, choose("kurve-2-45"));
    expect(withCurve.elements[0]).toMatchObject({ part: "kurve-2-45", turn: "rechts" });
    const toggledBack = E.apply(CATALOG, withCurve, { type: "togglePaletteTurn" });
    expect(toggledBack.paletteTurn).toBe("links");
    expect(toggledBack.elements).toEqual(withCurve.elements);
    // Umschalten legt keinen Eintrag an: ein Rückgängig nimmt die Kurve zurück
    expect(E.apply(CATALOG, toggledBack, { type: "undo" }).elements).toEqual([]);
    const next = E.apply(CATALOG, toggledBack, choose("kurve-1-90"));
    expect(next.elements[1]).toMatchObject({ part: "kurve-1-90", turn: "links" });
    expect(next.elements[0]).toMatchObject({ turn: "rechts" });
  });

  test("[REQ-EDIT-4] Richtung umschalten am ausgewählten Kurven-Element; Oval → offen, Rückgängig → geschlossen", async () => {
    const E = await loadEditor();
    const s = run(E, loaded(E, OVAL), [{ type: "select", id: "o1" }]);
    expect(E.flipAvailable(CATALOG, s)).toBe(true);
    const flipped = E.apply(CATALOG, s, { type: "flipSelected" });
    expect(flipped.elements[0]).toEqual({ id: "o1", part: "kurve-1-90", turn: "rechts" });
    expect(flipped.elements.slice(1)).toEqual(OVAL.slice(1));
    expect(flipped.selection).toBe("o1");
    expect(status(flipped.elements)).toBe("offen");
    const undone = E.apply(CATALOG, flipped, { type: "undo" });
    expect(undone.elements).toEqual(OVAL);
    expect(status(undone.elements)).toBe("geschlossen");
    const back = E.apply(CATALOG, E.apply(CATALOG, flipped, { type: "flipSelected" }), {
      type: "undo",
    });
    expect(back.elements[0]).toMatchObject({ turn: "rechts" });
  });

  test("[REQ-EDIT-4] Richtung umschalten ist für Nicht-Kurven, Querungen und ohne Auswahl nicht verfügbar und ändert nichts", async () => {
    const E = await loadEditor();
    const base = loaded(E, ACHT);
    const cases: ReadonlyArray<EditorState> = [
      base,
      run(E, base, [{ type: "select", id: "e1" }]), // Kreuzung
      run(E, base, [{ type: "select", id: "e5" }]), // Gerade
      run(E, base, [{ type: "select", id: "e6" }]), // Querung
    ];
    for (const s of cases) {
      expect(E.flipAvailable(CATALOG, s), `Auswahl ${s.selection}`).toBe(false);
      const after = E.apply(CATALOG, s, { type: "flipSelected" });
      expect(after.elements).toEqual(ACHT);
      expect(E.apply(CATALOG, after, { type: "undo" }).elements).toEqual([]);
    }
  });

  test("[REQ-EDIT-5] Löschen: Folgeelemente rücken vor, Auswahl wandert auf dieselbe Stelle, sonst das letzte, sonst keine", async () => {
    const E = await loadEditor();
    const base = loaded(E, OVAL);
    const mid = E.apply(CATALOG, run(E, base, [{ type: "select", id: "o3" }]), {
      type: "deleteSelected",
    });
    expect(mid.elements).toEqual([OVAL[0], OVAL[1], OVAL[3], OVAL[4], OVAL[5]]);
    expect(mid.selection).toBe("o4");

    const lastDeleted = E.apply(CATALOG, run(E, base, [{ type: "select", id: "o6" }]), {
      type: "deleteSelected",
    });
    expect(lastDeleted.elements).toEqual(OVAL.slice(0, 5));
    expect(lastDeleted.selection).toBe("o5");
    const r = closure(CATALOG, lastDeleted.elements, ORIGIN);
    expect(r.ok && r.closure.status).toBe("offen");
    if (r.ok && r.closure.status === "offen") {
      // Lücke 342 mm (Versatz (342, 0)), Winkel 0°
      const { dx, dy } = r.closure.offset;
      expect(dx.a.num * 1n).toBe(342n * dx.a.den);
      expect(dx.b.num).toBe(0n);
      expect(dy.a.num).toBe(0n);
      expect(dy.b.num).toBe(0n);
      expect(r.closure.angleSteps).toBe(0);
    }

    const single = loaded(E, [{ id: "s", part: "gerade-114" }]);
    const none = E.apply(CATALOG, run(E, single, [{ type: "select", id: "s" }]), {
      type: "deleteSelected",
    });
    expect(none.elements).toEqual([]);
    expect(none.selection).toBeUndefined();
  });

  test("[REQ-EDIT-6] Ersetzen: gleiche Stelle, gleiche Element-ID, Richtungsregel, Auswahl bleibt, Aktion endet", async () => {
    const E = await loadEditor();
    const base = loaded(E, OVAL);
    // Kurve → Kurve: alte Richtung bleibt, auch wenn die Leiste anders steht
    const rightPalette = E.apply(CATALOG, base, { type: "togglePaletteTurn" });
    const c2c = E.apply(
      CATALOG,
      selectAndAct(E, rightPalette, "o1", "ersetzen"),
      choose("kurve-1-45"),
    );
    expect(c2c.elements[0]).toEqual({ id: "o1", part: "kurve-1-45", turn: "links" });
    expect(c2c.elements.slice(1)).toEqual(OVAL.slice(1));
    expect(c2c.selection).toBe("o1");
    expect(c2c.action).toBe("keine");
    expect(status(c2c.elements)).toBe("offen");

    // Gerade → Kurve: neue Kurve bekommt die Leistenrichtung
    const g2c = E.apply(
      CATALOG,
      selectAndAct(E, rightPalette, "o3", "ersetzen"),
      choose("kurve-1-90"),
    );
    expect(g2c.elements[2]).toEqual({ id: "o3", part: "kurve-1-90", turn: "rechts" });

    // Kurve → Gerade: keine Richtung
    const c2g = E.apply(CATALOG, selectAndAct(E, base, "o1", "ersetzen"), choose("gerade-171"));
    expect(c2g.elements[0]).toEqual({ id: "o1", part: "gerade-171" });
    expect("turn" in (c2g.elements[0] as LayoutElement)).toBe(false);

    // Ein Tipp = ein Ersetzen: der nächste Tipp hängt an
    const again = E.apply(CATALOG, c2g, choose("gerade-342"));
    expect(again.elements[0]).toEqual({ id: "o1", part: "gerade-171" });
    expect(again.elements).toHaveLength(7);
    expect(again.elements[6]).toMatchObject({ part: "gerade-342" });

    // Querung durch ein Teil ersetzen
    const acht = loaded(E, ACHT);
    const q = E.apply(CATALOG, selectAndAct(E, acht, "e6", "ersetzen"), choose("gerade-114"));
    expect(q.elements[5]).toEqual({ id: "e6", part: "gerade-114" });
    expect("crosses" in (q.elements[5] as LayoutElement)).toBe(false);
    expect(q.selection).toBe("e6");
  });

  test("[REQ-EDIT-7] Davor einfügen: A, B vor X; Auswahl und Aktion bleiben; Richtung wie beim Anhängen", async () => {
    const E = await loadEditor();
    const s = selectAndAct(E, loaded(E, OVAL), "o3", "davorEinfuegen");
    const ab = run(E, s, [choose("gerade-114"), choose("anschlussstueck")]);
    expect(ab.elements).toHaveLength(8);
    expect(ab.elements.slice(0, 2)).toEqual(OVAL.slice(0, 2));
    expect(ab.elements[2]).toMatchObject({ part: "gerade-114" });
    expect(ab.elements[3]).toMatchObject({ part: "anschlussstueck" });
    expect(ab.elements.slice(4)).toEqual(OVAL.slice(2));
    expect(ab.selection).toBe("o3");
    expect(ab.action).toBe("davorEinfuegen");
    const newIds = [ab.elements[2], ab.elements[3]].map((e) => (e as LayoutElement).id);
    for (const id of newIds) expect(idsOf(OVAL)).not.toContain(id);

    // Smoke-Fall 3 als Logik: drei kurze Teile davor, Gerade 342 löschen → geschlossen, 8 Teile
    const three = E.apply(CATALOG, ab, choose("rundenzaehler"));
    const replaced = E.apply(CATALOG, three, { type: "deleteSelected" });
    expect(replaced.elements).toHaveLength(8);
    expect(status(replaced.elements)).toBe("geschlossen");

    // Kurve davor bekommt die Leistenrichtung
    const curve = E.apply(
      CATALOG,
      E.apply(CATALOG, s, { type: "togglePaletteTurn" }),
      choose("kurve-3-45"),
    );
    expect(curve.elements[2]).toMatchObject({ part: "kurve-3-45", turn: "rechts" });
  });

  test("[REQ-EDIT-8] Beispiel: Gerade 342 vor Nr. 1 der Acht → kein Fehler, offen, Versatz (−342, 0), Winkel 0", async () => {
    const E = await loadEditor();
    const s = E.apply(
      CATALOG,
      selectAndAct(E, loaded(E, ACHT), "e1", "davorEinfuegen"),
      choose("gerade-342"),
    );
    expect(s.elements.slice(1)).toEqual(ACHT);
    const r = closure(CATALOG, s.elements, ORIGIN);
    expect(r.ok).toBe(true);
    if (r.ok && r.closure.status === "offen") {
      const { dx, dy } = r.closure.offset;
      expect(dx.a.num).toBe(-342n * dx.a.den);
      expect(dx.b.num).toBe(0n);
      expect(dy.a.num).toBe(0n);
      expect(dy.b.num).toBe(0n);
      expect(r.closure.angleSteps).toBe(0);
    } else {
      expect.fail("Status muss offen sein");
    }
  });

  test("[REQ-EDIT-8] Eigenschaft: Löschen/Ersetzen/Einfügen an Stelle i lässt Elemente davor und alle anderen unverändert", async () => {
    const E = await loadEditor();
    fc.assert(
      fc.property(
        elementsArb.filter((els) => els.length > 0),
        fc.nat(),
        fc.constantFrom("loeschen", "ersetzen", "einfuegen"),
        fc.constantFrom(...PLACEABLE_IDS),
        (before, n, op, part) => {
          const i = n % before.length;
          const target = before[i] as LayoutElement;
          const s = loaded(E, before);
          const after =
            op === "loeschen"
              ? E.apply(CATALOG, run(E, s, [{ type: "select", id: target.id }]), {
                  type: "deleteSelected",
                })
              : E.apply(
                  CATALOG,
                  selectAndAct(E, s, target.id, op === "ersetzen" ? "ersetzen" : "davorEinfuegen"),
                  choose(part),
                );
          const a = after.elements;
          expect(a.slice(0, i)).toEqual(before.slice(0, i));
          // Posen vor i: dieselben Elemente vor i ergeben exakt dieselbe Spur
          expect(closure(CATALOG, a.slice(0, i), ORIGIN)).toEqual(
            closure(CATALOG, before.slice(0, i), ORIGIN),
          );
          if (op === "loeschen") {
            expect(a.slice(i)).toEqual(before.slice(i + 1));
          } else if (op === "ersetzen") {
            expect(a).toHaveLength(before.length);
            expect(a[i]).toMatchObject({ id: target.id, part });
            expect(a.slice(i + 1)).toEqual(before.slice(i + 1));
          } else {
            expect(a).toHaveLength(before.length + 1);
            expect(a[i]).toMatchObject({ part });
            expect(a.slice(i + 1)).toEqual(before.slice(i));
          }
        },
      ),
    );
  });

  test("[REQ-EDIT-9] Querung anhängen: verfügbar genau bei exakter Ankunft an ungequerter Kreuzung (Acht Nr. 1–5 / 1–4 / 1–7)", async () => {
    const E = await loadEditor();
    expect(E.crossingTarget(CATALOG, ACHT.slice(0, 5))).toBe("e1");
    expect(E.crossingTarget(CATALOG, ACHT.slice(0, 4))).toBeUndefined();
    expect(E.crossingTarget(CATALOG, ACHT.slice(0, 7))).toBeUndefined();
    expect(E.crossingTarget(CATALOG, [])).toBeUndefined();
    // Folge mit Fehler: nicht verfügbar
    expect(
      E.crossingTarget(CATALOG, [{ id: "z", part: UNKNOWN_ID }, ...ACHT.slice(0, 5)]),
    ).toBeUndefined();

    const s = loaded(E, ACHT.slice(0, 5));
    const after = E.apply(CATALOG, s, { type: "appendCrossing" });
    expect(after.elements.slice(0, 5)).toEqual(ACHT.slice(0, 5));
    const q = after.elements[5] as LayoutElement;
    expect(q).toMatchObject({ crosses: "e1" });
    expect(Object.keys(q).sort()).toEqual(["crosses", "id"]);
    expect(idsOf(ACHT.slice(0, 5))).not.toContain(q.id);
    expect(closure(CATALOG, after.elements, ORIGIN).ok).toBe(true);
    expect(E.apply(CATALOG, after, { type: "undo" }).elements).toEqual(ACHT.slice(0, 5));

    // nicht verfügbar → ändert nichts, kein Verlaufseintrag
    const s4 = loaded(E, ACHT.slice(0, 4));
    const noop = E.apply(CATALOG, s4, { type: "appendCrossing" });
    expect(noop.elements).toEqual(ACHT.slice(0, 4));
    expect(E.apply(CATALOG, noop, { type: "undo" }).elements).toEqual([]);
  });

  test("[REQ-EDIT-9] Trifft das Ende mehrere ungequerte Kreuzungen, verweist die Querung auf die früheste", async () => {
    const E = await loadEditor();
    // Kreuzung A, Schleife zurück auf die Startpose, Kreuzung B deckungsgleich, Weg zum Anschluss
    const two: Elements = [
      { id: "kA", part: "kreuzung" },
      { id: "c1", part: "kurve-1-90", turn: "links" },
      { id: "c2", part: "kurve-1-90", turn: "links" },
      { id: "g", part: "gerade-342" },
      { id: "c3", part: "kurve-1-90", turn: "links" },
      { id: "c4", part: "kurve-1-90", turn: "links" },
      { id: "kB", part: "kreuzung" },
      { id: "r1", part: "kurve-1-90", turn: "rechts" },
      { id: "r2", part: "kurve-1-90", turn: "rechts" },
      { id: "r3", part: "kurve-1-90", turn: "rechts" },
      { id: "g2", part: "gerade-114" },
    ];
    expect(E.crossingTarget(CATALOG, two)).toBe("kA");
    const after = E.apply(CATALOG, loaded(E, two), { type: "appendCrossing" });
    expect(after.elements[11]).toMatchObject({ crosses: "kA" });
    // nach der Querung von A ist B noch ungequert; das Ende liegt aber nicht mehr am Anschluss
    expect(E.crossingTarget(CATALOG, after.elements)).toBeUndefined();
  });

  test("[REQ-EDIT-9] Ob das Ende trifft, entscheidet der Kern mit dem übergebenen Katalog", async () => {
    const E = await loadEditor();
    const wide: ReadonlyArray<CatalogEntry> = CATALOG.map((e) =>
      e.id === "kreuzung"
        ? { ...e, geometry: { kind: "kreuzung", length: 342, crossLength: 116 } }
        : e,
    );
    expect(E.crossingTarget(CATALOG, ACHT.slice(0, 5))).toBe("e1");
    expect(E.crossingTarget(wide, ACHT.slice(0, 5))).toBeUndefined();
    const s = loaded(E, ACHT.slice(0, 5), wide);
    expect(E.apply(wide, s, { type: "appendCrossing" }).elements).toEqual(ACHT.slice(0, 5));
  });

  test("[REQ-EDIT-10] Querung nur am Ende: bei aktiver Aktion am Ende angehängt, Auswahl und Aktion unberührt; vorhandene Querung lässt sich löschen", async () => {
    const E = await loadEditor();
    const base = loaded(E, ACHT.slice(0, 5));
    for (const action of ["ersetzen", "davorEinfuegen"] as const) {
      const s = selectAndAct(E, base, "e3", action);
      const after = E.apply(CATALOG, s, { type: "appendCrossing" });
      // Auslegung (Spec): bei aktiver Aktion immer am Ende anhängen, Auswahl und Aktion unberührt
      expect(after.elements.slice(0, 5)).toEqual(ACHT.slice(0, 5));
      expect(after.elements).toHaveLength(6);
      expect(after.elements[5]).toMatchObject({ crosses: "e1" });
      expect(after.selection).toBe("e3");
      expect(after.action).toBe(action);
    }
    const acht = loaded(E, ACHT);
    const del = E.apply(CATALOG, run(E, acht, [{ type: "select", id: "e6" }]), {
      type: "deleteSelected",
    });
    expect(del.elements).toEqual(ACHT.filter((e) => e.id !== "e6"));
  });

  test("[REQ-EDIT-11] Kreuzung gelöscht oder ersetzt: Querung bleibt unverändert stehen, Kern meldet ungültigen Verweis", async () => {
    const E = await loadEditor();
    const acht = loaded(E, ACHT);
    const del = E.apply(CATALOG, run(E, acht, [{ type: "select", id: "e1" }]), {
      type: "deleteSelected",
    });
    expect(del.elements).toEqual(ACHT.slice(1));
    expect(del.elements[4]).toEqual({ id: "e6", crosses: "e1" });
    const r = closure(CATALOG, del.elements, ORIGIN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([{ kind: "ungueltigerVerweis", index: 4, id: "e6", ref: "e1" }]);
    }

    const rep = E.apply(CATALOG, selectAndAct(E, acht, "e1", "ersetzen"), choose("gerade-342"));
    expect(rep.elements).toEqual(replaceAt(ACHT, 0, { id: "e1", part: "gerade-342" }));
    const r2 = closure(CATALOG, rep.elements, ORIGIN);
    expect(!r2.ok && r2.errors.map((e) => e.kind)).toEqual(["ungueltigerVerweis"]);
  });

  test("[REQ-EDIT-12] Neu leert die Folge und hebt die Auswahl auf; rückgängig machbar", async () => {
    const E = await loadEditor();
    const s = run(E, loaded(E, OVAL), [{ type: "select", id: "o2" }]);
    const fresh = E.apply(CATALOG, s, { type: "new" });
    expect(fresh.elements).toEqual([]);
    expect(fresh.selection).toBeUndefined();
    expect(E.canUndo(fresh)).toBe(true);
    expect(E.apply(CATALOG, fresh, { type: "undo" }).elements).toEqual(OVAL);
  });

  test("[REQ-EDIT-13] Auswahl über ID, vor/zurück auch über nicht gezeichnete Elemente, aufheben; Aktion nur mit Auswahl", async () => {
    const E = await loadEditor();
    const broken = ACHT.map((el) => (el.id === "e5" ? { id: "e5", part: "gerade-171" } : el));
    const base = loaded(E, broken);
    const s5 = E.apply(CATALOG, base, { type: "select", id: "e5" });
    expect(s5.selection).toBe("e5");
    const s6 = E.apply(CATALOG, s5, { type: "selectNext" });
    expect(s6.selection).toBe("e6"); // Nr. 6 ist nicht gezeichnet
    const s7 = E.apply(CATALOG, s6, { type: "selectNext" });
    expect(s7.selection).toBe("e7");
    expect(E.apply(CATALOG, s7, { type: "selectPrevious" }).selection).toBe("e6");

    // Aktion ohne Auswahl: bleibt „keine“
    expect(E.apply(CATALOG, base, { type: "setAction", action: "ersetzen" }).action).toBe("keine");
    const acting = E.apply(CATALOG, s7, { type: "setAction", action: "ersetzen" });
    expect(acting.action).toBe("ersetzen");
    const cleared = E.apply(CATALOG, acting, { type: "clearSelection" });
    expect(cleared.selection).toBeUndefined();
    expect(cleared.action).toBe("keine");

    // Auswahl und Aktion ändern die Folge nicht und kommen nicht in den Verlauf
    for (const s of [s5, s6, s7, acting, cleared]) {
      expect(s.elements).toEqual(broken);
      expect(E.apply(CATALOG, s, { type: "undo" }).elements).toEqual([]);
      expect(E.canRedo(s)).toBe(false);
    }
  });
});

describe("Leisten-Einteilung", () => {
  test("[REQ-EDIT-21] aktueller Katalog: Platzierbare als Block von Gerade 342 bis Rundenzähler, 4 Maße fehlen, L und K ausgeblendet, in Katalogreihenfolge (gilt vor und nach gerade-100)", async () => {
    const E = await loadEditor();
    const entries = E.paletteEntries(CATALOG);
    expect(entries.map((e) => e.partId)).toEqual(CATALOG.map((e) => e.id));
    expect(entries.map((e) => e.name)).toEqual(CATALOG.map((e) => e.name));
    const ofKind = (kind: string) => entries.filter((e) => e.kind === kind).map((e) => e.partId);
    const placeable = ofKind("platzierbar");
    expect(placeable).toEqual(CATALOG.slice(0, placeable.length).map((e) => e.id));
    expect(placeable[0]).toBe("gerade-342");
    expect(placeable[placeable.length - 1]).toBe("rundenzaehler");
    expect(ofKind("masseFehlen")).toEqual([
      "wireless-anschluss",
      "steilkurve-1-45",
      "looping",
      "steilkehre",
    ]);
    expect(ofKind("ausgeblendet")).toEqual(["looping-teil", "steilkehre-teil"]);
    expect(entries).toHaveLength(CATALOG.length);
  });

  test("[REQ-EDIT-21] Katalog mit gerade-100: die 14 Einträge von Gerade 342 bis Rundenzähler platzierbar, Gerade 100 an vierter Stelle; Maße fehlen und ausgeblendet unverändert", async () => {
    const E = await loadEditor();
    const entries = E.paletteEntries(CATALOG);
    expect(entries.map((e) => e.partId)).toEqual(CATALOG.map((e) => e.id));
    expect(entries.map((e) => e.name)).toEqual(CATALOG.map((e) => e.name));
    const ofKind = (kind: string) => entries.filter((e) => e.kind === kind).map((e) => e.partId);
    expect(ofKind("platzierbar")).toEqual(CATALOG.slice(0, 14).map((e) => e.id));
    expect(ofKind("platzierbar")[0]).toBe("gerade-342");
    expect(ofKind("platzierbar")[2]).toBe("gerade-114");
    expect(ofKind("platzierbar")[3]).toBe("gerade-100");
    expect(entries[3]).toEqual({ partId: "gerade-100", name: "Gerade 100", kind: "platzierbar" });
    expect(ofKind("platzierbar")[13]).toBe("rundenzaehler");
    expect(ofKind("masseFehlen")).toEqual([
      "wireless-anschluss",
      "steilkurve-1-45",
      "looping",
      "steilkehre",
    ]);
    expect(ofKind("ausgeblendet")).toEqual(["looping-teil", "steilkehre-teil"]);
    expect(entries).toHaveLength(CATALOG.length);
  });

  test("[REQ-EDIT-21] Wirkungsnachweis: veränderter Katalog ändert die Einteilung; platzierbar heißt genau anhängbar", async () => {
    const E = await loadEditor();
    const changed: ReadonlyArray<CatalogEntry> = [
      ...CATALOG.map(
        (e): CatalogEntry =>
          e.id === "steilkurve-1-45"
            ? { ...e, geometry: { kind: "kurve", radius: 171, angle: 45 } }
            : e,
      ),
      {
        id: "wireless-set",
        name: "Wireless-Set (Baugruppe)",
        articleNumbers: "keineEigene",
        source: "Test",
        certainty: "niedrig",
        geometry: { kind: "baugruppe", parts: [{ part: "wireless-anschluss", count: 1 }] },
      },
    ];
    const kindOf = (catalog: ReadonlyArray<CatalogEntry>, id: string) =>
      E.paletteEntries(catalog).find((e) => e.partId === id)?.kind;
    expect(kindOf(CATALOG, "steilkurve-1-45")).toBe("masseFehlen");
    expect(kindOf(changed, "steilkurve-1-45")).toBe("platzierbar");
    expect(kindOf(CATALOG, "wireless-anschluss")).toBe("masseFehlen");
    expect(kindOf(changed, "wireless-anschluss")).toBe("ausgeblendet");
    expect(kindOf(changed, "wireless-set")).toBe("masseFehlen");
    expect(E.paletteEntries(changed).map((e) => e.partId)).toEqual(changed.map((e) => e.id));
    // „platzierbar“ deckt sich mit dem, was ein Tipp in die Folge bringt (REQ-EDIT-2)
    for (const catalog of [CATALOG, changed]) {
      for (const entry of E.paletteEntries(catalog)) {
        const after = E.apply(catalog, E.initialState(), choose(entry.partId));
        expect(after.elements.length, `${entry.partId}`).toBe(entry.kind === "platzierbar" ? 1 : 0);
      }
    }
  });
});

describe("Verlauf und Element-IDs", () => {
  test("[REQ-EDIT-14] Eigenschaft: jeder wirksame Befehl genau ein Eintrag; Rückgängig/Wiederholen exakt; Auswahl nur bei verschwundenem Element aufgehoben", async () => {
    const E = await loadEditor();
    fc.assert(
      fc.property(fc.array(anyCommandArb, { maxLength: 40 }), (gens) => {
        let s = E.initialState();
        for (const g of gens) {
          const c = resolve(s, g);
          const next = E.apply(CATALOG, s, c);
          if (c.type === "undo" || c.type === "redo") {
            const sel = s.selection;
            if (sel !== undefined && idsOf(next.elements).includes(sel)) {
              expect(next.selection).toBe(sel);
            } else {
              expect(next.selection).toBeUndefined();
            }
          } else if (!sameElements(s.elements, next.elements)) {
            // genau ein Eintrag: ein Rückgängig stellt exakt den Stand davor her …
            const back = E.apply(CATALOG, next, { type: "undo" });
            expect(back.elements).toEqual(s.elements);
            // … und Wiederholen exakt den Stand danach
            expect(E.apply(CATALOG, back, { type: "redo" }).elements).toEqual(next.elements);
          }
          if (next.selection !== undefined) expect(idsOf(next.elements)).toContain(next.selection);
          s = next;
        }
      }),
    );
  });

  test("[REQ-EDIT-14] Rückgängig nach Ersetzen: Folge exakt zurück, ausgewähltes Element bleibt ausgewählt", async () => {
    const E = await loadEditor();
    const s = E.apply(
      CATALOG,
      selectAndAct(E, loaded(E, OVAL), "o1", "ersetzen"),
      choose("kurve-1-45"),
    );
    const undone = E.apply(CATALOG, s, { type: "undo" });
    expect(undone.elements).toEqual(OVAL);
    expect(undone.selection).toBe("o1");
    const redone = E.apply(CATALOG, undone, { type: "redo" });
    expect(redone.elements).toEqual(s.elements);

    // eingefügtes Element ausgewählt, Rückgängig entfernt es → Auswahl aufgehoben
    const appended = E.apply(CATALOG, loaded(E, OVAL), choose("gerade-114"));
    const newId = (appended.elements[6] as LayoutElement).id;
    const sel = E.apply(CATALOG, appended, { type: "select", id: newId });
    expect(E.apply(CATALOG, sel, { type: "undo" }).selection).toBeUndefined();
  });

  test("[REQ-EDIT-15] Neuer Befehl nach Rückgängig verwirft Wiederholbares; ohne Verlauf nichts verfügbar; wirkungslose Befehle ohne Eintrag", async () => {
    const E = await loadEditor();
    const s0 = E.initialState();
    expect(E.canUndo(s0)).toBe(false);
    expect(E.canRedo(s0)).toBe(false);
    expect(E.apply(CATALOG, s0, { type: "undo" }).elements).toEqual([]);
    expect(E.apply(CATALOG, s0, { type: "redo" }).elements).toEqual([]);

    const ab = run(E, s0, [choose("gerade-342"), choose("gerade-171")]);
    const undone = E.apply(CATALOG, ab, { type: "undo" });
    expect(E.canRedo(undone)).toBe(true);
    const branched = E.apply(CATALOG, undone, choose("gerade-114"));
    expect(E.canRedo(branched)).toBe(false);
    expect(E.apply(CATALOG, branched, { type: "redo" }).elements).toEqual(branched.elements);

    // wirkungslos: nicht platzierbar, Querung nicht verfügbar, Löschen ohne Auswahl, Neu auf leer
    const noops: ReadonlyArray<Command> = [
      choose("steilkurve-1-45"),
      { type: "appendCrossing" },
      { type: "deleteSelected" },
    ];
    for (const c of noops) {
      const after = E.apply(CATALOG, branched, c);
      expect(after.elements).toEqual(branched.elements);
      expect(E.apply(CATALOG, after, { type: "undo" }).elements).toEqual(
        E.apply(CATALOG, branched, { type: "undo" }).elements,
      );
    }
    const newOnEmpty = E.apply(CATALOG, s0, { type: "new" });
    expect(E.canUndo(newOnEmpty)).toBe(false);
  });

  test("[REQ-EDIT-16] Eigenschaft: n wirksame Befehle, n-mal Rückgängig → Ausgangsstand, n-mal Wiederholen → Endstand", async () => {
    const E = await loadEditor();
    fc.assert(
      fc.property(fc.array(editCommandArb, { maxLength: 40 }), (gens) => {
        let s = E.initialState();
        const states: Elements[] = [s.elements];
        for (const g of gens) {
          const next = E.apply(CATALOG, s, resolve(s, g));
          if (!sameElements(s.elements, next.elements)) states.push(next.elements);
          s = next;
        }
        const n = states.length - 1;
        const end = s.elements;
        for (let k = 1; k <= n; k++) {
          expect(E.canUndo(s)).toBe(true);
          s = E.apply(CATALOG, s, { type: "undo" });
          expect(s.elements).toEqual(states[n - k]);
        }
        expect(E.canUndo(s)).toBe(false);
        expect(s.elements).toEqual([]);
        for (let k = 1; k <= n; k++) {
          expect(E.canRedo(s)).toBe(true);
          s = E.apply(CATALOG, s, { type: "redo" });
          expect(s.elements).toEqual(states[k]);
        }
        expect(E.canRedo(s)).toBe(false);
        expect(s.elements).toEqual(end);
      }),
      { numRuns: 200 },
    );
  });

  test("[REQ-EDIT-17] Eigenschaft: jede erreichbare Folge besteht LayoutSchema; neue IDs kommen in keinem Stand des Verlaufs vor, auch nach Laden fremder IDs", async () => {
    const E = await loadEditor();
    fc.assert(
      fc.property(fc.array(anyCommandArb, { maxLength: 40 }), (gens) => {
        let s = E.initialState();
        for (const g of gens) {
          const c = resolve(s, g);
          const next = E.apply(CATALOG, s, c);
          const decoded = decodeLayout({ schemaVersion: 1, elements: next.elements });
          expect(decoded._tag, JSON.stringify(next.elements)).toBe("Right");
          if (c.type !== "undo" && c.type !== "redo" && c.type !== "load") {
            const before = new Set(idsOf(s.elements));
            const fresh = idsOf(next.elements).filter((id) => !before.has(id));
            if (fresh.length > 0) {
              const seen = new Set(historyStates(E, s).flatMap((els) => idsOf(els)));
              for (const id of fresh) {
                expect(seen.has(id), `ID ${id} kam im Verlauf schon vor`).toBe(false);
              }
            }
          }
          s = next;
        }
      }),
      { numRuns: 200 },
    );
  });

  test("[REQ-EDIT-17] Nach Laden eines Layouts mit fremden IDs kollidieren neue IDs weder mit der Folge noch mit dem Verlauf, auch nach Neu", async () => {
    const E = await loadEditor();
    // IDs, die eine Implementierung plausibel selbst vergibt (Zähler, Präfix, Länge + 1, …)
    const schemes = ["", "e", "n", "el-", "id-", "x", "el", "e-", "element-", "p"];
    const foreign: Elements = schemes.flatMap((prefix) =>
      Array.from({ length: 41 }, (_, i) => ({ id: `${prefix}${i}`, part: "gerade-114" })),
    );
    const s = E.apply(CATALOG, loaded(E, OVAL), { type: "load", elements: foreign });
    const appends = Array.from({ length: 40 }, (): Command => choose("gerade-342"));
    // (a) fremde IDs in der aktuellen Folge
    const kept = run(E, s, appends);
    const ids = idsOf(kept.elements);
    expect(new Set(ids).size).toBe(ids.length);
    // (b) nach „Neu“ stehen die fremden IDs nur noch im Verlauf
    const cleared = run(E, E.apply(CATALOG, s, { type: "new" }), appends);
    const history = new Set([...idsOf(foreign), ...idsOf(OVAL)]);
    for (const id of [...ids.slice(foreign.length), ...idsOf(cleared.elements)]) {
      expect(history.has(id), `neue ID ${id} steht schon im Verlauf`).toBe(false);
    }
  });
});

describe("Nachtrag: Laden hebt die Auswahl auf", () => {
  test("[REQ-STORE-3] Laden hebt die Auswahl auf, auch wenn die ausgewählte ID im geladenen Layout wieder vorkommt; die Aktion endet", async () => {
    const E = await loadEditor();
    // geladenes Layout enthält dieselben IDs e1 … e10 (anderer Inhalt)
    const sameIds: Elements = ACHT.map((el) => ({ id: el.id, part: "gerade-114" }));
    for (const id of ["e1", "e5", "e10"]) {
      const s = selectAndAct(E, loaded(E, ACHT), id, "ersetzen");
      expect(s.selection).toBe(id);
      expect(s.action).toBe("ersetzen");
      const after = E.apply(CATALOG, s, { type: "load", elements: sameIds });
      expect(after.elements).toEqual(sameIds);
      expect(after.selection, `Auswahl ${id}`).toBeUndefined();
      expect(after.action).toBe("keine");
    }
  });
});
