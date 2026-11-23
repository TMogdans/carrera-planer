/**
 * Verfolgung und Geschlossenheit (Spec M1, REQ-CORE-1 bis -19 und -23 bis -31).
 *
 * Reine Funktionen, Fehler sind Rückgabewerte (REQ-CORE-19). Ablauf in einem Durchgang über die
 * Elemente; nur doppelte Element-IDs werden vorab gesammelt, weil eine Querung auch durch ein
 * späteres Element mit gleicher ID fehlerhaft wird (REQ-CORE-29).
 *
 * `pose` ist die Ausgangspose des letzten Elements, solange alles davor fehlerfrei verfolgt ist.
 * Ab dem ersten fehlerhaften Element und nach einem Ankunftsfehler ist sie `undefined`: Die Lage
 * ist dann unbestimmt, und es wird keine Ankunft mehr beurteilt (REQ-CORE-28).
 */
import { key, negQuarters, type State, shift, toDir, toPose, type Vec4 } from "./geometry.js";
import type {
  CatalogEntry,
  ClosureResult,
  LayoutElement,
  Pose,
  Step,
  TraceError,
  TraceResult,
  Turn,
} from "./types.js";

type PlaceableGeometry = Extract<
  CatalogEntry["geometry"],
  { readonly kind: "gerade" | "kurve" | "kreuzung" }
>;
type PortStates = { readonly left: State; readonly right: State };
type InternalStep = { readonly state: State; readonly ports?: PortStates };
type Run = {
  readonly errors: ReadonlyArray<TraceError>;
  readonly steps: ReadonlyArray<InternalStep>;
  readonly start: State;
  readonly end: State | undefined;
};

const ORIGIN: Vec4 = [0n, 0n, 0n, 0n];

/** Ein platzierbares Teil aus der Pose `p`; liefert den Schritt (bei Kreuzung mit Anschlüssen). */
const place = (p: State, g: PlaceableGeometry, turn: Turn | undefined): InternalStep => {
  if (g.kind === "kurve") {
    // Mittelpunkt R in Drehrichtung neben dem Eingang; vom Mittelpunkt zurück zum Eingang ist
    // die Gegenrichtung, um die Drehung weitergedreht liegt der Ausgang.
    const links = turn === "links";
    const turnSteps = g.angle === 90 ? 2 : 1;
    const signed = links ? turnSteps : -turnSteps;
    const f = 2n * BigInt(g.radius);
    const center = shift(p.v, f, p.dir + (links ? 2 : 6));
    return {
      state: { v: shift(center, f, p.dir + (links ? 6 : 2) + signed), dir: toDir(p.dir + signed) },
    };
  }
  const out: State = { v: shift(p.v, 2n * BigInt(g.length), p.dir), dir: p.dir };
  if (g.kind === "gerade") return { state: out };
  // Kreuzung: Queranschlüsse halbe Länge hinter dem Eingang, halbe Querweglänge seitlich; die
  // Richtung zeigt jeweils in die Kreuzung hinein.
  const mid = shift(p.v, BigInt(g.length), p.dir);
  const side = BigInt(g.crossLength);
  return {
    state: out,
    ports: {
      left: { v: shift(mid, side, p.dir + 2), dir: toDir(p.dir + 6) },
      right: { v: shift(mid, side, p.dir + 6), dir: toDir(p.dir + 2) },
    },
  };
};

