import { useMemo, useState } from "react";

import { BrandLogo } from "./BrandLogo";
import { Modal } from "./Modal";
import { PresetPicker } from "./PresetPicker";
import { importLogo, saveLogo, type LogoImport, type PresetRow } from "../lib/api";
import { STANDARD_PRESET_ID, validateLogoSpec, type BrandMode, type LogoSpec, type ShapeRole } from "../lib/brand";
import { assembleLogo, uploadProblem, type ShapeChoice } from "../lib/logoLibrary";

const STEPS = ["Datei", "Formen", "Animation", "Rechte"] as const;
const ROLE_LABELS: Record<ShapeRole, string> = { fill: "Fläche", cutout: "Ausschnitt", stroke: "Nur Linie" };
const SHAPE_LABELS: Record<string, string> = {
  path: "Pfad",
  circle: "Kreis",
  ellipse: "Ellipse",
  rect: "Rechteck",
  line: "Linie",
  polygon: "Polygon",
  polyline: "Polylinie",
};

type WizardProps = {
  presets: PresetRow[];
  mode: BrandMode;
  onPresetsChanged: () => Promise<void>;
  onClose: () => void;
  /** Saved: the new logo's id (the page offers "Jetzt aktivieren"). */
  onSaved: (id: string) => void;
};

