/**
 * Schalter „Namen“ der Werkzeugleiste (Spec plan-beschriftung-symbole, REQ-LBL-7): `aria-pressed`
 * zeigt den Zustand; auf schmalen Bildschirmen nur das Zeichen (Text in `span.label` wie bei den
 * übrigen Knöpfen). Hook-frei.
 */
export function LabelsToggle(props: { readonly on: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      class="labels-toggle"
      aria-pressed={props.on}
      onClick={() => props.onToggle()}
      title="Namen im Plan ein-/ausblenden"
    >
      🏷<span class="label">Namen</span>
    </button>
  );
}
