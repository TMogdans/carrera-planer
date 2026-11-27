/**
 * Spec M2 (.specify/specs/m2-editor/spec.md): Nachtrag REQ-EDIT-22 (#62) — Querung automatisch
 * beim Anhängen.
 *
 * Schnittstelle unverändert (Typen: src/web/test-support/editor-fixtures.ts): `apply`,
 * `crossingTarget`, `canUndo`/`canRedo` aus `src/web/editor/editor.ts`, die Sitzung aus
 * `src/web/editor/session.ts`. Kein neuer Befehl: Das automatische Einfügen ist Teil von
 * `choosePart` ohne aktive Aktion (Anhängen nach REQ-EDIT-1).
 *
 * Die Geometrie (wo das Ende steht, welche Anschlüsse offen sind) prüfen die Tests unabhängig vom
 * Editor direkt mit dem Kern (`trace`). Die vom Editor vergebenen Element-IDs sind frei; die Tests
 * vergleichen deshalb Teile und Richtungen und lesen IDs aus der erzeugten Folge.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { type Coord, type Pose, trace } from "../../core/index.js";
import {
  ACHT,
  ACHT_G171,
  CATALOG,
  type CatalogEntry,
  type Command,
  type EditorApi,
  type EditorState,
  fixedClock,
  isCurve,
  type LayoutElement,
  layoutJson,
  loadEditor,
  loaded,
  loadSession,
  MemoryStorage,
  ORIGIN,
  PLACEABLE_IDS,
  run,
  type Turn,
  UNKNOWN_ID,
} from "../test-support/editor-fixtures.js";

type Elements = ReadonlyArray<LayoutElement>;
type Catalog = ReadonlyArray<CatalogEntry>;

const choose = (partId: string): Command => ({ type: "choosePart", partId });
const select = (id: string): Command => ({ type: "select", id });
const del: Command = { type: "deleteSelected" };
const undo: Command = { type: "undo" };
const redo: Command = { type: "redo" };

const isCrossing = (el: LayoutElement | undefined): el is { id: string; crosses: string } =>
  el !== undefined && "crosses" in el;
const crossings = (elements: Elements) => elements.filter(isCrossing);
const idOf = (el: LayoutElement | undefined): string => {
  if (el === undefined) throw new Error("Testdaten-Fehler: Element fehlt");
  return el.id;
};

/** Inhalt ohne ID: Teil und Richtung bzw. Querungsziel (IDs vergibt der Editor frei). */
const shape = (elements: Elements): ReadonlyArray<string> =>
  elements.map((el) => ("crosses" in el ? `>${el.crosses}` : `${el.part}|${el.turn ?? ""}`));

/** Acht Nr. 1–4 und Nr. 1–5 (M1-Tabelle „Acht“), Kurven rechts. */
const ACHT_1_4 = ACHT.slice(0, 4);
const ACHT_1_5 = ACHT.slice(0, 5);

/** Gespiegelte Acht Nr. 1–4: Kurven links, Ende nach Gerade 114 am linken Queranschluss. */
const mirror = (elements: Elements): Elements =>
  elements.map((el) =>
    "turn" in el && el.turn !== undefined
      ? { ...el, turn: (el.turn === "links" ? "rechts" : "links") as Turn }
      : el,
  );
const MIRROR_1_4 = mirror(ACHT_1_4);

/** Kreuzung A, Schleife zurück auf die Startpose, Kreuzung B deckungsgleich, drei Kurven rechts. */
const TWO_1_10: Elements = [
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
];

/** Ganze Acht, dann Gerade 342 und drei Kurven rechts: eine Gerade 114 vor dem gequerten e1. */
const ACHT_AGAIN: Elements = [
  ...ACHT,
  { id: "x1", part: "gerade-342" },
  { id: "x2", part: "kurve-1-90", turn: "rechts" },
  { id: "x3", part: "kurve-1-90", turn: "rechts" },
  { id: "x4", part: "kurve-1-90", turn: "rechts" },
];

// ---------------------------------------------------------------------------------------------
// Exakte Posen (Kern), unabhängig vom Editor
// ---------------------------------------------------------------------------------------------

/** a + b·√2 gleich der ganzen Zahl n (exakt, ohne Toleranz). */
const coordIs = (c: Coord, n: bigint): boolean => c.b.num === 0n && c.a.num === n * c.a.den;
const poseIs = (p: Pose | undefined, x: bigint, y: bigint, dir: number): boolean =>
  p !== undefined && coordIs(p.x, x) && coordIs(p.y, y) && p.dir === dir;
