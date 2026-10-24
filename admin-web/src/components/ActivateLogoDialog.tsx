import { useState } from "react";

import { Modal } from "./Modal";
import { activateLogo, TARGET_LABELS, type LogoRow } from "../lib/api";
import { DESIGN_TARGETS as TARGETS, defaultTargets, type DesignTarget } from "../lib/logoLibrary";

export function ActivateLogoDialog({
  logo,
  logos,
  onClose,
  onDone,
}: {
  logo: LogoRow;
  logos: LogoRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<DesignTarget[]>(() => defaultTargets(logos, logo.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeName = (target: DesignTarget) => logos.find((l) => l.targets.includes(target))?.name ?? "keines";

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await activateLogo(logo.id, targets);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`„${logo.name}“ aktivieren`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="button primary" onClick={() => void confirm()} disabled={busy || targets.length === 0}>
            {busy ? "Bitte warten …" : "Aktivieren"}
          </button>
        </>
      }
    >
      <fieldset className="checklist">
        <legend>Ziele</legend>
        {TARGETS.map((t) => (
          <label key={t} className="choice">
            <input
              type="checkbox"
              checked={targets.includes(t)}
              disabled={logo.targets.includes(t)}
              onChange={(e) => setTargets((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
            />
            <span>
              {TARGET_LABELS[t]}: jetzt aktiv „{activeName(t)}“{logo.targets.includes(t) ? " (bereits dieses Logo)" : ""}
            </span>
          </label>
        ))}
      </fieldset>
      {targets.length > 0 && (
        <p>
          Danach zeigt {targets.map((t) => TARGET_LABELS[t]).join(" und ")} das Logo „{logo.name}“ mit dem Preset „{logo.presetName}“.
          {targets.includes("app_login") && " In der App wirkt es spätestens beim nächsten Öffnen des Anmeldebildschirms."}
        </p>
      )}
      {error !== null && <p className="error">{error}</p>}
    </Modal>
  );
}