const run = (
  catalog: ReadonlyArray<CatalogEntry>,
  elements: ReadonlyArray<LayoutElement>,
  startPose: Pose,
): Run => {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const errors: TraceError[] = [];

  const positions = new Map<string, number[]>();
  elements.forEach((el, index) => {
    const known = positions.get(el.id);
    if (known === undefined) positions.set(el.id, [index]);
    else known.push(index);
  });
  const duplicates = new Set<string>();
  for (const [id, indices] of positions) {
    if (indices.length > 1) {
      duplicates.add(id);
      errors.push({ kind: "doppelteElementId", id, indices });
    }
  }

  const start: State = { v: ORIGIN, dir: toDir(startPose.dir) };
  const crossingIds = new Set<string>();
  const crossed = new Set<string>();
  const portsById = new Map<string, PortStates | undefined>();
  const steps: InternalStep[] = [];
  let pose: State | undefined = start;

  elements.forEach((el, index) => {
    // Fehlerhaft (REQ-CORE-28): doppelte ID oder ein Fehler nach REQ-CORE-16/-17/-18/-25/-26.
    let faulty = duplicates.has(el.id);
    const fail = (error: TraceError): void => {
      errors.push(error);
      faulty = true;
    };
    if ("crosses" in el) {
      const ref = el.crosses;
      if (!crossingIds.has(ref)) {
        fail({ kind: "ungueltigerVerweis", index, id: el.id, ref });
      } else if (crossed.has(ref)) {
        fail({ kind: "bereitsGequert", index, id: el.id, ref });
      } else {
        crossed.add(ref);
      }
      if (!faulty && pose !== undefined) {
        // Gültiger Verweis, alles davor fehlerfrei verfolgt: die verwiesene Kreuzung liegt
        // davor und wurde mit ihren Anschlüssen verfolgt.
        const ports = portsById.get(ref) as PortStates;
        const arrival = key(pose);
        const exit =
          arrival === key(ports.left)
            ? ports.right
            : arrival === key(ports.right)
              ? ports.left
              : undefined;
        if (exit === undefined) {
          errors.push({
            kind: "ankunftNichtAmQueranschluss",
            index,
            id: el.id,
            ref,
            arrival: toPose(startPose, pose),
          });
          pose = undefined;
        } else {
          pose = { v: exit.v, dir: pose.dir };
          steps.push({ state: pose });
        }
      }
    } else {
      const partId = el.part;
      const entry = byId.get(partId);
      if (entry === undefined) {
        fail({ kind: "unbekanntesTeil", index, partId });
      } else {
        const g = entry.geometry;
        if (g.kind === "kreuzung") crossingIds.add(el.id);
        if (g.kind === "masseFehlen" || g.kind === "baugruppe") {
          fail({ kind: "nichtPlatzierbar", index, partId });
        } else if ((g.kind === "kurve") !== (el.turn !== undefined)) {
          fail({
            kind: g.kind === "kurve" ? "richtungFehlt" : "richtungUeberzaehlig",
            index,
            partId,
          });
        } else if (pose !== undefined) {
          const step = place(pose, g, el.turn);
          portsById.set(el.id, step.ports);
          steps.push(step);
          pose = step.state;
        }
      }
    }
    if (faulty) pose = undefined;
  });

  return { errors, steps, start, end: pose };
};

/** Verfolgt ein Layout ab `start` und liefert die Pose nach jedem Element (REQ-CORE-1). */
export const trace = (
  catalog: ReadonlyArray<CatalogEntry>,
  elements: ReadonlyArray<LayoutElement>,
  start: Pose,
): TraceResult => {
  const r = run(catalog, elements, start);
  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  const steps = r.steps.map(
    (s): Step =>
      s.ports === undefined
        ? { pose: toPose(start, s.state) }
        : {
            pose: toPose(start, s.state),
            crossPorts: { left: toPose(start, s.ports.left), right: toPose(start, s.ports.right) },
          },
  );
  // Ohne Fehler ist `end` die Pose nach dem letzten Element (beim leeren Layout die Startpose).
  return { ok: true, steps, end: toPose(start, r.end as State) };
};

/**
 * Geschlossenheit (REQ-CORE-10 bis -12, -15): leer, geschlossen (exakt Startpose) oder offen mit
 * Versatz Ende → Start und Winkel Start − Ende in 45°-Stufen im Bereich −3 … 4.
 */
export const closure = (
  catalog: ReadonlyArray<CatalogEntry>,
  elements: ReadonlyArray<LayoutElement>,
  start: Pose,
): ClosureResult => {
  const r = run(catalog, elements, start);
  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  if (elements.length === 0) return { ok: true, closure: { status: "leer" } };
  const end = r.end as State;
  const angle = toDir(r.start.dir - end.dir);
  const offset = {
    dx: { a: negQuarters(end.v[0]), b: negQuarters(end.v[1]) },
    dy: { a: negQuarters(end.v[2]), b: negQuarters(end.v[3]) },
  };
  return {
    ok: true,
    closure: {
      status: key(end) === key(r.start) ? "geschlossen" : "offen",
      offset,
      angleSteps: angle > 4 ? angle - 8 : angle,
    },
  };
};