const describePose = (p: Pose | undefined): string =>
  p === undefined
    ? "unbestimmt"
    : `(${p.x.a.num}/${p.x.a.den}+${p.x.b.num}/${p.x.b.den}√2, ${p.y.a.num}/${p.y.a.den}+${p.y.b.num}/${p.y.b.den}√2, ${p.dir})`;
const expectPose = (p: Pose | undefined, x: bigint, y: bigint, dir: number): void => {
  expect(poseIs(p, x, y, dir), `erwartet (${x}, ${y}, ${dir}), erhalten ${describePose(p)}`).toBe(
    true,
  );
};

/** Endpose laut Kern, nur bei fehlerfreier Folge. */
const endOf = (elements: Elements, catalog: Catalog = CATALOG): Pose | undefined => {
  const r = trace(catalog, elements, ORIGIN);
  return r.ok ? r.end : undefined;
};

const sameRational = (p: { num: bigint; den: bigint }, q: { num: bigint; den: bigint }): boolean =>
  p.num * q.den === q.num * p.den;
const sameCoord = (c: Coord, d: Coord): boolean => sameRational(c.a, d.a) && sameRational(c.b, d.b);
const samePose = (p: Pose, q: Pose): boolean =>
  sameCoord(p.x, q.x) && sameCoord(p.y, q.y) && p.dir === q.dir;

/**
 * Orakel aus dem Kern: IDs der ungequerten Kreuzungen in Folgereihenfolge, deren Queranschluss
 * (Position und Richtung) exakt gleich dem offenen Ende ist. Leer bei fehlerhafter Folge.
 */
const uncrossedPortHits = (elements: Elements, catalog: Catalog = CATALOG): string[] => {
  const r = trace(catalog, elements, ORIGIN);
  if (!r.ok) return [];
  const open = new Map<string, ReadonlyArray<Pose>>();
  r.steps.forEach((step, i) => {
    const el = elements[i] as LayoutElement;
    if (isCrossing(el)) open.delete(el.crosses);
    else if (step.crossPorts !== undefined)
      open.set(el.id, [step.crossPorts.left, step.crossPorts.right]);
  });
  return [...open].filter(([, ports]) => ports.some((p) => samePose(p, r.end))).map(([id]) => id);
};

/** Anzahl der Verlaufseinträge: so oft Rückgängig, bis nichts mehr geht. */
const undoDepth = (E: EditorApi, s: EditorState): number => {
  let n = 0;
  let t = s;
  while (E.canUndo(t)) {
    t = E.apply(CATALOG, t, undo);
    n++;
  }
  return n;
};

// ---------------------------------------------------------------------------------------------

