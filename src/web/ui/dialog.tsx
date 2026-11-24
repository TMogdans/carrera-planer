/**
 * Speichern/Laden-Dialog (Spec M2, REQ-UI-9): Namensfeld, gespeicherte Layouts (Laden, Löschen),
 * defekte Sicherungen (Rohtext herunterladen, Löschen), Exportieren und Importieren.
 * Bestätigungen (Überschreiben, Löschen) fragt die Oberfläche; die Logik verlangt sie ausdrücklich.
 */
import { useState } from "preact/hooks";
import type { Session } from "../editor/index.js";
import { download } from "./browser.js";

type Props = {
  readonly session: Session;
  readonly onClose: () => void;
  readonly onChange: () => void;
  readonly afterLoad: () => void;
};

export function StorageDialog({ session, onClose, onChange, afterLoad }: Props) {
  const [name, setName] = useState(session.name ?? "");
  const [note, setNote] = useState("");
  const [, setTick] = useState(0);
  const refresh = () => {
    setTick((t) => t + 1);
    onChange();
  };

  const save = () => {
    let r = session.saveAs(name);
    if (!r.ok && r.reason === "existiert") {
      if (!window.confirm(`„${name.trim()}“ gibt es schon. Überschreiben?`)) return;
      r = session.saveAs(name, { overwrite: true });
    }
    if (r.ok) setNote(`Gespeichert als „${name.trim()}“.`);
    else if (r.reason === "nameLeer") setNote("Bitte einen Namen eingeben.");
    else setNote("Speichern nicht möglich (siehe Meldung).");
    refresh();
  };

  const names = session.savedNames();
  const defects = session.defectBackups();

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
                    session.load(n);
                    setName(session.name ?? name);
                    refresh();
                    afterLoad();
                  }}
                >
                  Laden
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`„${n}“ löschen?`)) {
                      session.deleteSaved(n);
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
                      const raw = session.defectRawText(k);
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
                        session.deleteDefect(k);
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
                const before = session.messages.length;
                session.importFile(file.name, text);
                if (session.messages.length === before) {
                  setName(session.name ?? "");
                  afterLoad();
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
