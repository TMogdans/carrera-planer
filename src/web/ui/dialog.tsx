/**
 * Speichern/Laden-Dialog (Spec M2, REQ-UI-9): Namensfeld, gespeicherte Layouts (Laden, Löschen),
 * defekte Sicherungen (Rohtext herunterladen, Löschen), Exportieren und Importieren.
 * Bestätigungen (Überschreiben, Löschen) fragt die Oberfläche; die Logik verlangt sie ausdrücklich.
 */
import { useState } from "preact/hooks";
import type { PlannerMessage, PlannerSession, SaveResult } from "../editor/index.js";
import { download } from "./browser.js";

type Props = {
  readonly session: PlannerSession;
  readonly onClose: () => void;
  readonly onChange: () => void;
  readonly afterLoad: () => void;
};

export function StorageDialog({ session, onClose, onChange, afterLoad }: Props) {
  const [name, setName] = useState(session.name ?? "");
  const [note, setNote] = useState("");
  // Speicherabfragen nur beim Öffnen und nach Aktionen, nicht bei jedem Rendern (REQ-STORE-8).
  const readLists = () => ({ names: session.savedNames(), defects: session.defectBackups() });
  const [lists, setLists] = useState(readLists);
  // Meldungen, die eine Aktion im Dialog ausgelöst hat, zeigt der Dialog selbst (REQ-UI-9).
  const [problems, setProblems] = useState<ReadonlyArray<PlannerMessage>>([]);
  const refresh = () => {
    setLists(readLists());
    onChange();
  };
  /** Führt eine Aktion aus und liefert die Meldungen, die sie erzeugt hat. */
  const act = (fn: () => void): ReadonlyArray<PlannerMessage> => {
    const before = session.messages.length;
    fn();
    const added = session.messages.slice(before);
    setProblems(added);
    return added;
  };

  const save = () => {
    let r: SaveResult = { ok: false, reason: "nameLeer" };
    act(() => {
      r = session.saveAs(name);
    });
    if (!r.ok && r.reason === "existiert") {
      if (!window.confirm(`„${name.trim()}“ gibt es schon. Überschreiben?`)) return;
      act(() => {
        r = session.saveAs(name, { overwrite: true });
      });
    }
    if (r.ok) setNote(`Gespeichert als „${name.trim()}“.`);
    else if (r.reason === "nameLeer") setNote("Bitte einen Namen eingeben.");
    else setNote("Speichern nicht möglich.");
    refresh();
  };

  const { names, defects } = lists;

  return (
    <div class="dialog-backdrop">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Speichern und Laden">
        <div class="dialog-head">
          <h2>Speichern und Laden</h2>
          <button type="button" aria-label="Dialog schließen" onClick={onClose}>
            ✕
          </button>
        </div>
        <form
          class="save-row"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            type="text"
            aria-label="Layoutname"
            placeholder="Name der Strecke"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <button type="submit">Speichern</button>
        </form>
        {note !== "" && <p class="note">{note}</p>}
        {problems.length > 0 && (
          <ul class="dialog-problems" role="alert">
            {problems.map((m, i) => (
              <li key={`${m.kind}${i}`}>{m.text}</li>
            ))}
          </ul>
        )}

        <h3>Gespeicherte Strecken</h3>
        {names.length === 0 ? (
          <p class="empty">Noch keine gespeicherten Strecken.</p>
        ) : (
          <ul class="list">
            {names.map((n) => (
              <li key={n}>
                <span class="list-name">{n}</span>
                <button
                  type="button"
                  onClick={() => {
                    const added = act(() => session.load(n));
                    const failed = added.some((m) => m.kind === "ladenFehlgeschlagen");
                    setNote(failed ? "" : `„${n}“ geladen.`);
                    if (!failed) {
                      setName(session.name ?? name);
                      afterLoad();
                    }
                    refresh();
                  }}
                >
                  Laden
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`„${n}“ löschen?`)) {
                      act(() => session.deleteSaved(n));
                      refresh();
                    }
                  }}
                >
                  Löschen
                </button>
              </li>
            ))}
          </ul>
        )}

        {defects.length > 0 && (
          <>
            <h3>Defekte Sicherungen</h3>
            <ul class="list">
              {defects.map((k) => (
                <li key={k}>
                  <span class="list-name">{k}</span>
                  <button
                    type="button"
                    onClick={() => {
                      let raw: string | undefined;
                      act(() => {
                        raw = session.defectRawText(k);
                      });
                      if (raw !== undefined) {
                        download(`${k.replaceAll(":", "_")}.txt`, raw, "text/plain");
                      }
                      refresh();
                    }}
                  >
                    Rohtext
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Defekte Sicherung „${k}“ löschen?`)) {
                        act(() => session.deleteDefect(k));
                        refresh();
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

        <h3>Datei</h3>
        <div class="file-row">
          <button
            type="button"
            onClick={() => {
              const file = session.exportFile();
              download(file.fileName, file.text);
            }}
          >
            Exportieren
          </button>
          <label class="button">
            Importieren
            <input
              type="file"
              accept=".json,application/json"
              class="visually-hidden"
              onChange={async (e) => {
                const input = e.target as HTMLInputElement;
                const file = input.files?.[0];
                input.value = "";
                if (file === undefined) return;
                const text = await file.text();
                // Erfolg heißt: keine Import-Meldung. Eine Meldung der Autosicherung (Speicher
                // gesperrt) ist kein gescheiterter Import (REQ-STORE-10/-11).
                const added = act(() => session.importFile(file.name, text));
                if (!added.some((m) => m.kind === "importFehlgeschlagen")) {
                  setName(session.name ?? "");
                  setNote(`„${file.name}“ importiert.`);
                  afterLoad();
                } else {
                  setNote("");
                }
                refresh();
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
