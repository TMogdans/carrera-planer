/**
 * Einkaufsliste (Spec M3a, REQ-BUI-4): je Zeile Name, benötigt, vorhanden, fehlt und Suchbegriffe,
 * dazu die Summe. Artikelnummern und Prägungen stehen als markierbarer Text da (zum Kopieren in
 * eine Händler- oder Kleinanzeigensuche). Inhalt aus der Logik (`shoppingList`).
 */
import type { ShoppingList } from "../editor/index.js";

type Props = {
  readonly list: ShoppingList;
  readonly onClose: () => void;
};

export function ShoppingDialog({ list, onClose }: Props) {
  return (
    <div class="dialog-backdrop">
      <div class="dialog shopping" role="dialog" aria-modal="true" aria-label="Einkaufsliste">
        <div class="dialog-head">
          <h2>Einkaufsliste</h2>
          <button type="button" aria-label="Dialog schließen" onClick={onClose}>
            ✕
          </button>
        </div>
        {!list.ok ? (
          <p class="note">{list.text}</p>
        ) : list.rows.length === 0 ? (
          <p class="note">{list.text}</p>
        ) : (
          <>
            <ul class="shopping-list">
              {list.rows.map((r) => (
                <li key={r.partId} class="shopping-row">
                  <div class="shopping-head">
                    <strong>{r.name}</strong>
                    <span class="shopping-missing">fehlt {r.missing}</span>
                  </div>
                  <div class="shopping-counts">
                    benötigt {r.needed}, vorhanden {r.have}
                  </div>
                  <ul class="search-terms">
                    {r.searchTerms.map((t) => (
                      <li key={t.text} class={`term term-${t.kind}`}>
                        {t.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p class="usage-total">zusammen {list.total} Teile</p>
          </>
        )}
      </div>
    </div>
  );
}
