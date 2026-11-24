/**
 * Anbindung an den Browser: Speicher, Uhr, Download (Spec M2, REQ-STORE-1/-9, REQ-UI-9).
 * Nur hier und in den Komponenten werden DOM-Globale benutzt; die Editor-Logik bekommt alles
 * eingereicht (REQ-WARCH-1).
 */
import type { Clock, KeyValueStorage } from "../editor/index.js";

/**
 * `localStorage`, oder – wenn schon der Zugriff darauf scheitert (Speicher in den
 * Website-Einstellungen gesperrt) – ein Speicher, der bei jedem Zugriff wirft. Die Sitzung macht
 * daraus Meldungen und bleibt bedienbar (REQ-STORE-8).
 */
export const browserStorage = (): KeyValueStorage => {
  try {
    const s = window.localStorage;
    // Manche Browser liefern das Objekt, werfen aber erst beim Zugriff.
    void s.length;
    return s;
  } catch (e) {
    const fail = (): never => {
      throw e;
    };
    return {
      getItem: fail,
      setItem: fail,
      removeItem: fail,
      key: fail,
      get length(): number {
        return fail();
      },
    };
  }
};

/**
 * Änderungen an `localStorage` aus anderen Tabs (Spec M3a, REQ-BEST-10): ruft `onChange` mit dem
 * geänderten Schlüssel (null = alles gelöscht). Ereignisse anderer Speicherbereiche
 * (`sessionStorage`) zählen nicht. Liefert die Abmeldung.
 */
export const onLocalStorageChange = (onChange: (key: string | null) => void): (() => void) => {
  const listener = (e: StorageEvent) => {
    let local: Storage | undefined;
    try {
      local = window.localStorage;
    } catch {
      return;
    }
    if (e.storageArea === local) onChange(e.key);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};

/** Browser-Uhr: UTC-Zeitpunkt und lokale Bestandteile in der Zeitzone des Geräts (REQ-STORE-9). */
export const browserClock: Clock = () => {
  const d = new Date();
  return {
    utc: d,
    local: {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
    },
  };
};

/** Text als Datei herunterladen. */
export const download = (fileName: string, text: string, type = "application/json"): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Tastenkürzel nicht, solange ein Texteingabefeld den Fokus hat (REQ-UI-8). */
export const isTextInput = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};
