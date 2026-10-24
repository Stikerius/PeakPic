import { useCallback, useEffect, useState } from "react";

import { ActivateLogoDialog } from "../components/ActivateLogoDialog";
import { BrandLogo } from "../components/BrandLogo";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LogoUploadWizard } from "../components/LogoUploadWizard";
import { Modal } from "../components/Modal";
import { PresetPicker } from "../components/PresetPicker";
import {
  TARGET_LABELS,
  deleteLogo,
  deletePreset,
  fetchLogos,
  fetchPresets,
  saveLogo,
  savePreset,
  type LogoRow,
  type PresetRow,
} from "../lib/api";
import { validateLogoSpec, type ShapeRole } from "../lib/brand";
import { useDashboardBrand } from "../lib/dashboardBrand";
import { formatDateTime } from "../lib/format";
import { deleteBlocker, duplicateName } from "../lib/logoLibrary";
import { PageHeader, Skeleton } from "../components/ui";

const MAX_UPLOADED = 30;
const ROLE_LABELS: Record<ShapeRole, string> = { fill: "Fläche", cutout: "Ausschnitt", stroke: "Nur Linie" };

type Dialog =
  | { kind: "upload" }
  | { kind: "edit"; logo: LogoRow }
  | { kind: "animation"; logo: LogoRow }
  | { kind: "activate"; logo: LogoRow }
  | { kind: "duplicate"; logo: LogoRow }
  | { kind: "delete"; logo: LogoRow }
  | { kind: "preset-delete"; preset: PresetRow }
  | { kind: "preset-rename"; preset: PresetRow }
  | null;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Fehler";
}

