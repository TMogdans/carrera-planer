/**
 * Bestandsdialog (Spec M3a, REQ-BUI-1/-2/-5): je bestandsfähigem Katalogeintrag Name, Nummern,
 * Anzahl mit „−“, „+“ und Zahlenfeld; Set-Vorlagen mit Rückfrage; „Bestand leeren“; defekte
 * Bestandssicherungen. Alle Regeln liegen in der Logik (src/web/editor); Bestätigungen fragt die
 * Oberfläche und reicht sie ausdrücklich weiter.
 */
import { useState } from "preact/hooks";
import type { CatalogEntry } from "../../core/index.js";
import {
  decrementAvailable,
  isStockable,
  type PlannerMessage,
  type PlannerSession,
  type SetTemplate,
} from "../editor/index.js";
import { download } from "./browser.js";

type Props = {
  readonly session: PlannerSession;
  readonly catalog: ReadonlyArray<CatalogEntry>;
  readonly templates: ReadonlyArray<SetTemplate>;
  readonly onClose: () => void;
  readonly onChange: () => void;
};

/** Artikelnummern und Prägungen eines Eintrags als Text (zum Wiederfinden des Teils). */
export const numbersOf = (entry: CatalogEntry): string => {
  const parts = [
    ...(entry.articleNumbers === "keineEigene" ? [] : entry.articleNumbers),
    ...(entry.praegung ?? []).map((p) => `Prägung ${p.value}`),
  ];
  return parts.length > 0 ? parts.join(", ") : "keine Artikelnummer";
};

export function InventoryDialog({ session, catalog, templates, onClose, onChange }: Props) {
  const readDefects = () => session.inventoryDefectBackups();
  const [defects, setDefects] = useState(readDefects);
  const [pending, setPending] = useState<SetTemplate | undefined>(undefined);
  const [problems, setProblems] = useState<ReadonlyArray<PlannerMessage>>([]);
  const [note, setNote] = useState("");
  // Meldungen aus dem Abgleich mit anderen Tabs, die bei offenem Dialog kommen (REQ-BEST-10):
  // auch hier sichtbar, weil der Dialog die Meldungsleiste verdeckt.
  const [openedAt] = useState(session.messages.length);
  const fromTabs = session.messages
    .slice(openedAt)
    .filter((m) => m.kind === "bestandAbgleichKaputt" && !problems.includes(m));
  const shown = [...fromTabs, ...problems];

  /** Führt eine Aktion aus; Meldungen, die sie erzeugt, zeigt der Dialog selbst (REQ-BUI-5). */
  const act = (fn: () => void): void => {
    const before = session.messages.length;
    fn();
    setProblems(session.messages.slice(before));
    onChange();
  };

  const nameOf = (id: string): string => catalog.find((e) => e.id === id)?.name ?? id;
  const stockable = catalog.filter((e) => isStockable(catalog, e.id));
  const count = (id: string): number => session.inventory[id] ?? 0;

  return (
    <div class="dialog-backdrop">
      <div class="dialog inventory" role="dialog" aria-modal="true" aria-label="Bestand">
        <div class="dialog-head">
          <h2>Bestand</h2>
          <button type="button" aria-label="Dialog schließen" onClick={onClose}>
            ✕
          </button>
        </div>
        {note !== "" && <p class="note">{note}</p>}
        {shown.length > 0 && (
          <ul class="dialog-problems" role="alert">
            {shown.map((m, i) => (
              <li key={`${m.kind}${i}`}>{m.text}</li>
            ))}
          </ul>
        )}

        <h3>Packung hinzufügen</h3>
        {pending === undefined ? (
          <div class="set-list">
            {templates.map((t) => (
              <button
                type="button"
                class="set-item"
                key={t.id}
                onClick={() => {
                  setNote("");
                  setPending(t);
                }}
              >
                <strong>{t.name}</strong>
                <span>Art.-Nr. {t.articleNumber}</span>
                <span class="certainty">Sicherheit {t.certainty}</span>
                {t.certainty !== "hoch" && <span class="unchecked">Inhalt ungeprüft</span>}
              </button>
            ))}
          </div>
        ) : (
          <section class="confirm-set" aria-label={`${pending.name} hinzufügen`}>
            <p>
              <strong>{pending.name}</strong> (Art.-Nr. {pending.articleNumber}) zum Bestand
              hinzufügen?
              {pending.certainty !== "hoch" && <span class="unchecked"> Inhalt ungeprüft.</span>}
            </p>
            <ul class="set-contents">
              {pending.contents.map((c) => (
                <li key={c.part}>
                  {nameOf(c.part)} × {c.count}
                </li>
              ))}
              <li class="usage-total">
                zusammen {pending.contents.reduce((s, c) => s + c.count, 0)} Teile
              </li>
            </ul>
            <div class="file-row">
              <button
                type="button"
                class="primary"
                onClick={() => {
                  const t = pending;
                  act(() => session.addSet(t.id, true));
                  setPending(undefined);
                  setNote(`„${t.name}“ hinzugefügt.`);
                }}
              >
                Hinzufügen
              </button>
              <button type="button" onClick={() => setPending(undefined)}>
                Abbrechen
              </button>
            </div>
          </section>
        )}

        <h3>Teile</h3>
        <ul class="stock-list">
          {stockable.map((e) => {
            const n = count(e.id);
            return (
              <li key={e.id} class="stock-row">
                <span class="stock-name">
                  {e.name}
                  <small class="numbers">{numbersOf(e)}</small>
                </span>
                <span class="stock-controls">
                  <button
                    type="button"
                    aria-label={`${e.name}: eins weniger`}
                    disabled={!decrementAvailable(catalog, session.inventory, e.id)}
                    onClick={() => act(() => session.decrement(e.id))}
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`${e.name}: Anzahl`}
                    value={String(n)}
                    onChange={(ev) => {
                      const input = ev.currentTarget;
                      act(() => session.setCount(e.id, input.value));
                      // Abgewiesene Eingabe: das Feld zeigt wieder die geltende Anzahl.
                      input.value = String(count(e.id));
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`${e.name}: eins mehr`}
                    onClick={() => act(() => session.increment(e.id))}
                  >
                    +
                  </button>
                </span>
              </li>
            );
          })}
        </ul>

        <div class="file-row clear-row">
          <button
            type="button"
            class="danger"
            onClick={() => {
              const ok = window.confirm("Den ganzen Bestand leeren?");
              act(() => session.clearInventory(ok));
              if (ok) setNote("Bestand geleert.");
            }}
          >
            Bestand leeren
          </button>
        </div>

        {defects.length > 0 && (
          <>
            <h3>Defekte Bestandssicherungen</h3>
            <ul class="list">
              {defects.map((k) => (
                <li key={k}>
                  <span class="list-name">{k}</span>
                  <button
                    type="button"
                    onClick={() => {
                      let raw: string | undefined;
                      act(() => {
                        raw = session.inventoryDefectRawText(k);
                      });
                      if (raw !== undefined) {
                        download(`${k.replaceAll(":", "_")}.txt`, raw, "text/plain");
                      }
                    }}
                  >
                    Rohtext
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Defekte Bestandssicherung „${k}“ löschen?`)) {
                        act(() => session.deleteInventoryDefect(k));
                        setDefects(readDefects());
                      }
                    }}
                  >
                    Löschen
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
