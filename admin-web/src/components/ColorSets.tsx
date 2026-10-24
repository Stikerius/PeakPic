import { useCallback, useEffect, useMemo, useState } from "react";

import { BrandLogo } from "./BrandLogo";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { PatternChart } from "./PatternChart";
import { TokenPreview } from "./TokenPreview";
import { EmptyState, SegmentedChoice, Skeleton } from "./ui";
import { useAppearance } from "../lib/appearanceContext";
import { COLOR_TARGET_LABELS, activateColorSet, deleteColorSet, fetchColorSets, saveColorSet, type ColorSetRow } from "../lib/api";
import { DEFAULT_COLOR_SET, MAX_CHART_COLORS, isHex, normalizeHex, type BrandMode, type ColorSetValues } from "../lib/brand";
import {
  COLOR_TARGETS,
  MAX_CUSTOM_COLOR_SETS,
  applySuggestion,
  colorDeleteBlocker,
  colorFieldValue,
  contrastSummary,
  defaultColorTargets,
  draftProblem,
  editableChartColors,
  formatRatio,
  type ColorDraft,
  type ColorTarget,
} from "../lib/colorLibrary";
import { useDashboardBrand } from "../lib/dashboardBrand";
import { duplicateName } from "../lib/logoLibrary";

type Dialog =
  | { kind: "edit"; id: string | null; title: string; draft: ColorDraft }
  | { kind: "rename"; set: ColorSetRow }
  | { kind: "activate"; set: ColorSetRow }
  | { kind: "delete"; set: ColorSetRow };

