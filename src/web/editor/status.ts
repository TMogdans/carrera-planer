/**
 * Status, Lücke und Winkel, Fehlerliste, Teileverbrauch, Gesamtlänge (Spec M2, REQ-STAT-1 bis -5).
 * Status, Fehler und Verbrauch kommen ausschließlich aus dem Kern (REQ-WARCH-3); Gleitkomma nur
 * für die Anzeige von Lücke und Länge. Zur Form siehe parts.ts.
 */
import {
  type CatalogEntry,
  closure,
  consumption,
  type Offset,
  type TraceError,
  trace,
} from "../../core/index.js";
import { coordToNumber } from "./drawing.js";
import { origin } from "./parts.js";
import type { Catalog, ConsumptionView, Elements, ErrorEntry, StatusView } from "./types.js";

/** Lücke als Text (REQ-STAT-2): ganze mm, ,5 aufwärts; „< 1 mm“ nur bei Versatz ≠ 0. */
export function formatGap(offset: Offset): string {
  const { dx, dy } = offset;
  // a + b·√2 ist mit rationalen a, b genau dann null, wenn a und b null sind.
  const exactZero = (dx.a.num | dx.b.num | dy.a.num | dy.b.num) === 0n;
  const mm = Math.round(Math.hypot(coordToNumber(dx), coordToNumber(dy)));
  return mm === 0 && !exactZero ? "< 1 mm" : `${mm} mm`;
}

export function statusOf(catalog: Catalog, elements: Elements): StatusView {
  const r = closure(catalog, elements, origin());
  if (!r.ok) return { kind: "fehlerhaft" };
  const c = r.closure;
  return c.status === "offen"
    ? { kind: "offen", gapText: formatGap(c.offset), angleDeg: c.angleSteps * 45 }
    : { kind: c.status };
}

function errorText(kind: TraceError["kind"]): string {
  const texts: Readonly<Record<TraceError["kind"], string>> = {
    unbekanntesTeil: "Teil unbekannt",
    nichtPlatzierbar: "Maße fehlen, nicht platzierbar",
    richtungFehlt: "Kurvenrichtung fehlt",
    richtungUeberzaehlig: "Richtung bei Nicht-Kurve",
    ungueltigerVerweis: "Querung verweist auf keine frühere Kreuzung",
    bereitsGequert: "Kreuzung bereits gequert",
    ankunftNichtAmQueranschluss: "Strecke kommt nicht am Queranschluss an",
    doppelteElementId: "doppelte Element-ID",
  };
  return texts[kind];
}

function entryOf(catalog: Catalog, e: TraceError): ErrorEntry {
  return "indices" in e
    ? { numbers: e.indices.map((i) => i + 1), name: e.id, text: errorText(e.kind) }
    : {
        numbers: [e.index + 1],
        name:
          "partId" in e
            ? (catalog.find((entry) => entry.id === e.partId)?.name ?? e.partId)
            : "Querung",
        text: errorText(e.kind),
      };
}

/** Ein Eintrag je Kern-Fehler: Nummer(n), Name, deutscher Text (REQ-STAT-3). */
export function errorEntries(catalog: Catalog, elements: Elements): ReadonlyArray<ErrorEntry> {
  const r = trace(catalog, elements, origin());
  return r.ok ? [] : r.errors.map((e) => entryOf(catalog, e));
}

/** Teileverbrauch aus dem Kern in Katalogreihenfolge (REQ-STAT-4). */
export function consumptionView(catalog: Catalog, elements: Elements): ConsumptionView {
  const r = consumption(catalog, elements);
  if (!r.ok) return { ok: false, text: "Verbrauch nicht bestimmbar" };
  const entries = catalog.flatMap((entry) => {
    const count = r.counts[entry.id];
    return count === undefined ? [] : [{ partId: entry.id, name: entry.name, count }];
  });
  return { ok: true, entries, total: entries.reduce((sum, e) => sum + e.count, 0) };
}

function partLength(g: CatalogEntry["geometry"] | undefined): number | undefined {
  return g?.kind === "gerade" || g?.kind === "kreuzung"
    ? g.length
    : g?.kind === "kurve"
      ? (Math.PI * g.radius * g.angle) / 180
      : undefined;
}

/**
 * Gesamtlänge der Mittellinie in mm (REQ-STAT-5), unabhängig von Lagefehlern. Eine Querung zählt
 * den Querweg einer Kreuzung, die als Teil-Element **vor** ihr steht; sonst ist die Länge unbekannt.
 */
export function totalLength(catalog: Catalog, elements: Elements): number | undefined {
  const byId = new Map(catalog.map((entry) => [entry.id, entry.geometry]));
  const crossLengths = new Map<string, number>();
  let sum = 0;
  for (const el of elements) {
    let length: number | undefined;
    if ("crosses" in el) {
      length = crossLengths.get(el.crosses);
    } else {
      const g = byId.get(el.part);
      if (g?.kind === "kreuzung") crossLengths.set(el.id, g.crossLength);
      length = partLength(g);
    }
    if (length === undefined) return undefined;
    sum += length;
  }
  return sum;
}

/** Meter mit zwei Nachkommastellen und Komma, „–“ ohne bekannte Länge. */
export function formatLength(mm: number | undefined): string {
  return mm === undefined ? "–" : `${(mm / 1000).toFixed(2).replace(".", ",")} m`;
}
