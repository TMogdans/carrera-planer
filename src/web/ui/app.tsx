/**
 * Oberfläche M2 (Spec M2, REQ-UI-1 bis -11): Zeichenfläche, Teileleiste, Auswahlleiste,
 * Statusleiste, Werkzeugleiste, Speichern/Laden-Dialog und Meldungen. Ab M3a (Spec M3a,
 * REQ-BUI-1 bis -6) dazu Modus-Schalter, Bestandsdialog, Leiste mit Restzähler im Modus „Bestand“
 * und die Einkaufsliste. Ab plan-beschriftung-symbole der Schalter „Namen“ (REQ-LBL-7) und
 * Namen und Symbole im Plan (über `Canvas`/`PlanContent`). Alle Regeln liegen in der Editor-Logik (src/web/editor); hier wird nur
 * dargestellt und bedient.
 */
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CATALOG, SET_TEMPLATES } from "../../catalog/index.js";
import { type CatalogEntry, trace } from "../../core/index.js";
import {
  type Command,
  canRedo,
  canUndo,
  consumptionView,
  coordToNumber,
  createPlannerSession,
  crossingTarget,
  drawing,
  drawnSection,
  errorEntries,
  flipAvailable,
  formatLength,
  type Mode,
  origin,
  type PlannerMessage,
  type PlannerSession,
  paletteEntries,
  type ScreenPoint,
  type StockPaletteEntry,
  shoppingList,
  shoppingShort,
  statusOf,
  stockPalette,
  totalLength,
} from "../editor/index.js";
import { browserClock, browserStorage, isTextInput, onLocalStorageChange } from "./browser.js";
import { Canvas, type EndMark } from "./canvas.js";
import { StorageDialog } from "./dialog.js";
import { InventoryDialog } from "./inventory-dialog.js";
import { LabelsToggle } from "./labels-toggle.js";
import { ShoppingDialog } from "./shopping-dialog.js";
import { type Box, boundsOf, fitBox, follow, type View } from "./view.js";

const catalog: ReadonlyArray<CatalogEntry> = CATALOG;

const screenOf = (p: {
  x: Parameters<typeof coordToNumber>[0];
  y: Parameters<typeof coordToNumber>[0];
}): ScreenPoint => ({
  x: coordToNumber(p.x),
  y: -coordToNumber(p.y),
});

const STATUS_LABEL = {
  leer: "leer",
  geschlossen: "geschlossen",
  offen: "offen",
  fehlerhaft: "Fehler",
} as const;

