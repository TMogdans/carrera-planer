/**
 * Symbole der Sonderteile im Plan (Spec plan-beschriftung-symbole, REQ-SYM-2 bis -5): im Code
 * gezeichnete Pfade auf einer hellen 16 × 16-Plakette mit dunkler Kontur, in Bildschirm-Pixeln
 * (der Aufrufer skaliert auf Bildschirmpixel zurück). Unterscheidung über die Form, nicht über die
 * Farbe: Schachbrett (Zielflagge), Körper mit zwei Stiften und Kabel (Stecker), zwei Spurlinien
 * mit Diagonale (Spurwechsel), zwei Linien mit Taille (Engstelle). Keine Bilder, keine Verweise
 * nach außen. Hook-frei.
 */
import type { SymbolKind } from "../editor/index.js";

/** Dunkle Felder des Schachbretts: 4 × 4 Felder à 3 px ab (2, 2), abwechselnd. */
const CHECKER: ReadonlyArray<readonly [number, number]> = [0, 1, 2, 3].flatMap((row) =>
  [0, 1, 2, 3].flatMap((col) =>
    (row + col) % 2 === 0 ? [[2 + col * 3, 2 + row * 3] as const] : [],
  ),
);

function Shapes({ kind }: { readonly kind: SymbolKind }) {
  switch (kind) {
    case "zielflagge":
      return (
        <>
          {CHECKER.map(([x, y]) => (
            <rect key={`${x},${y}`} class="symbol-fill" x={x} y={y} width={3} height={3} />
          ))}
          <rect class="symbol-line" x={2} y={2} width={12} height={12} />
        </>
      );
    case "stecker":
      return (
        <>
          <path class="symbol-line" d="M5 4V7M9 4V7" />
          <rect class="symbol-fill" x={3} y={7} width={8} height={5} />
          <path class="symbol-line" d="M7 12V14H13V9" />
        </>
      );
    case "spurwechsel":
      return (
        <>
          <path class="symbol-line" d="M2 5H14M2 11H14" />
          <path class="symbol-line symbol-strong" d="M4 11L12 5" />
        </>
      );
    case "engstelle":
      return <path class="symbol-line" d="M2 3L8 6.5L14 3M2 13L8 9.5L14 13" />;
  }
}

/**
 * Symbol mit Plakette, linke obere Ecke bei (x, y) in Bildschirm-Pixeln. Das `<title>` trägt den
 * vollen Namen (REQ-SYM-4).
 */
export function PlanSymbol(props: {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}) {
  return (
    <g class="symbol" transform={`translate(${props.x} ${props.y})`}>
      <title>{props.name}</title>
      <rect class="symbol-plate" x={0} y={0} width={16} height={16} rx={2} />
      <Shapes kind={props.kind} />
    </g>
  );
}
