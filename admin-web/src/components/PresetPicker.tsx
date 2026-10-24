import { useState } from "react";

import { AnimationEditor } from "./AnimationEditor";
import { savePreset, type PresetRow } from "../lib/api";
import { STANDARD_PARAMS, validatePresetParams, type PresetParams } from "../lib/brand";

function paramsOf(preset: PresetRow | undefined): PresetParams {
  const checked = validatePresetParams(preset?.params);
  return checked.ok ? checked.params : STANDARD_PARAMS;
}

function same(a: PresetParams, b: PresetParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type PresetPickerProps = {
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
 * Choose a preset or adjust all parameters; changes are saved as a new preset or into an own
 * one. Built-in presets never change; "Zurücksetzen" loads the standard.
 */
export function PresetPicker({ spec, presets, presetId, onSelect, onSaved, onDirtyChange }: PresetPickerProps) {
  const selected = presets.find((p) => p.id === presetId);
  const [params, setParams] = useState<PresetParams>(() => paramsOf(selected));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !same(params, paramsOf(selected));

  function change(next: PresetParams) {
    setParams(next);
    onDirtyChange(!same(next, paramsOf(selected)));
  }

  function choose(id: string) {
    const preset = presets.find((p) => p.id === id);
    onSelect(id);
    setParams(paramsOf(preset));
    onDirtyChange(false);
  }

  async function save(asNew: boolean) {
    setBusy(true);
    setError(null);
    try {
      const id = await savePreset(asNew ? null : presetId, asNew ? name.trim() : (selected?.name ?? name.trim()), params);
      await onSaved(id);
      onSelect(id);
      onDirtyChange(false);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="preset-picker">
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
      <AnimationEditor spec={spec} params={params} onChange={change} />
      {dirty && (
        <div className="panel">
          <p>Die Einstellungen weichen vom Preset ab. Zum Übernehmen als Preset speichern.</p>
          <div className="filters">
            <label className="grow">
              Name des neuen Presets
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="button" className="button primary" disabled={busy || name.trim() === ""} onClick={() => void save(true)}>
              Als neues Preset speichern
            </button>
            {selected?.kind === "custom" && (
              <button type="button" className="button" disabled={busy} onClick={() => void save(false)}>
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
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