describe("Querung automatisch beim Anhängen", () => {
  test.skip("[REQ-EDIT-22] Acht: an Nr. 1–4 wird Nr. 5 angehängt → Nr. 1–5 plus Querung auf e1, ein Verlaufseintrag; ein Rückgängig stellt Nr. 1–4 exakt her", async () => {
    const E = await loadEditor();
    const four = loaded(E, ACHT_1_4);
    expect(uncrossedPortHits(ACHT_1_4)).toEqual([]);
    expect(undoDepth(E, four)).toBe(1);

    const after = E.apply(CATALOG, four, choose("gerade-114"));
    expect(after.elements).toHaveLength(6);
    expect(after.elements.slice(0, 4)).toEqual(ACHT_1_4);
    expect(after.elements[4]).toMatchObject({ part: "gerade-114" });
    expect("turn" in (after.elements[4] as LayoutElement)).toBe(false);
    const q = after.elements[5] as LayoutElement;
    expect(q).toMatchObject({ crosses: "e1" });
    expect(Object.keys(q).sort()).toEqual(["crosses", "id"]);
    // neue, eindeutige, nicht leere Element-IDs für Teil und Querung
    const ids = after.elements.map((el) => el.id);
    expect(new Set(ids).size).toBe(6);
    expect(q.id.length).toBeGreaterThan(0);
    for (const id of ACHT_1_4.map((el) => el.id)) expect(q.id).not.toBe(id);
    // Kern: fehlerfrei, Ende am gegenüberliegenden Anschluss (M1-Tabelle Nr. 6: (171, 57, k = 2))
    const r = trace(CATALOG, after.elements, ORIGIN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expectPose(r.steps[4]?.pose, 171n, -57n, 2);
      expectPose(r.end, 171n, 57n, 2);
    }
    // die Kreuzung ist jetzt gequert: „Querung anhängen“ nicht mehr verfügbar
    expect(E.crossingTarget(CATALOG, after.elements)).toBeUndefined();

    // genau ein Verlaufseintrag: Laden + Anhängen = 2
    expect(undoDepth(E, after)).toBe(2);
    const back = E.apply(CATALOG, after, undo);
    expect(back.elements).toEqual(ACHT_1_4);
    expect(E.apply(CATALOG, back, undo).elements).toEqual([]);
    // Wiederholen stellt beide wieder her, nicht nur das Teil
    const again = E.apply(CATALOG, back, redo);
    expect(again.elements).toEqual(after.elements);
    expect(E.canRedo(again)).toBe(false);
  });

  test.skip("[REQ-EDIT-22] Praxisfall: Kreuzung, 3 × Kurve 1/90° rechts, Gerade 114 angetippt → Querung steht automatisch; Gerade 342 setzt am gegenüberliegenden Anschluss an", async () => {
    const E = await loadEditor();
    const built = run(E, E.initialState(), [
      choose("kreuzung"),
      { type: "togglePaletteTurn" },
      choose("kurve-1-90"),
      choose("kurve-1-90"),
      choose("kurve-1-90"),
      choose("gerade-114"),
    ]);
    expect(shape(built.elements.slice(0, 5))).toEqual([
      "kreuzung|",
      "kurve-1-90|rechts",
      "kurve-1-90|rechts",
      "kurve-1-90|rechts",
      "gerade-114|",
    ]);
    expect(built.elements).toHaveLength(6);
    const kreuzungId = idOf(built.elements[0]);
    expect(built.elements[5]).toMatchObject({ crosses: kreuzungId });
    expectPose(endOf(built.elements), 171n, 57n, 2);
    // sechs Tipps, davon fünf Anhängen und ein Leistenumschalter: fünf Verlaufseinträge
    expect(undoDepth(E, built)).toBe(5);

    const next = E.apply(CATALOG, built, choose("gerade-342"));
    expect(next.elements).toHaveLength(7);
    expect(next.elements.slice(0, 6)).toEqual(built.elements);
    expect(next.elements[6]).toMatchObject({ part: "gerade-342" });
    const r = trace(CATALOG, next.elements, ORIGIN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.steps).toHaveLength(7);
      expectPose(r.steps[5]?.pose, 171n, 57n, 2);
      // 57 + 342 = 399: die Gerade beginnt am gegenüberliegenden Anschluss, nicht am ersten
      expectPose(r.end, 171n, 399n, 2);
    }
  });

  test.skip("[REQ-EDIT-22] gespiegelte Acht: Gerade 114 an Nr. 1–4 (Kurven links) trifft den linken Queranschluss → Querung auf e1", async () => {
    const E = await loadEditor();
    const after = E.apply(CATALOG, loaded(E, MIRROR_1_4), choose("gerade-114"));
    expect(after.elements).toHaveLength(6);
    expect(after.elements.slice(0, 4)).toEqual(MIRROR_1_4);
    expect(after.elements[5]).toMatchObject({ crosses: "e1" });
    const r = trace(CATALOG, after.elements, ORIGIN);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expectPose(r.steps[4]?.pose, 171n, 57n, 6);
      expectPose(r.end, 171n, -57n, 6);
    }
  });

  test.skip("[REQ-EDIT-22] jedes Teil, das das Ende an den Anschluss bringt, löst aus (Gerade 114, Anschlussstück, Rundenzähler); maßgeblich ist der übergebene Katalog", async () => {
    const E = await loadEditor();
    for (const partId of ["gerade-114", "anschlussstueck", "rundenzaehler"]) {
      const after = E.apply(CATALOG, loaded(E, ACHT_1_4), choose(partId));
      expect(shape(after.elements), partId).toEqual([...shape(ACHT_1_4), `${partId}|`, ">e1"]);
    }
    // Kreuzung mit Querweg 116 statt 114: Anschlüsse bei ±58, Gerade 114 trifft nicht
    const wide: Catalog = CATALOG.map((e) =>
      e.id === "kreuzung"
        ? { ...e, geometry: { kind: "kreuzung", length: 342, crossLength: 116 } }
        : e,
    );
    const s = loaded(E, ACHT_1_4, wide);
    const after = E.apply(wide, s, choose("gerade-114"));
    expect(shape(after.elements)).toEqual([...shape(ACHT_1_4), "gerade-114|"]);
    expect(uncrossedPortHits(after.elements, wide)).toEqual([]);
  });

  test.skip("[REQ-EDIT-22] trifft das Ende mehrere ungequerte Kreuzungen, verweist die Querung auf die früheste", async () => {
    const E = await loadEditor();
    const before = [...TWO_1_10, { id: "probe", part: "gerade-114" }];
    expect(uncrossedPortHits(before)).toEqual(["kA", "kB"]);
    const after = E.apply(CATALOG, loaded(E, TWO_1_10), choose("gerade-114"));
    expect(after.elements).toHaveLength(12);
    expect(after.elements.slice(0, 10)).toEqual(TWO_1_10);
    expect(after.elements[10]).toMatchObject({ part: "gerade-114" });
    expect(after.elements[11]).toMatchObject({ crosses: "kA" });
    expect(crossings(after.elements)).toHaveLength(1);
    expect(E.apply(CATALOG, after, undo).elements).toEqual(TWO_1_10);
  });
});