/** Upload of an SVG logo in four steps: file, shapes, animation, rights and saving. */
export function LogoUploadWizard({ presets, mode, onPresetsChanged, onClose, onSaved }: WizardProps) {
  const [step, setStep] = useState(0);
  const [imported, setImported] = useState<(LogoImport & { spec: LogoSpec }) | null>(null);
  const [choices, setChoices] = useState<ShapeChoice[]>([]);
  const [centre, setCentre] = useState(true);
  const [margin, setMargin] = useState(0.06);
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState(STANDARD_PRESET_ID);
  const [presetDirty, setPresetDirty] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assembled = useMemo(
    () => (imported === null ? null : assembleLogo(imported.spec, choices, centre, margin)),
    [imported, choices, centre, margin],
  );
  const spec = assembled?.ok === true ? assembled.spec : null;

  async function choose(file: File | undefined) {
    if (file === undefined) return;
    setError(null);
    const problem = uploadProblem(file);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const result = await importLogo(await file.text(), file.name);
      const checked = validateLogoSpec(result.spec);
      if (!checked.ok) throw new Error("Die Antwort des Servers ist kein gültiges Logo.");
      setImported({ ...result, spec: checked.spec });
      setChoices(checked.spec.shapes.map((shape, i) => ({ role: result.suggestions[i]?.role ?? shape.role, omit: result.suggestions[i]?.omit ?? false })));
      setName(result.fileName.replace(/\.svg$/i, "").slice(0, 40));
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (spec === null || imported === null) return;
    setBusy(true);
    setError(null);
    try {
      const id = await saveLogo({
        id: null,
        name: name.trim(),
        spec,
        presetId,
        sourceHash: imported.sourceHash,
        fileName: imported.fileName,
        rightsConfirmed: rights,
      });
      onSaved(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  const canNext =
    step === 0 ? imported !== null : step === 1 ? spec !== null && name.trim() !== "" && name.trim().length <= 40 : step === 2 ? !presetDirty : rights;

  return (
    <Modal
      open
      wide
      title="Logo hochladen"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          {step > 0 && (
            <button type="button" className="button" onClick={() => setStep(step - 1)} disabled={busy}>
              Zurück
            </button>
          )}
          {step < 3 ? (
            <button type="button" className="button primary" onClick={() => setStep(step + 1)} disabled={busy || !canNext}>
              Weiter
            </button>
          ) : (
            <button type="button" className="button primary" onClick={() => void save()} disabled={busy || !canNext}>
              {busy ? "Bitte warten …" : "In die Bibliothek speichern"}
            </button>
          )}
        </>
      }
    >
      <ol className="stepper" aria-label="Schritte">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={i === step ? "current" : i < step ? "done" : ""}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <label className="field">
            <span>SVG-Datei (höchstens 200 KB)</span>
            <input type="file" accept=".svg,image/svg+xml" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
          {busy && <p className="muted">Wird geprüft …</p>}
          <div className="notice">
            <p>So bereitest du ein Logo vor:</p>
            <ul className="plain-list">
              <li>Text in Pfade umwandeln (Schrift → Pfade / Konturen erstellen).</li>
              <li>Linien, die als Fläche erscheinen sollen: Konturen erweitern.</li>
              <li>Masken, Effekte, Verläufe und eingebettete Bilder entfernen oder anwenden.</li>
              <li>Als einfaches SVG exportieren (ohne CSS, ohne Editor-Daten). Farben werden ignoriert: Das Logo erscheint einfarbig in der Akzentfarbe.</li>
              <li>Höchstens 100 Formen und 8000 Pfadbefehle.</li>
            </ul>
          </div>
        </section>
      )}

      {step === 1 && imported !== null && (
        <section className="logo-shapes-step">
          <div className="logo-preview-box">
            {spec !== null ? (
              <BrandLogo spec={spec} params={null} palette="bw" mode={mode} size={220} background dots={false} />
            ) : (
              <p className="error">{assembled?.ok === false ? assembled.error : "Keine sichtbare Form."}</p>
            )}
          </div>
          <div>
            <label className="field">
              <span>Name (Pflicht, höchstens 40 Zeichen)</span>
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="choice">
              <input type="checkbox" checked={centre} onChange={(e) => setCentre(e.target.checked)} />
              Auto-Zentrierung
            </label>
            <label className="field">
              <span>Rand: {Math.round(margin * 100)} %</span>
              <input type="range" min={0} max={0.3} step={0.01} value={margin} disabled={!centre} onChange={(e) => setMargin(Number(e.target.value))} />
            </label>
            {imported.ignored > 0 && <p className="muted">{imported.ignored} unsichtbare Formen wurden ausgelassen.</p>}
            <table className="table">
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Rolle</th>
                  <th>Weglassen</th>
                </tr>
              </thead>
              <tbody>
                {imported.spec.shapes.map((shape, i) => (
                  <tr key={i}>
                    <td>
                      {i + 1}. {SHAPE_LABELS[shape.type] ?? shape.type}
                      {imported.suggestions[i]?.reason != null && <span className="muted"> · Vorschlag: {imported.suggestions[i]?.reason}</span>}
                    </td>
                    <td>
                      <select
                        value={choices[i]?.role ?? shape.role}
                        aria-label={`Rolle von Form ${i + 1}`}
                        onChange={(e) =>
                          setChoices((cur) => cur.map((c, j) => (j === i ? { ...c, role: e.target.value as ShapeRole } : c)))
                        }
                      >
                        {(Object.keys(ROLE_LABELS) as ShapeRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Form ${i + 1} weglassen`}
                        checked={choices[i]?.omit ?? false}
                        onChange={(e) => setChoices((cur) => cur.map((c, j) => (j === i ? { ...c, omit: e.target.checked } : c)))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {step === 2 && spec !== null && (
        <PresetPicker
          spec={spec}
          presets={presets}
          presetId={presetId}
          onSelect={setPresetId}
          onSaved={async () => onPresetsChanged()}
          onDirtyChange={setPresetDirty}
        />
      )}

      {step === 3 && spec !== null && (
        <section>
          <BrandLogo spec={spec} params={presets.find((p) => p.id === presetId)?.params} palette="bw" mode={mode} size={180} background playing />
          <label className="choice">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            Ich habe das Recht, dieses Logo zu verwenden.
          </label>
          <p className="muted">Die Bestätigung wird mit Zeitpunkt gespeichert. Die Datei selbst wird nicht gespeichert, nur die geprüfte Form und eine Prüfsumme.</p>
        </section>
      )}

      {error !== null && <p className="error">{error}</p>}
    </Modal>
  );
}