/** "Logos" (admins only): the library, upload, editing, animations and activating. */
export function LogosPage() {
  const brand = useDashboardBrand();
  const [logos, setLogos] = useState<LogoRow[] | null>(null);
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([fetchLogos(), fetchPresets()]);
      setLogos(l);
      setPresets(p);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([fetchLogos(), fetchPresets()])
      .then(([l, p]) => {
        if (!active) return;
        setLogos(l);
        setPresets(p);
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, []);

  const uploaded = (logos ?? []).filter((l) => l.kind === "uploaded").length;

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    try {
      await action();
      setNotice(done);
      setDialog(null);
      await load();
      brand.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <>
      <PageHeader title="Logos">
        Logos erscheinen einfarbig in der Akzentfarbe der gewählten Palette. Aktiv ist je Ziel genau ein Logo: „App-Anmeldung“ (Anmeldebildschirm der
        App) und „Dashboard“ (Anmeldeseite, Ladebildschirm, Kopfzeile).
      </PageHeader>
      {error !== null && <p className="error">{error}</p>}
      {notice !== null && <p className="success">{notice}</p>}
      <div className="action-row">
        <button type="button" className="button primary" disabled={uploaded >= MAX_UPLOADED} onClick={() => setDialog({ kind: "upload" })}>
          Logo hochladen
        </button>
        <span className="muted">
          {uploaded} von {MAX_UPLOADED} hochgeladenen Logos
        </span>
      </div>

      {logos === null && error === null && <Skeleton lines={4} label="Logos laden" />}
      <div className="logo-grid">
        {(logos ?? []).map((logo) => {
          const blocker = deleteBlocker(logo);
          return (
            <article
              key={logo.id}
              className="logo-tile"
              onMouseEnter={() => setPlaying(logo.id)}
              onMouseLeave={() => setPlaying((cur) => (cur === logo.id ? null : cur))}
            >
              <div className="logo-tile-preview">
                <BrandLogo
                  spec={logo.spec}
                  params={presets.find((p) => p.id === logo.presetId)?.params}
                  palette={brand.palette}
                  mode={brand.mode}
                  size={160}
                  background
                  playing={playing === logo.id}
                />
              </div>
              <h2 className="logo-tile-title">{logo.name}</h2>
              <p className="muted">
                {logo.kind === "builtin" ? "Eingebaut" : `Hochgeladen ${formatDateTime(logo.createdAt)}${logo.uploadedBy !== null ? ` von @${logo.uploadedBy}` : ""}`}
              </p>
              <p className="muted">Preset: {logo.presetName}</p>
              <p>
                {logo.targets.length === 0 ? (
                  <span className="muted">Nicht aktiv</span>
                ) : (
                  logo.targets.map((t) => (
                    <span key={t} className="pill">
                      Aktiv: {TARGET_LABELS[t]}
                    </span>
                  ))
                )}
              </p>
              <div className="action-row">
                <button type="button" className="button small" onClick={() => setPlaying(playing === logo.id ? null : logo.id)}>
                  {playing === logo.id ? "Anhalten" : "Abspielen"}
                </button>
                <button type="button" className="button small primary" onClick={() => setDialog({ kind: "activate", logo })} disabled={logo.targets.length === 2}>
                  Aktivieren
                </button>
                <button type="button" className="button small" onClick={() => setDialog({ kind: "edit", logo })}>
                  Bearbeiten
                </button>
                <button type="button" className="button small" onClick={() => setDialog({ kind: "animation", logo })}>
                  Animation bearbeiten
                </button>
                <button type="button" className="button small" disabled={uploaded >= MAX_UPLOADED} onClick={() => setDialog({ kind: "duplicate", logo })}>
                  Duplizieren
                </button>
                <button
                  type="button"
                  className="button small danger"
                  disabled={blocker !== null}
                  title={blocker ?? undefined}
                  onClick={() => setDialog({ kind: "delete", logo })}
                >
                  Löschen
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <h2 className="section-title">Animations-Presets</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Art</th>
            <th className="numeric">Verwendet von</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {presets.map((preset) => (
            <tr key={preset.id}>
              <td>{preset.name}</td>
              <td>{preset.kind === "builtin" ? "Eingebaut" : "Eigenes"}</td>
              <td className="numeric">{preset.usedBy}</td>
              <td>
                <div className="action-row">
                  <button
                    type="button"
                    className="button small"
                    onClick={() => void run(() => savePreset(null, duplicateName(preset.name), preset.params), `„${preset.name}“ dupliziert.`)}
                  >
                    Duplizieren
                  </button>
                  {preset.kind === "custom" && (
                    <>
                      <button type="button" className="button small" onClick={() => setDialog({ kind: "preset-rename", preset })}>
                        Umbenennen
                      </button>
                      <button
                        type="button"
                        className="button small danger"
                        disabled={preset.usedBy > 0}
                        title={preset.usedBy > 0 ? "Wird noch von einem Logo verwendet." : undefined}
                        onClick={() => setDialog({ kind: "preset-delete", preset })}
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {dialog?.kind === "upload" && (
        <LogoUploadWizard
          presets={presets}
          mode={brand.mode}
          onPresetsChanged={load}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            void load().then(() => {
              setNotice("Logo gespeichert.");
              setDialog(null);
              void fetchLogos().then((list) => {
                const saved = list.find((l) => l.id === id);
                if (saved !== undefined) setDialog({ kind: "activate", logo: saved });
              });
            });
          }}
        />
      )}
      {dialog?.kind === "activate" && logos !== null && (
        <ActivateLogoDialog
          logo={dialog.logo}
          logos={logos}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNotice(`„${dialog.logo.name}“ ist aktiv.`);
            void load();
            brand.reload();
          }}
        />
      )}
      {dialog?.kind === "edit" && <EditLogoDialog logo={dialog.logo} presets={presets} onClose={() => setDialog(null)} onSave={(save) => void run(save, "Logo gespeichert.")} />}
      {dialog?.kind === "animation" && (
        <AnimationDialog logo={dialog.logo} presets={presets} onPresetsChanged={load} onClose={() => setDialog(null)} onSave={(save) => void run(save, "Animation gespeichert.")} />
      )}
      {dialog?.kind === "duplicate" && (
        <DuplicateDialog logo={dialog.logo} onClose={() => setDialog(null)} onSave={(save) => void run(save, "Logo dupliziert.")} />
      )}
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        title="Logo löschen?"
        confirmLabel="Löschen"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind === "delete") void run(() => deleteLogo(dialog.logo.id), "Logo gelöscht.");
        }}
      >
        <p>„{dialog?.kind === "delete" ? dialog.logo.name : ""}“ wird endgültig aus der Bibliothek entfernt.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog?.kind === "preset-delete"}
        title="Preset löschen?"
        confirmLabel="Löschen"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind === "preset-delete") void run(() => deletePreset(dialog.preset.id), "Preset gelöscht.");
        }}
      >
        <p>„{dialog?.kind === "preset-delete" ? dialog.preset.name : ""}“ wird gelöscht.</p>
      </ConfirmDialog>
      {dialog?.kind === "preset-rename" && (
        <RenamePresetDialog preset={dialog.preset} onClose={() => setDialog(null)} onSave={(save) => void run(save, "Preset umbenannt.")} />
      )}
    </>
  );
}