describe("Kein Einfügen außer beim Anhängen", () => {
  test.skip("[REQ-EDIT-22] Ersetzen, das das Ende an den Anschluss bringt, fügt keine Querung ein", async () => {
    const E = await loadEditor();
    const s = run(E, loaded(E, ACHT_G171.slice(0, 5)), [
      select("e5"),
      { type: "setAction", action: "ersetzen" },
    ]);
    const after = E.apply(CATALOG, s, choose("gerade-114"));
    expect(after.elements).toEqual(ACHT_1_5);
    expect(uncrossedPortHits(after.elements)).toEqual(["e1"]);
    // REQ-EDIT-9 bleibt der Weg zur Querung
    expect(E.crossingTarget(CATALOG, after.elements)).toBe("e1");
    expect(undoDepth(E, after)).toBe(2);
  });

  test.skip("[REQ-EDIT-22] Davor einfügen, das das Ende an den Anschluss bringt, fügt keine Querung ein", async () => {
    const E = await loadEditor();
    // Nr. 1–3 und Gerade 114; davor eine Kurve rechts → Geometrie Nr. 1–5
    const start: Elements = [ACHT[0], ACHT[1], ACHT[2], ACHT[4]] as Elements;
    const s = run(E, loaded(E, start), [
      { type: "togglePaletteTurn" },
      select("e5"),
      { type: "setAction", action: "davorEinfuegen" },
    ]);
    const after = E.apply(CATALOG, s, choose("kurve-1-90"));
    expect(shape(after.elements)).toEqual(shape(ACHT_1_5));
    expect(after.elements).toHaveLength(5);
    expect(crossings(after.elements)).toEqual([]);
    expect(uncrossedPortHits(after.elements)).toEqual(["e1"]);
    expect(after.action).toBe("davorEinfuegen");
  });

  test.skip("[REQ-EDIT-22] Löschen, das das Ende an den Anschluss bringt, fügt keine Querung ein", async () => {
    const E = await loadEditor();
    const start: Elements = [...ACHT_1_5, { id: "x", part: "gerade-342" }];
    const after = run(E, loaded(E, start), [select("x"), del]);
    expect(after.elements).toEqual(ACHT_1_5);
    expect(E.crossingTarget(CATALOG, after.elements)).toBe("e1");
  });

  test.skip("[REQ-EDIT-22] Richtung umschalten ist kein Anhängen: bringt es das Ende an den Anschluss, entsteht keine Querung", async () => {
    const E = await loadEditor();
    const start: Elements = ACHT_1_5.map((el) =>
      el.id === "e4" ? { id: "e4", part: "kurve-1-90", turn: "links" as Turn } : el,
    );
    expect(uncrossedPortHits(start)).toEqual([]);
    const after = run(E, loaded(E, start), [select("e4"), { type: "flipSelected" }]);
    expect(after.elements).toEqual(ACHT_1_5);
  });

  test.skip("[REQ-EDIT-22] Laden einer Folge, deren Ende am Anschluss steht, fügt keine Querung ein — im Editor, beim Laden eines gespeicherten Layouts, beim Import und beim Start", async () => {
    const E = await loadEditor();
    const s = loaded(E, ACHT_1_5);
    expect(s.elements).toEqual(ACHT_1_5);
    expect(undoDepth(E, s)).toBe(1);

    const api = await loadSession();
    const clock = fixedClock("2026-11-27T08:15:00.000Z");
    const storage = new MemoryStorage({
      [api.layoutKey("Halbe Acht")]: JSON.stringify(layoutJson(ACHT_1_5)),
    });
    const session = api.createSession({ catalog: CATALOG, storage, clock });
    session.load("Halbe Acht");
    expect(session.state.elements).toEqual(ACHT_1_5);
    session.dispatch({ type: "new" });
    session.importFile("halbe-acht.json", JSON.stringify(layoutJson(ACHT_1_5)));
    expect(session.state.elements).toEqual(ACHT_1_5);
    // Start mit gesichertem Arbeitsstand am Anschluss
    const restarted = api.createSession({ catalog: CATALOG, storage, clock });
    expect(restarted.state.elements).toEqual(ACHT_1_5);
    expect(JSON.parse(storage.data.get(api.WORKING_KEY) as string)).toStrictEqual(
      layoutJson(ACHT_1_5),
    );
  });

  test.skip("[REQ-EDIT-22] Rückgängig und Wiederholen auf einen Stand mit Ende am Anschluss fügen keine Querung ein", async () => {
    const E = await loadEditor();
    const extended = E.apply(CATALOG, loaded(E, ACHT_1_5), choose("gerade-342"));
    expect(crossings(extended.elements)).toEqual([]);
    expect(extended.elements).toHaveLength(6);
    const back = E.apply(CATALOG, extended, undo);
    expect(back.elements).toEqual(ACHT_1_5);
    expect(E.canRedo(back)).toBe(true);
    const empty = E.apply(CATALOG, back, undo);
    expect(empty.elements).toEqual([]);
    const redone = E.apply(CATALOG, empty, redo);
    expect(redone.elements).toEqual(ACHT_1_5);
    expect(E.apply(CATALOG, redone, redo).elements).toEqual(extended.elements);

    // Sonderfall: Rückgängig des automatischen Einfügens, dann Wiederholen → genau Teil + Querung
    const auto = E.apply(CATALOG, loaded(E, ACHT_1_4), choose("gerade-114"));
    const twice = run(E, auto, [undo, redo, undo, redo]);
    expect(twice.elements).toEqual(auto.elements);
    expect(crossings(twice.elements)).toHaveLength(1);
  });
});