/** Kleines Symbol je Teil in der Leiste. */
function PartIcon({ entry }: { readonly entry: CatalogEntry }) {
  const g = entry.geometry;
  let d = "M4 12H28";
  if (g.kind === "kurve") d = g.angle === 90 ? "M4 26A22 22 0 0 0 26 4" : "M4 24A28 28 0 0 0 20 8";
  if (g.kind === "kreuzung") d = "M4 16H28M16 4V28";
  if (g.kind === "gerade")
    d = g.length >= 342 ? "M2 16H30" : g.length >= 228 ? "M6 16H26" : "M10 16H22";
  return (
    <svg class="part-icon" viewBox="0 0 32 32" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Rest mit echtem Minuszeichen (auch negativ, REQ-BUI-3); unbestimmt „?“. */
const restText = (rest: number | undefined): string =>
  rest === undefined ? "?" : String(rest).replace("-", "−");

const MODES: ReadonlyArray<readonly [Mode, string]> = [
  ["sandbox", "Sandbox"],
  ["bestand", "Bestand"],
];

type DialogKind = "keiner" | "speichern" | "bestand" | "einkauf";

function App({ session }: { readonly session: PlannerSession }) {
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 0.4, tx: 200, ty: 300 });
  const [dialog, setDialog] = useState<DialogKind>("keiner");
  const [dismissed, setDismissed] = useState<ReadonlySet<PlannerMessage>>(new Set());
  const [showUsage, setShowUsage] = useState(false);
  const fitted = useRef(false);

  const state = session.state;
  const elements = state.elements;
  const inventory = session.inventory;
  const mode = session.mode;

  const derived = useMemo(() => {
    const shapes = drawing(catalog, elements);
    const section = drawnSection(catalog, elements);
    const status = statusOf(catalog, elements);
    const errors = errorEntries(catalog, elements);
    const usage = consumptionView(catalog, elements);
    const length = formatLength(totalLength(catalog, elements));
    const target = crossingTarget(catalog, elements);
    const crossingIds = new Set(elements.filter((e) => "crosses" in e).map((e) => e.id));
    const crossedRefs = new Set(elements.flatMap((e) => ("crosses" in e ? [e.crosses] : [])));
    const lastPose = section.steps.at(-1)?.pose ?? origin();
    const end: EndMark | undefined =
      section.firstErrorIndex === undefined && elements.length > 0
        ? { at: screenOf(lastPose), dir: lastPose.dir }
        : undefined;
    const errorAt = section.firstErrorIndex === undefined ? undefined : screenOf(lastPose);
    const targets = shapes.flatMap((s) =>
      s.ports !== undefined && !crossedRefs.has(s.id) ? [s.ports.left, s.ports.right] : [],
    );
    // Ankunftsfehler: Queranschlüsse der verwiesenen Kreuzung hervorheben (REQ-UI-5).
    const t = trace(catalog, elements, origin());
    const refs = t.ok
      ? []
      : t.errors.flatMap((e) => (e.kind === "ankunftNichtAmQueranschluss" ? [e.ref] : []));
    const hotPorts = shapes.flatMap((s) =>
      s.ports !== undefined && refs.includes(s.id) ? [s.ports.left, s.ports.right] : [],
    );
    return {
      shapes,
      section,
      status,
      errors,
      usage,
      length,
      target,
      crossingIds,
      end,
      errorAt,
      targets,
      hotPorts,
    };
  }, [elements]);

  // Einkaufsliste in beiden Modi (REQ-EINK-5), Leiste mit Rest nur im Modus „Bestand“.
  const shopping = useMemo(() => shoppingList(catalog, inventory, elements), [elements, inventory]);
  const stock = useMemo(
    () => (mode === "bestand" ? stockPalette(catalog, inventory, elements) : undefined),
    [mode, elements, inventory],
  );

  // Box aus Bandrändern inkl. Bogen-Extrempunkten und Startpunkt (Einpassen, REQ-UI-7).
  const box = (): Box =>
    boundsOf(
      derived.shapes.flatMap((s) => [s.band.left, s.band.right]),
      { x: 0, y: 0 },
    );

  const doFit = () => setView(fitBox(box(), size.width, size.height));

  // Nach Laden/Import einpassen, sobald die neue Strecke gezeichnet ist.
  const fitPending = useRef(false);
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    doFit();
  });

  // Erste Ansicht: eingepasst, sobald die Größe der Fläche bekannt ist.
  useEffect(() => {
    if (fitted.current || size.width <= 0) return;
    fitted.current = true;
    setView(
      elements.length > 0
        ? fitBox(box(), size.width, size.height)
        : {
            scale: Math.min(size.width, size.height) / 1500,
            tx: size.width / 3,
            ty: size.height / 2,
          },
    );
  });

  const run = (command: Command) => {
    const before = session.state.elements;
    session.dispatch(command);
    if (session.state.elements !== before) {
      // Ansicht rückt mit, damit das offene Ende sichtbar bleibt (REQ-UI-7), ohne Zoom.
      const sec = drawnSection(catalog, session.state.elements);
      const pose = sec.steps.at(-1)?.pose;
      if (pose !== undefined) setView((v) => follow(v, screenOf(pose), size.width, size.height));
    }
    rerender();
  };

  // Tastenkürzel (REQ-UI-8): nicht, solange ein Textfeld den Fokus hat. Bei offenem Dialog
  // schließt Esc den Dialog; die übrigen Kürzel wirken auch dann (Smoke 15).
  const runRef = useRef(run);
  runRef.current = run;
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogRef.current !== "keiner") {
        setDialog("keiner");
        return;
      }
      if (isTextInput(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      let c: Command | undefined;
      if (mod && key === "z") c = { type: e.shiftKey ? "redo" : "undo" };
      else if (e.ctrlKey && key === "y") c = { type: "redo" };
      else if (!mod && (e.key === "Delete" || e.key === "Backspace"))
        c = { type: "deleteSelected" };
      else if (e.key === "Escape") c = { type: "clearSelection" };
      if (c === undefined) return;
      e.preventDefault();
      runRef.current(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Abgleich des Bestands mit anderen Tabs (REQ-BEST-10); beim Abbau wieder abmelden.
  useEffect(
    () =>
      onLocalStorageChange((key) => {
        session.storageChanged(key);
        rerender();
      }),
    [session],
  );

  const selIndex = elements.findIndex((e) => e.id === state.selection);
  const selEl = elements[selIndex];
  const nameOf = (el: (typeof elements)[number]): string =>
    "crosses" in el ? "Querung" : (catalog.find((c) => c.id === el.part)?.name ?? el.part);
  // Leiste: im Modus „Bestand“ die Einteilung mit Bestand und Rest (REQ-MODUS-5), sonst M2.
  const palette: ReadonlyArray<
    Pick<StockPaletteEntry, "partId" | "name" | "kind"> & Partial<StockPaletteEntry>
  > = stock ?? paletteEntries(catalog);
  // Gleichlautende Meldungen werden zusammengefasst (Anzahl statt Stapel, REQ-STORE-8/REQ-UI-9);
  // Schließen schließt alle gleichlautenden bis dahin.
  const groups = new Map<string, PlannerMessage[]>();
  for (const m of session.messages) {
    if (dismissed.has(m)) continue;
    const key = `${m.kind}\n${m.text}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const status = derived.status;

  return (
    <div class="app">
      <header class="toolbar">
        <div class="toolbar-buttons">
          <button
            type="button"
            disabled={!canUndo(state)}
            onClick={() => run({ type: "undo" })}
            title="Rückgängig (Strg/Cmd+Z)"
          >
            ↶<span class="label">Rückgängig</span>
          </button>
          <button
            type="button"
            disabled={!canRedo(state)}
            onClick={() => run({ type: "redo" })}
            title="Wiederholen (Strg/Cmd+Umschalt+Z)"
          >
            ↷<span class="label">Wiederholen</span>
          </button>
          <button type="button" onClick={doFit} title="Einpassen">
            ⤢<span class="label">Einpassen</span>
          </button>
          <LabelsToggle
            on={session.labels}
            onToggle={() => {
              session.setLabels(!session.labels);
              rerender();
            }}
          />
          <button type="button" onClick={() => run({ type: "new" })} title="Neu">
            ＋<span class="label">Neu</span>
          </button>
          <button type="button" onClick={() => setDialog("speichern")} title="Speichern/Laden">
            💾<span class="label">Speichern/Laden</span>
          </button>
          <button type="button" onClick={() => setDialog("bestand")} title="Bestand">
            📦<span class="label">Bestand</span>
          </button>
          <span class="title">{session.name ?? "Carrera-Planer"}</span>
        </div>
        {/* Außerhalb des scrollenden Teils: immer sichtbar (REQ-BUI-3). */}
        <fieldset class="mode-switch" aria-label="Modus">
          {MODES.map(([m, label]) => (
            <button
              type="button"
              key={m}
              aria-pressed={mode === m}
              onClick={() => {
                session.setMode(m);
                rerender();
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </header>

      {groups.size > 0 && (
        <div class="messages" role="alert">
          {[...groups].map(([key, members]) => {
            const m = members[0] as PlannerMessage;
            return (
              <div class={`message message-${m.kind}`} key={key}>
                <span>
                  {m.kind === "speicherFehler" ? "Speicher nicht verfügbar: " : ""}
                  {m.text}
                  {members.length > 1 && <strong class="count"> ({members.length}×)</strong>}
                </span>
                <button
                  type="button"
                  aria-label="Meldung schließen"
                  onClick={() => setDismissed(new Set([...dismissed, ...members]))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Canvas
        catalog={catalog}
        elements={elements}
        labelsOn={session.labels}
        shapes={derived.shapes}
        crossingIds={derived.crossingIds}
        selectedId={state.selection}
        targets={derived.targets}
        hotPorts={derived.hotPorts}
        end={derived.end}
        errorAt={derived.errorAt}
        view={view}
        onView={setView}
        onTap={(id) => run(id === undefined ? { type: "clearSelection" } : { type: "select", id })}
        onSize={(width, height) => setSize({ width, height })}
      />

      {selEl !== undefined && (
        <div class="selbar">
          <span class="sel-name">
            Nr. {selIndex + 1}: {nameOf(selEl)}
          </span>
          <button type="button" onClick={() => run({ type: "deleteSelected" })}>
            Löschen
          </button>
          <button
            type="button"
            aria-pressed={state.action === "ersetzen"}
            onClick={() => run({ type: "setAction", action: "ersetzen" })}
          >
            Ersetzen
          </button>
          <button
            type="button"
            aria-pressed={state.action === "davorEinfuegen"}
            onClick={() => run({ type: "setAction", action: "davorEinfuegen" })}
          >
            Davor einfügen
          </button>
          {flipAvailable(catalog, state) && (
            <button type="button" onClick={() => run({ type: "flipSelected" })}>
              Richtung umschalten
            </button>
          )}
          {state.action !== "keine" && (
            <>
              <span class="action-hint">
                {state.action === "ersetzen"
                  ? "Ersetzen: Teil wählen"
                  : "Davor einfügen: Teile wählen"}
              </span>
              <button type="button" onClick={() => run({ type: "setAction", action: "keine" })}>
                Abbrechen
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="Voriges Element"
            onClick={() => run({ type: "selectPrevious" })}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Nächstes Element"
            onClick={() => run({ type: "selectNext" })}
          >
            ▶
          </button>
          <button
            type="button"
            aria-label="Auswahl aufheben"
            onClick={() => run({ type: "clearSelection" })}
          >
            ✕
          </button>
        </div>
      )}

      <nav class="palette" aria-label="Teileleiste">
        <button
          type="button"
          class="turn-toggle"
          onClick={() => run({ type: "togglePaletteTurn" })}
          title="Kurvenrichtung umschalten"
        >
          <span class="turn-arrow">{state.paletteTurn === "links" ? "↺" : "↻"}</span>
          <span>Kurven {state.paletteTurn}</span>
        </button>
        <button
          type="button"
          class="palette-item querung-item"
          disabled={derived.target === undefined}
          onClick={() => run({ type: "appendCrossing" })}
        >
          <span class="part-icon querung-icon">✕</span>
          <span>Querung</span>
        </button>
        {palette
          .filter((p) => p.kind !== "ausgeblendet")
          .map((p) => {
            const entry = catalog.find((c) => c.id === p.partId) as CatalogEntry;
            // Gesperrt (Rest ≤ 0 oder unbestimmt): ausgegraut, reagiert nicht (REQ-BUI-3).
            return p.kind === "platzierbar" ? (
              <button
                type="button"
                class={p.locked === true ? "palette-item locked" : "palette-item"}
                key={p.partId}
                disabled={p.locked === true}
                onClick={() => run({ type: "choosePart", partId: p.partId })}
              >
                <PartIcon entry={entry} />
                <span>
                  {p.name}
                  {stock !== undefined && <small class="rest">Rest {restText(p.rest)}</small>}
                </span>
              </button>
            ) : (
              <div class="palette-item missing" key={p.partId} aria-disabled="true">
                <span class="part-icon">?</span>
                <span>
                  {p.name}
                  <small>Maße fehlen</small>
                  {p.stock !== undefined && <small class="rest">Rest {restText(p.rest)}</small>}
                </span>
              </div>
            );
          })}
      </nav>

      <footer class="statusbar">
        <div class="status-line">
          <span class={`status status-${status.kind}`}>
            {status.kind === "fehlerhaft"
              ? `Fehler (${derived.errors.length})`
              : STATUS_LABEL[status.kind]}
            {status.kind === "offen" &&
              `, Lücke ${status.gapText}, Winkel ${status.angleDeg > 0 ? "+" : ""}${status.angleDeg}°`}
          </span>
          <button
            type="button"
            class="usage-toggle"
            aria-expanded={showUsage}
            onClick={() => setShowUsage(!showUsage)}
          >
            {derived.usage.ok ? `${derived.usage.total} Teile` : derived.usage.text}{" "}
            {showUsage ? "▴" : "▾"}
          </button>
          <button
            type="button"
            class="shopping-toggle"
            title="Einkaufsliste"
            onClick={() => setDialog("einkauf")}
          >
            🛒 {shoppingShort(shopping)}
          </button>
          <span class="length">{derived.length}</span>
          <span class="overlap">Überschneidung: nicht geprüft</span>
        </div>
        {derived.section.notDrawnCount > 0 && (
          <div class="not-drawn">{derived.section.notDrawnCount} Teile nicht gezeichnet</div>
        )}
        {derived.errors.length > 0 && (
          <ul class="errors">
            {derived.errors.map((e) => (
              <li key={`${e.numbers.join(",")}${e.text}`}>
                <button
                  type="button"
                  onClick={() => {
                    const el = elements[(e.numbers[0] ?? 1) - 1];
                    if (el !== undefined) run({ type: "select", id: el.id });
                  }}
                >
                  Nr. {e.numbers.join(", ")}: {e.name} – {e.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        {showUsage && derived.usage.ok && (
          <ul class="usage">
            {derived.usage.entries.map((u) => (
              <li key={u.partId}>
                {u.name}: {u.count}
              </li>
            ))}
            <li class="usage-total">zusammen {derived.usage.total}</li>
          </ul>
        )}
      </footer>

      {dialog === "speichern" && (
        <StorageDialog
          session={session}
          onClose={() => setDialog("keiner")}
          onChange={() => {
            rerender();
          }}
          afterLoad={() => {
            fitPending.current = true;
          }}
        />
      )}
      {dialog === "bestand" && (
        <InventoryDialog
          session={session}
          catalog={catalog}
          templates={SET_TEMPLATES}
          onClose={() => setDialog("keiner")}
          onChange={rerender}
        />
      )}
      {dialog === "einkauf" && (
        <ShoppingDialog list={shopping} onClose={() => setDialog("keiner")} />
      )}
    </div>
  );
}

export const mount = (root: HTMLElement): void => {
  const session = createPlannerSession({
    catalog,
    templates: SET_TEMPLATES,
    storage: browserStorage(),
    clock: browserClock,
  });
  render(<App session={session} />, root);
};