function EditLogoDialog({
  logo,
  presets,
  onClose,
  onSave,
}: {
  logo: LogoRow;
  presets: PresetRow[];
  onClose: () => void;
  onSave: (save: () => Promise<unknown>) => void;
}) {
  const checked = validateLogoSpec(logo.spec);
  const [name, setName] = useState(logo.name);
  const [roles, setRoles] = useState<ShapeRole[]>(checked.ok ? checked.spec.shapes.map((s) => s.role) : []);
  const [presetId, setPresetId] = useState(logo.presetId);
  const builtin = logo.kind === "builtin";
  const spec = checked.ok ? { ...checked.spec, shapes: checked.spec.shapes.map((s, i) => ({ ...s, role: roles[i] ?? s.role })) } : null;
  const valid = spec !== null && validateLogoSpec(spec).ok;

  return (
    <Modal
      open
      title={`„${logo.name}“ bearbeiten`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!valid || name.trim() === ""}
            onClick={() =>
              onSave(() =>
                saveLogo({ id: logo.id, name: name.trim(), spec: builtin ? null : spec, presetId, sourceHash: null, fileName: null, rightsConfirmed: false }),
              )
            }
          >
            Speichern
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={40} disabled={builtin} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Preset</span>
        <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {builtin ? (
        <p className="muted">Bei eingebauten Logos lassen sich nur das Preset und die Animation ändern.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Form</th>
              <th>Rolle</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role, i) => (
              <tr key={i}>
                <td>Form {i + 1}</td>
                <td>
                  <select value={role} aria-label={`Rolle von Form ${i + 1}`} onChange={(e) => setRoles((cur) => cur.map((r, j) => (j === i ? (e.target.value as ShapeRole) : r)))}>
                    {(Object.keys(ROLE_LABELS) as ShapeRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!valid && <p className="error">Mindestens eine Form muss sichtbar bleiben (nicht nur Ausschnitte).</p>}
    </Modal>
  );
}

function AnimationDialog({
  logo,
  presets,
  onPresetsChanged,
  onClose,
  onSave,
}: {
  logo: LogoRow;
  presets: PresetRow[];
  onPresetsChanged: () => Promise<void>;
  onClose: () => void;
  onSave: (save: () => Promise<unknown>) => void;
}) {
  const [presetId, setPresetId] = useState(logo.presetId);
  const [dirty, setDirty] = useState(false);
  return (
    <Modal
      open
      wide
      title={`Animation von „${logo.name}“`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="button primary"
            disabled={dirty}
            title={dirty ? "Zuerst als Preset speichern oder Änderungen verwerfen." : undefined}
            onClick={() =>
              onSave(() =>
                saveLogo({ id: logo.id, name: logo.name, spec: logo.kind === "builtin" ? null : logo.spec, presetId, sourceHash: null, fileName: null, rightsConfirmed: false }),
              )
            }
          >
            Preset für dieses Logo übernehmen
          </button>
        </>
      }
    >
      <PresetPicker spec={logo.spec} presets={presets} presetId={presetId} onSelect={setPresetId} onSaved={async () => onPresetsChanged()} onDirtyChange={setDirty} />
    </Modal>
  );
}

function DuplicateDialog({ logo, onClose, onSave }: { logo: LogoRow; onClose: () => void; onSave: (save: () => Promise<unknown>) => void }) {
  const [rights, setRights] = useState(false);
  return (
    <Modal
      open
      title={`„${logo.name}“ duplizieren`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!rights}
            onClick={() =>
              onSave(() =>
                saveLogo({ id: null, name: duplicateName(logo.name), spec: logo.spec, presetId: logo.presetId, sourceHash: null, fileName: null, rightsConfirmed: true }),
              )
            }
          >
            Duplizieren
          </button>
        </>
      }
    >
      <p>Die Kopie heisst „{duplicateName(logo.name)}“ und lässt sich danach unabhängig bearbeiten.</p>
      <label className="choice">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
        Ich habe das Recht, dieses Logo zu verwenden.
      </label>
    </Modal>
  );
}

function RenamePresetDialog({ preset, onClose, onSave }: { preset: PresetRow; onClose: () => void; onSave: (save: () => Promise<unknown>) => void }) {
  const [name, setName] = useState(preset.name);
  return (
    <Modal
      open
      title="Preset umbenennen"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="button primary" disabled={name.trim() === ""} onClick={() => onSave(() => savePreset(preset.id, name.trim(), preset.params))}>
            Speichern
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
    </Modal>
  );
}
