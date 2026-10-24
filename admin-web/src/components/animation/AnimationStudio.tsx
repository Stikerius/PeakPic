import { useMemo, useRef, useState } from "react";

import { AnimationWorkbench } from "./AnimationWorkbench";
import { AnimationEditor } from "../AnimationEditor";
import { fetchPresetVersions, savePreset, type PresetRow, type PresetVersionRow } from "../../lib/api";
import {
  EXPORT_FORMAT,
  TEMPLATES,
  historyOf,
  importAnimation,
  presetParams as paramsOf,
  presetSpec as specOf,
  pushHistory,
  redo,
  undo,
  type History,
} from "../../lib/animationEditor";
import {
  APP_LOGO_SPEC,
  STANDARD_PARAMS,
  migrateV1,
  parseAnimation,
  validateAnimationSpec,
  validateLogoSpec,
  type AnimationSpec,
  type PresetParams,
} from "../../lib/brand";
import { downloadJson } from "../../lib/download";
import { formatDateTime } from "../../lib/format";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type StudioProps = {
  spec: unknown;
  presets: PresetRow[];
  presetId: string;
  onSelect: (id: string) => void;
  /** After a preset was created or changed (the list must be loaded again). */
  onSaved: (id: string) => Promise<void>;
  /** True while there are changes that aren't saved as a preset yet. */
  onDirtyChange: (dirty: boolean) => void;
};

/**
 * The animation step of a logo: choose a preset and edit it in the timeline editor ("Editor") or
 * with the standard parameters ("Einfach"); templates, export and import as a JSON file (checked
 * like an upload), version history of own presets, and saving as a new preset or into an own one.
 * Built-in presets never change.
 */
