/**
 * Teileverbrauch (Spec M1, REQ-CORE-20 bis -22): je Katalogeintrag die Anzahl verbrauchter Teile.
 * Braucht keine Geometrie; Baugruppen werden in ihre Bestandteile aufgelöst und selbst nicht
 * gezählt. Querungen verbrauchen nichts, Richtungen und Element-IDs werden nicht geprüft.
 */
import type { CatalogEntry, ConsumptionResult, LayoutElement, UnknownPartError } from "./types.js";

export const consumption = (
  catalog: ReadonlyArray<CatalogEntry>,
  elements: ReadonlyArray<LayoutElement>,
): ConsumptionResult => {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const counts: Record<string, number> = {};
  const errors: UnknownPartError[] = [];
  elements.forEach((el, index) => {
    if ("crosses" in el) return;
    const entry = byId.get(el.part);
    if (entry === undefined) {
      errors.push({ kind: "unbekanntesTeil", index, partId: el.part });
      return;
    }
    const g = entry.geometry;
    const parts = g.kind === "baugruppe" ? g.parts : [{ part: entry.id, count: 1 }];
    for (const p of parts) counts[p.part] = (counts[p.part] ?? 0) + p.count;
  });
  return errors.length === 0 ? { ok: true, counts } : { ok: false, errors };
};
