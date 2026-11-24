/**
 * Barrel der Editor-Logik: nur Re-Exporte und eine reine Typprüfung (keine Logik, weil der
 * Stryker-Ratchet `index.ts` ausnimmt).
 *
 * Die Tests laden die Module dynamisch über einen Pfad in einer Variablen; ohne die Prüfung unten
 * sähe `tsc` nie, ob die Exporte den Vertragstypen aus src/web/test-support/editor-fixtures.ts
 * genügen.
 */
import type {
  DrawingApi,
  EditorApi,
  SessionApi,
  StatusApi,
} from "../test-support/editor-fixtures.js";
import type * as drawing from "./drawing.js";
import type * as editor from "./editor.js";
import type * as session from "./session.js";
import type * as status from "./status.js";

type Satisfies<T extends U, U> = T;
export type ContractCheck = [
  Satisfies<typeof editor, EditorApi>,
  Satisfies<typeof status, StatusApi>,
  Satisfies<typeof drawing, DrawingApi>,
  Satisfies<typeof session, SessionApi>,
];

export * from "./drawing.js";
export * from "./editor.js";
export { origin } from "./parts.js";
export * from "./session.js";
export * from "./status.js";
export type * from "./types.js";
