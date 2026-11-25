/**
 * Barrel der Editor-Logik: nur Re-Exporte und eine reine Typprüfung (keine Logik, weil der
 * Stryker-Ratchet `index.ts` ausnimmt).
 *
 * Die Tests laden die Module dynamisch über einen Pfad in einer Variablen; ohne die Prüfung unten
 * sähe `tsc` nie, ob die Exporte den Vertragstypen aus src/web/test-support/editor-fixtures.ts
 * genügen (M2: editor-fixtures.ts, M3a: bestand-fixtures.ts).
 */
import type {
  InventoryApi,
  PlannerMessage,
  PlannerSession,
  PlannerSessionApi,
} from "../test-support/bestand-fixtures.js";
import type {
  CatalogEntry,
  DrawingApi,
  EditorApi,
  ElementShape,
  LayoutElement,
  ScreenPoint,
  SessionApi,
  StatusApi,
} from "../test-support/editor-fixtures.js";
import type * as drawing from "./drawing.js";
import type * as editor from "./editor.js";
import type * as inventory from "./inventory.js";
import type * as labels from "./labels.js";
import type * as plannerSession from "./planner-session.js";
import type * as session from "./session.js";
import type * as status from "./status.js";

type Satisfies<T extends U, U> = T;

/**
 * Spec plan-beschriftung-symbole: Erweiterung der Planer-Sitzung und Schnittstelle von
 * labels.ts, wie labels-session.test.ts und labels.test.ts sie festlegen (dort als Typen im Test,
 * weil src/web/test-support im geschützten Satz liegt). Die neue Meldung erweitert die
 * Meldungsliste, deshalb prüft die Sitzung gegen diese Erweiterung statt gegen PlannerSessionApi.
 */
type LabelMessageContract = {
  readonly kind: "beschriftungUngueltig";
  readonly value: string;
  readonly text: string;
};
type LabelPlannerSessionApi = {
  createPlannerSession(deps: Parameters<PlannerSessionApi["createPlannerSession"]>[0]): Omit<
    PlannerSession,
    "messages"
  > & {
    readonly messages: ReadonlyArray<PlannerMessage | LabelMessageContract>;
    readonly labels: boolean;
    setLabels(on: boolean): void;
  };
};
type SymbolKindContract = "zielflagge" | "stecker" | "spurwechsel" | "engstelle";
type LabelVariantContract = "keine" | "kurz" | "voll" | "nurSymbol" | "symbolUndName";
type LabelsApi = {
  labelTexts(
    catalog: ReadonlyArray<CatalogEntry>,
    partId: string,
  ): { readonly full: string; readonly short: string | undefined } | undefined;
  symbolOf(partId: string): SymbolKindContract | undefined;
  textWidth(text: string): number;
  labelVariant(
    catalog: ReadonlyArray<CatalogEntry>,
    partId: string,
    room: number,
    on: boolean,
  ): LabelVariantContract;
  labelPoint(shape: ElementShape): ScreenPoint;
  labelPlan(
    catalog: ReadonlyArray<CatalogEntry>,
    elements: ReadonlyArray<LayoutElement>,
    shapes: ReadonlyArray<ElementShape>,
    scale: number,
    on: boolean,
  ): ReadonlyArray<{
    readonly id: string;
    readonly partId: string;
    readonly variant: LabelVariantContract;
    readonly text: string | undefined;
    readonly fullName: string;
    readonly symbol: SymbolKindContract | undefined;
    readonly at: ScreenPoint;
  }>;
};

export type ContractCheck = [
  Satisfies<typeof editor, EditorApi>,
  Satisfies<typeof status, StatusApi>,
  Satisfies<typeof drawing, DrawingApi>,
  Satisfies<typeof session, SessionApi>,
  Satisfies<typeof inventory, InventoryApi>,
  Satisfies<typeof plannerSession, LabelPlannerSessionApi>,
  Satisfies<typeof labels, LabelsApi>,
];

export * from "./drawing.js";
export * from "./editor.js";
export * from "./inventory.js";
export * from "./labels.js";
export { origin } from "./parts.js";
export * from "./planner-session.js";
export * from "./session.js";
export * from "./status.js";
export type * from "./types.js";