export function AnimationStudio({ spec: logoIn, presets, presetId, onSelect, onSaved, onDirtyChange }: StudioProps) {
  const logo = useMemo(() => {
    const checked = validateLogoSpec(logoIn);
    return checked.ok ? checked.spec : APP_LOGO_SPEC;
  }, [logoIn]);
  const selected = presets.find((p) => p.id === presetId);
  const [tab, setTab] = useState<"editor" | "simple">("editor");
  const [history, setHistory] = useState<History<AnimationSpec>>(() => historyOf(specOf(selected)));
  const [transient, setTransient] = useState<AnimationSpec | null>(null);
  const [simple, setSimple] = useState<PresetParams | null>(() => paramsOf(selected));
  const [fromSimple, setFromSimple] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<PresetVersionRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = transient ?? history.present;
  const base = specOf(selected);
  const dirty = !same(history.present, base);
  const check = validateAnimationSpec(current);

  function apply(next: History<AnimationSpec>, simpleSource = false) {
    setHistory(next);
    setTransient(null);
    setFromSimple(simpleSource);
    onDirtyChange(!same(next.present, base));
  }

  function change(next: AnimationSpec, commit = true) {
    if (!commit) {
      setTransient(next);
      return;
    }
    apply(pushHistory(history, next));
  }

  function choose(id: string) {
    const preset = presets.find((p) => p.id === id);
    onSelect(id);
    setHistory(historyOf(specOf(preset)));
    setTransient(null);
    setSimple(paramsOf(preset));
    setFromSimple(false);
    setVersions(null);
    setError(null);
    setNotice(null);
    onDirtyChange(false);
  }

  async function save(asNew: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const params = fromSimple ? simple : null;
      const id = await savePreset(asNew ? null : presetId, asNew ? name.trim() : (selected?.name ?? name.trim()), history.present, params);
      await onSaved(id);
      onSelect(id);
      setHistory(historyOf(history.present));
      setVersions(null);
      onDirtyChange(false);
      setName("");
      setNotice("Gespeichert.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  async function showVersions() {
    setError(null);
    try {
      setVersions(await fetchPresetVersions(presetId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    }
  }

  async function importFile(file: File) {
    setError(null);
    const result = importAnimation(await file.text(), file.size);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    apply(pushHistory(history, result.spec));
    setName(result.name);
    setNotice(`„${result.name}“ importiert. Zum Übernehmen als Preset speichern.`);
  }

  return (
    <div className="preset-picker">
      <div className="filters">
        <label className="field">
          <span>Preset</span>
          <select value={presetId} onChange={(e) => choose(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.kind === "builtin" ? " (eingebaut)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Vorlage laden</span>
          <select
            value=""
            onChange={(e) => {
              const template = TEMPLATES.find((t) => t.id === e.target.value);
              if (template === undefined) return;
              apply(pushHistory(history, template.spec));
              setNotice(`Vorlage „${template.name}“ geladen.`);
            }}
          >
            <option value="">Vorlage wählen …</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button small"
          onClick={() => downloadJson(`animation-${(selected?.name ?? "neu").replace(/[^A-Za-z0-9-]+/g, "-").toLowerCase()}.json`, { format: EXPORT_FORMAT, name: selected?.name ?? "", animation: current })}
        >
          Als JSON exportieren
        </button>
        <button type="button" className="button small" onClick={() => fileInput.current?.click()}>
          JSON importieren
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file !== undefined) void importFile(file);
          }}
        />
        {selected?.kind === "custom" && (
          <button type="button" className="button small" onClick={() => void showVersions()}>
            Versionsverlauf
          </button>
        )}
      </div>

      {versions !== null && (
        <div className="panel">
          <h3>Versionen von „{selected?.name}“</h3>
          {versions.length === 0 ? (
            <p className="muted">Noch keine gespeicherten Versionen.</p>
          ) : (
            <ul className="version-list">
              {versions.map((v) => (
                <li key={v.id}>
                  <span>
                    Version {v.version} · {formatDateTime(v.savedAt)}
                    {v.savedBy !== null ? ` · @${v.savedBy}` : ""} · {v.name}
                  </span>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => {
                      const restored = parseAnimation(v.spec);
                      if (restored === null) return;
                      apply(pushHistory(history, restored));
                      setNotice(`Version ${v.version} in den Editor geladen. Zum Wiederherstellen speichern.`);
                    }}
                  >
                    In den Editor laden
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">Gespeichert werden die letzten 10 Versionen je Preset.</p>
        </div>
      )}

      <div className="segmented-options tabs" role="tablist" aria-label="Bearbeiten">
        <button type="button" role="tab" aria-selected={tab === "editor"} className={tab === "editor" ? "segment active" : "segment"} onClick={() => setTab("editor")}>
          Editor
        </button>
        <button type="button" role="tab" aria-selected={tab === "simple"} className={tab === "simple" ? "segment active" : "segment"} onClick={() => setTab("simple")}>
          Einfach
        </button>
      </div>

      {tab === "editor" ? (
        <AnimationWorkbench
          logo={logo}
          spec={current}
          onChange={change}
          onUndo={() => apply(undo(history))}
          onRedo={() => apply(redo(history))}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
        />
      ) : (
        <>
          {simple === null && (
            <p className="notice">
              Diese Animation wurde im Editor gebaut. „Einfach“ beginnt mit den Standard-Parametern und ersetzt sie, sobald du hier etwas änderst.
            </p>
          )}
          <AnimationEditor
            spec={logo}
            params={simple ?? STANDARD_PARAMS}
            onChange={(params) => {
              setSimple(params);
              apply(pushHistory(history, migrateV1(params)), true);
            }}
          />
        </>
      )}

      {!check.ok && <p className="error">So lässt es sich nicht speichern: {check.error}</p>}
      {dirty && (
        <div className="panel">
          <p>Die Animation weicht vom Preset ab. Zum Übernehmen als Preset speichern.</p>
          <div className="filters">
            <label className="grow">
              Name des neuen Presets
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="button" className="button primary" disabled={busy || name.trim() === "" || !check.ok} onClick={() => void save(true)}>
              Als neues Preset speichern
            </button>
            {selected?.kind === "custom" && (
              <button type="button" className="button" disabled={busy || !check.ok} onClick={() => void save(false)}>
                „{selected.name}“ ändern
              </button>
            )}
            <button type="button" className="button" disabled={busy} onClick={() => choose(presetId)}>
              Änderungen verwerfen
            </button>
          </div>
          {selected?.kind === "builtin" && <p className="muted">Eingebaute Presets bleiben unverändert.</p>}
        </div>
      )}
      {notice !== null && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