describe("Gelöschte Querung und Löschen daneben", () => {
  test.skip("[REQ-EDIT-22] eine gelöschte Querung kommt nicht zurück, bis erneut ein Anhängen den Anschluss trifft", async () => {
    const E = await loadEditor();
    const auto = E.apply(CATALOG, loaded(E, ACHT_1_4), choose("gerade-114"));
    const g114 = idOf(auto.elements[4]);
    const q = idOf(auto.elements[5]);
    const gone = run(E, auto, [select(q), del]);
    expect(gone.elements).toEqual(auto.elements.slice(0, 5));

    // Befehle und Bedienschritte, die kein Anhängen sind, bringen sie nicht zurück
    const stirred = run(E, gone, [
      { type: "togglePaletteTurn" },
      { type: "togglePaletteTurn" },
      select("e1"),
      { type: "selectNext" },
      { type: "clearSelection" },
      undo,
      redo,
    ]);
    expect(stirred.elements).toEqual(gone.elements);
    // REQ-EDIT-9 bleibt verfügbar (Bekannte Grenzen)
    expect(E.crossingTarget(CATALOG, stirred.elements)).toBe("e1");

    // ein Anhängen, das den Anschluss nicht trifft: keine Querung, die Gerade setzt am ersten
    // Anschluss an und überlappt die Kreuzung (Bekannte Grenzen)
    const onward = E.apply(CATALOG, stirred, choose("gerade-342"));
    expect(onward.elements).toHaveLength(6);
    expect(onward.elements.slice(0, 5)).toEqual(gone.elements);
    expect(crossings(onward.elements)).toEqual([]);
    expectPose(endOf(onward.elements), 171n, 285n, 2);

    // Gerade 342 und Gerade 114 weg, Gerade 114 neu angehängt → trifft wieder, Querung kommt
    const lastId = idOf(onward.elements[5]);
    const trimmed = run(E, onward, [select(lastId), del, select(g114), del]);
    expect(trimmed.elements).toEqual(ACHT_1_4);
    const reAppended = E.apply(CATALOG, trimmed, choose("gerade-114"));
    expect(shape(reAppended.elements)).toEqual([...shape(ACHT_1_4), "gerade-114|", ">e1"]);
    const allIds = reAppended.elements.map((el) => el.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(E.apply(CATALOG, reAppended, undo).elements).toEqual(ACHT_1_4);
  });

  test.skip("[REQ-EDIT-22] nach gelöschter Querung hängt „Querung anhängen“ sie wieder an, ein Verlaufseintrag", async () => {
    const E = await loadEditor();
    const auto = E.apply(CATALOG, loaded(E, ACHT_1_4), choose("gerade-114"));
    const gone = run(E, auto, [select(idOf(auto.elements[5])), del]);
    const manual = E.apply(CATALOG, gone, { type: "appendCrossing" });
    expect(shape(manual.elements)).toEqual(shape(auto.elements));
    expect(E.apply(CATALOG, manual, undo).elements).toEqual(gone.elements);
  });

  test.skip("[REQ-EDIT-22] Löschen des ankommenden Teils lässt die Querung stehen; der Kern meldet „Ankunft nicht am Queranschluss“", async () => {
    const E = await loadEditor();
    const auto = E.apply(CATALOG, loaded(E, ACHT_1_4), choose("gerade-114"));
    const q = auto.elements[5] as LayoutElement;
    const after = run(E, auto, [select(idOf(auto.elements[4])), del]);
    expect(after.elements).toEqual([...ACHT_1_4, q]);
    const r = trace(CATALOG, after.elements, ORIGIN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({
        kind: "ankunftNichtAmQueranschluss",
        index: 4,
        id: q.id,
        ref: "e1",
      });
    }
    // ein Anhängen an die fehlerhafte Folge fügt keine zweite Querung ein (Ende unbestimmt)
    const appended = E.apply(CATALOG, after, choose("gerade-114"));
    expect(appended.elements).toHaveLength(6);
    expect(crossings(appended.elements)).toEqual([q]);
  });

  test.skip("[REQ-EDIT-22] Löschen des abgehenden Teils lässt die Querung stehen", async () => {
    const E = await loadEditor();
    const auto = E.apply(CATALOG, loaded(E, ACHT_1_4), choose("gerade-114"));
    const withNext = E.apply(CATALOG, auto, choose("anschlussstueck"));
    expect(withNext.elements).toHaveLength(7);
    expect(withNext.elements.slice(0, 6)).toEqual(auto.elements);
    const after = run(E, withNext, [select(idOf(withNext.elements[6])), del]);
    expect(after.elements).toEqual(auto.elements);
    expect(trace(CATALOG, after.elements, ORIGIN).ok).toBe(true);
  });
});

describe("Kein Einfügen ohne exakten Treffer an einer ungequerten Kreuzung", () => {
  test.skip("[REQ-EDIT-22] bereits gequerte Kreuzung: Ende exakt am Anschluss von e1, aber e1 ist gequert → keine Querung", async () => {
    const E = await loadEditor();
    const probe = [...ACHT_AGAIN, { id: "probe", part: "gerade-114" }];
    // Testdaten: das Ende steht exakt am rechten Queranschluss von e1, und e1 ist gequert
    expectPose(endOf(probe), 171n, -57n, 2);
    expect(uncrossedPortHits(probe)).toEqual([]);
    const after = E.apply(CATALOG, loaded(E, ACHT_AGAIN), choose("gerade-114"));
    expect(after.elements).toHaveLength(15);
    expect(after.elements.slice(0, 14)).toEqual(ACHT_AGAIN);
    expect(after.elements[14]).toMatchObject({ part: "gerade-114" });
    expect(crossings(after.elements)).toEqual([{ id: "e6", crosses: "e1" }]);
  });

  test.skip("[REQ-EDIT-22] Ende nicht exakt am Anschluss (Position oder Richtung) oder Folge fehlerhaft → keine Querung", async () => {
    const E = await loadEditor();
    // Position knapp daneben: Gerade 100 (171, −71), Gerade 171 (171, 0)
    for (const partId of ["gerade-100", "gerade-171"]) {
      const after = E.apply(CATALOG, loaded(E, ACHT_1_4), choose(partId));
      expect(shape(after.elements), partId).toEqual([...shape(ACHT_1_4), `${partId}|`]);
    }
    // Position des linken Anschlusses (171, 57), aber Richtung k = 2 statt k = 6
    const wrongDir = E.apply(CATALOG, loaded(E, ACHT_1_5), choose("gerade-114"));
    expectPose(endOf(wrongDir.elements), 171n, 57n, 2);
    expect(shape(wrongDir.elements)).toEqual([...shape(ACHT_1_5), "gerade-114|"]);
    // fehlerhafte Folge: offenes Ende unbestimmt
    const broken: Elements = [{ id: "z", part: UNKNOWN_ID }, ...ACHT_1_4];
    const afterBroken = E.apply(CATALOG, loaded(E, broken), choose("gerade-114"));
    expect(afterBroken.elements).toHaveLength(6);
    expect(crossings(afterBroken.elements)).toEqual([]);
  });
});

describe("Eigenschaft", () => {
  /** Fehlerfreie Startfolgen, von denen aus ein Anhängen oft einen Anschluss trifft. */
  const STARTS: ReadonlyArray<Elements> = [
    [],
    ACHT_1_4,
    MIRROR_1_4,
    ACHT_1_5,
    ACHT.slice(0, 3),
    TWO_1_10,
    ACHT_AGAIN,
  ];
  const commandArb: fc.Arbitrary<Command> = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...PLACEABLE_IDS).map(choose) },
    {
      weight: 4,
      arbitrary: fc
        .constantFrom("gerade-114", "kurve-1-90", "kreuzung", "anschlussstueck")
        .map(choose),
    },
    { weight: 1, arbitrary: fc.constant<Command>({ type: "togglePaletteTurn" }) },
  );

  test.skip("[REQ-EDIT-22] Eigenschaft: Anhängen an eine fehlerfreie Folge hängt genau dann zusätzlich eine Querung auf die früheste getroffene ungequerte Kreuzung an, wenn das Teil das Ende auf einen ihrer Anschlüsse bringt; danach steht das Ende nie an dem getroffenen Anschluss; ein Rückgängig nimmt beides zurück", async () => {
    const E = await loadEditor();
    let hits = 0;
    let misses = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...STARTS),
        fc.array(commandArb, { maxLength: 12 }),
        (start, commands) => {
          let s = loaded(E, start);
          for (const c of commands) {
            const before = s.elements;
            const next = E.apply(CATALOG, s, c);
            if (c.type === "choosePart" && trace(CATALOG, before, ORIGIN).ok) {
              const n = before.length;
              expect(next.elements.slice(0, n)).toEqual(before);
              const part = next.elements[n] as LayoutElement;
              expect(part).toMatchObject({
                part: c.partId,
                ...(isCurve(CATALOG, c.partId) ? { turn: s.paletteTurn } : {}),
              });
              const withPart = [...before, part];
              const hit = uncrossedPortHits(withPart);
              // dieselbe Prüfung wie REQ-EDIT-9
              expect(E.crossingTarget(CATALOG, withPart)).toBe(hit[0]);
              if (hit.length === 0) {
                misses++;
                expect(next.elements).toHaveLength(n + 1);
              } else {
                hits++;
                expect(next.elements).toHaveLength(n + 2);
                const q = next.elements[n + 1] as LayoutElement;
                expect(q).toMatchObject({ crosses: hit[0] });
                expect(Object.keys(q).sort()).toEqual(["crosses", "id"]);
                expect(before.map((el) => el.id)).not.toContain(q.id);
                expect(q.id).not.toBe(part.id);
                // die getroffene Kreuzung ist danach gequert und kein Treffer mehr
                expect(uncrossedPortHits(next.elements)).not.toContain(hit[0]);
                expect(trace(CATALOG, next.elements, ORIGIN).ok).toBe(true);
              }
              // ein Verlaufseintrag für Teil (und Querung)
              expect(E.apply(CATALOG, next, undo).elements).toEqual(before);
            }
            s = next;
          }
        },
      ),
      { numRuns: 300 },
    );
    // der Erzeuger übt beide Zweige aus
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });
});