const MODE_CHOICES = [
  ["dark", "Dunkel"],
  ["light", "Hell"],
] as const;
const CHART_CHOICES = [
  ["auto", "Automatisch"],
  ["custom", "Eigene"],
] as const;
const SAMPLE_VALUES = [
  { label: "Offen", value: 12 },
  { label: "In Prüfung", value: 7 },
  { label: "Erledigt", value: 19 },
  { label: "Abgelehnt", value: 4 },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");
const draftOf = (set: ColorSetValues & { name: string }): ColorDraft => ({
  name: set.name,
  accentDark: set.accentDark,
  accentLight: set.accentLight,
  chartColors: set.chartColors === null ? null : [...set.chartColors],
});

/** The draft as complete values for the previews: half typed fields keep the colours of Orange. */
function previewValues(draft: ColorDraft): ColorSetValues {
  const chart = draft.chartColors;
  return {
    accentDark: colorFieldValue(draft.accentDark, DEFAULT_COLOR_SET.accentDark),
    accentLight: colorFieldValue(draft.accentLight, DEFAULT_COLOR_SET.accentLight),
    chartColors: chart !== null && chart.every(isHex) ? chart.map(normalizeHex) : null,
  };
}

/** A small picture of a set in one mode: the accent with its text colour, and the chart colours. */
function ColorSample({ values, mode }: { values: ColorSetValues; mode: BrandMode }) {
  const { appearance } = useAppearance();
  return (
    <TokenPreview style={appearance.style} mode={mode} palette="color" colorSet={values} className="color-sample">
      <span className="color-sample-accent">Aa</span>
      <span className="chart-strip">
        {Array.from({ length: MAX_CHART_COLORS }, (_, i) => (
          <span key={i} className={`chart-swatch-${i + 1}`} />
        ))}
      </span>
    </TokenPreview>
  );
}

/** "Hauptfarben" on the design page (admins): pick, create and activate colour sets. */
export function ColorSets({ onActivated }: { onActivated: () => void }) {
  const { reloadColors } = useAppearance();
  const [sets, setSets] = useState<ColorSetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchColorSets()
      .then((rows) => {
        setSets(rows);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  useEffect(load, [load]);

  const custom = (sets ?? []).filter((s) => s.kind === "custom").length;

  /** Runs a change; afterwards the list, and where a set is active the dashboard's colours, reload. */
  async function run(change: () => Promise<unknown>, done: string, colorsChanged: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      await change();
      setDialog(null);
      setError(null);
      setNotice(done);
      load();
      if (colorsChanged) {
        reloadColors();
        onActivated();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function save(id: string | null, draft: ColorDraft, wasActive: boolean) {
    void run(
      () =>
        saveColorSet(
          id,
          draft.name.trim(),
          normalizeHex(draft.accentDark),
          normalizeHex(draft.accentLight),
          draft.chartColors === null ? null : draft.chartColors.map(normalizeHex),
        ),
      "Farbsatz gespeichert.",
      wasActive,
    );
  }

  const editing = dialog?.kind === "edit" ? dialog : null;
  const editingActive = editing !== null && (sets ?? []).some((s) => s.id === editing.id && s.targets.length > 0);

  return (
    <section className="panel" aria-labelledby="design-colors">
      <h2 id="design-colors">Hauptfarben</h2>
      <p className="muted">
        Die Akzentfarbe für Dunkel und Hell, mit Diagrammfarben. Gilt für das Dashboard aller Admins und Moderatoren und für den
        Anmeldebildschirm der App (nur bei der Farbe „Hauptfarbe“). Jede Farbe muss sich genug vom Hintergrund abheben, sonst lässt sie sich nicht
        speichern.
      </p>
      {error !== null && <p className="error">{error}</p>}
      {notice !== null && <p className="success">{notice}</p>}
      <div className="action-row">
        <button
          type="button"
          className="button primary"
          disabled={sets === null || custom >= MAX_CUSTOM_COLOR_SETS}
          onClick={() => setDialog({ kind: "edit", id: null, title: "Neuer Farbsatz", draft: { ...draftOf(DEFAULT_COLOR_SET), name: "Neuer Farbsatz" } })}
        >
          Neuer Farbsatz
        </button>
        <span className="muted">
          {custom} von {MAX_CUSTOM_COLOR_SETS} eigenen Farbsätzen
        </span>
      </div>

      {sets === null && error === null && <Skeleton lines={3} label="Farbsätze laden" />}
      {sets === null && error !== null && <EmptyState title="Keine Farbsätze geladen">Bitte die Seite neu laden.</EmptyState>}
      <div className="color-grid">
        {(sets ?? []).map((set) => {
          const blocker = colorDeleteBlocker(set);
          return (
            <article key={set.id} className="logo-tile">
              <div className="color-sample-row">
                <ColorSample values={set} mode="dark" />
                <ColorSample values={set} mode="light" />
              </div>
              <h3 className="logo-tile-title">{set.name}</h3>
              <p className="muted">
                {set.kind === "builtin" ? "Eingebaut" : `Eigener Farbsatz${set.createdBy !== null ? ` von @${set.createdBy}` : ""}`} · {set.accentDark} /{" "}
                {set.accentLight}
              </p>
              <p>
                {set.targets.length === 0 ? (
                  <span className="muted">Nicht aktiv</span>
                ) : (
                  set.targets.map((t) => (
                    <span key={t} className="pill">
                      Aktiv: {COLOR_TARGET_LABELS[t]}
                    </span>
                  ))
                )}
              </p>
              <div className="action-row">
                <button type="button" className="button small" onClick={() => setDialog({ kind: "activate", set })} disabled={set.targets.length === COLOR_TARGETS.length}>
                  Aktivieren
                </button>
                {set.kind === "custom" && (
                  <>
                    <button type="button" className="button small" onClick={() => setDialog({ kind: "edit", id: set.id, title: `„${set.name}“ bearbeiten`, draft: draftOf(set) })}>
                      Bearbeiten
                    </button>
                    <button type="button" className="button small" onClick={() => setDialog({ kind: "rename", set })}>
                      Umbenennen
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="button small"
                  disabled={custom >= MAX_CUSTOM_COLOR_SETS}
                  onClick={() => setDialog({ kind: "edit", id: null, title: `„${set.name}“ duplizieren`, draft: { ...draftOf(set), name: duplicateName(set.name) } })}
                >
                  Duplizieren
                </button>
                <button type="button" className="button small" disabled={blocker !== null} title={blocker ?? undefined} onClick={() => setDialog({ kind: "delete", set })}>
                  Löschen
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {editing !== null && (
        <ColorEditor
          key={editing.id ?? editing.title}
          title={editing.title}
          initial={editing.draft}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(draft) => save(editing.id, draft, editingActive)}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          set={dialog.set}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={(name) => save(dialog.set.id, { ...draftOf(dialog.set), name }, dialog.set.targets.length > 0)}
        />
      )}
      {dialog?.kind === "activate" && (
        <ActivateColorDialog
          set={dialog.set}
          sets={sets ?? []}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={(targets) => void run(() => activateColorSet(dialog.set.id, targets), `„${dialog.set.name}“ ist aktiv.`, true)}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        title="Farbsatz löschen?"
        confirmLabel="Löschen"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind === "delete") void run(() => deleteColorSet(dialog.set.id), "Farbsatz gelöscht.", false);
        }}
      >
        <p>„{dialog?.kind === "delete" ? dialog.set.name : ""}“ wird endgültig gelöscht.</p>
      </ConfirmDialog>
    </section>
  );
}

/** Hex field plus the browser's native colour field for one accent, with the contrasts below. */
function AccentField({ label, value, mode, onChange }: { label: string; value: string; mode: BrandMode; onChange: (value: string) => void }) {
  const summary = contrastSummary(value, mode);
  const fallback = mode === "dark" ? DEFAULT_COLOR_SET.accentDark : DEFAULT_COLOR_SET.accentLight;
  return (
    <div className="color-field">
      <span className="color-field-label">{label}</span>
      <div className="color-field-inputs">
        <input type="color" aria-label={`${label}, Farbwähler`} value={colorFieldValue(value, fallback)} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          aria-label={`${label}, Hex-Wert`}
          className="hex-input"
          value={value}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </div>
      {summary !== null && (
        <ul className="contrast-list">
          <li className={summary.accent >= 3 ? "" : "bad"}>Zum Hintergrund {formatRatio(summary.accent)} (mind. 3 : 1)</li>
          <li className={summary.onAccent >= 4.5 ? "" : "bad"}>Schrift darauf {formatRatio(summary.onAccent)} (mind. 4,5 : 1)</li>
          <li>Links {formatRatio(summary.link)} (mind. 4,5 : 1)</li>
        </ul>
      )}
    </div>
  );
}

function ColorEditor({
  title,
  initial,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  initial: ColorDraft;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: ColorDraft) => void;
}) {
  const brand = useDashboardBrand();
  const { mode, appearance } = useAppearance();
  const [draft, setDraft] = useState<ColorDraft>(initial);
  const [previewMode, setPreviewMode] = useState<BrandMode>(mode);
  const [replay, setReplay] = useState(0);
  const problem = draftProblem(draft);
  const preview = useMemo(() => previewValues(draft), [draft]);
  const chart = draft.chartColors;

  return (
    <Modal
      open
      wide
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="button primary" onClick={() => onSave(draft)} disabled={busy || problem !== null}>
            {busy ? "Bitte warten …" : "Speichern"}
          </button>
        </>
      }
    >
      <div className="color-editor">
        <div className="design-choices">
          <label className="field">
            <span>Name</span>
            <input type="text" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <AccentField label="Akzent für Dunkel" value={draft.accentDark} mode="dark" onChange={(accentDark) => setDraft({ ...draft, accentDark })} />
          <AccentField label="Akzent für Hell" value={draft.accentLight} mode="light" onChange={(accentLight) => setDraft({ ...draft, accentLight })} />
          <SegmentedChoice<"auto" | "custom">
            label="Diagrammfarben"
            value={chart === null ? "auto" : "custom"}
            options={CHART_CHOICES}
            onChange={(value) => setDraft({ ...draft, chartColors: value === "auto" ? null : editableChartColors(draft) })}
          />
          {chart === null ? (
            <p className="muted">Aus dem Akzent für Dunkel abgeleitet, auf beiden Hintergründen gut sichtbar. Diagramme zeigen zusätzlich Muster und Werte.</p>
          ) : (
            <div className="chart-color-grid">
              {chart.map((c, i) => (
                <label key={i} className="chart-color">
                  <input
                    type="color"
                    aria-label={`Diagrammfarbe ${i + 1}`}
                    value={colorFieldValue(c, DEFAULT_COLOR_SET.accentDark)}
                    onChange={(e) => setDraft({ ...draft, chartColors: chart.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  <span className="numeric">{i + 1}</span>
                </label>
              ))}
              <button type="button" className="button small" onClick={() => setDraft({ ...draft, chartColors: editableChartColors({ ...draft, chartColors: null }) })}>
                Neu ableiten
              </button>
            </div>
          )}
          {problem !== null && (
            <div className="notice" role="alert">
              <p>{problem.message}</p>
              {problem.suggestion !== undefined && (
                <button type="button" className="button small" onClick={() => setDraft(applySuggestion(draft, problem))}>
                  Vorschlag übernehmen
                </button>
              )}
            </div>
          )}
        </div>
        <div>
          <SegmentedChoice<BrandMode> label="Vorschau" value={previewMode} options={MODE_CHOICES} onChange={setPreviewMode} small />
          <TokenPreview style={appearance.style} mode={previewMode} palette="color" colorSet={preview} className="design-preview">
            <div className="color-login">
              <BrandLogo
                spec={brand.spec}
                params={brand.params}
                palette="color"
                mode={previewMode}
                size={96}
                playing
                restartKey={replay}
                colorSet={preview}
              />
              <strong>Anmeldung</strong>
            </div>
            <div className="action-row">
              <button type="button" className="button primary" tabIndex={-1}>
                Hauptaktion
              </button>
              <button type="button" className="button" tabIndex={-1}>
                Zweitaktion
              </button>
              <span className="pill accent">Neu</span>
            </div>
            <p>
              Text mit einem <a className="text-link" href="#vorschau" tabIndex={-1}>Link in der Akzentfarbe</a>.
            </p>
            <table className="table">
              <tbody>
                <tr className="selected">
                  <td>Ausgewählte Zeile</td>
                  <td className="numeric">2 h</td>
                </tr>
                <tr>
                  <td>Weitere Zeile</td>
                  <td className="numeric">5 h</td>
                </tr>
              </tbody>
            </table>
            <PatternChart title="Meldungen nach Status" values={SAMPLE_VALUES} />
          </TokenPreview>
          <button type="button" className="button small" onClick={() => setReplay((r) => r + 1)}>
            Animation erneut abspielen
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RenameDialog({ set, busy, onClose, onSave }: { set: ColorSetRow; busy: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(set.name);
  const valid = name.trim().length > 0 && name.trim().length <= 40;
  return (
    <Modal
      open
      title={`„${set.name}“ umbenennen`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="button primary" onClick={() => onSave(name.trim())} disabled={busy || !valid || name.trim() === set.name}>
            {busy ? "Bitte warten …" : "Speichern"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
    </Modal>
  );
}

function ActivateColorDialog({
  set,
  sets,
  busy,
  onClose,
  onConfirm,
}: {
  set: ColorSetRow;
  sets: ColorSetRow[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (targets: ColorTarget[]) => void;
}) {
  const [targets, setTargets] = useState<ColorTarget[]>(() => defaultColorTargets(sets, set.id));
  const activeName = (target: ColorTarget) => sets.find((s) => s.targets.includes(target))?.name ?? "keiner";

  return (
    <Modal
      open
      title={`„${set.name}“ aktivieren`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="button primary" onClick={() => onConfirm(targets)} disabled={busy || targets.length === 0}>
            {busy ? "Bitte warten …" : "Aktivieren"}
          </button>
        </>
      }
    >
      <fieldset className="checklist">
        <legend>Ziele</legend>
        {COLOR_TARGETS.map((t) => (
          <label key={t} className="choice">
            <input
              type="checkbox"
              checked={targets.includes(t)}
              disabled={set.targets.includes(t)}
              onChange={(e) => setTargets((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
            />
            <span>
              {COLOR_TARGET_LABELS[t]}: jetzt aktiv „{activeName(t)}“{set.targets.includes(t) ? " (bereits dieser Farbsatz)" : ""}
            </span>
          </label>
        ))}
      </fieldset>
      {targets.length > 0 && (
        <p>
          Danach nutzt {targets.map((t) => COLOR_TARGET_LABELS[t]).join(" und ")} den Farbsatz „{set.name}“.
          {targets.includes("dashboard_colors") && " Andere geöffnete Dashboards übernehmen ihn beim nächsten Laden der Seite."}
          {targets.includes("app_login_colors") &&
            " In der App wirkt er beim nächsten Öffnen des Anmeldebildschirms, und nur bei der Farbe „Hauptfarbe“ (siehe App-Anmeldebildschirm unten)."}
        </p>
      )}
    </Modal>
  );
}
