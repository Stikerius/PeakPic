import { useState } from "react";

import { Modal } from "../Modal";
import { cancelSurvey, extendSurvey, publishSurvey, verifyTotpAgain } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { durationInfo, fromLocalInput, toLocalInput } from "../../lib/surveyAdmin";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");

type Base = { surveyId: string; title: string; onClose: () => void; onDone: (message: string) => void };

/** "Verlängern": only a later end, at most 90 days after the start. */
export function ExtendDialog({ surveyId, title, startsAt, endsAt, onClose, onDone }: Base & { startsAt: string; endsAt: string }) {
  const [value, setValue] = useState(toLocalInput(endsAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = fromLocalInput(value);
  const info = durationInfo(startsAt, next, new Date());
  const later = next !== null && Date.parse(next) > Date.parse(endsAt);
  return (
    <Modal
      open
      title={`„${title}“ verlängern`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !later || info.problem !== null}
            onClick={() => {
              if (next === null) return;
              setBusy(true);
              extendSurvey(surveyId, next)
                .then(() => onDone(`Verlängert bis ${formatDateTime(next)}.`))
                .catch((e: unknown) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            Verlängern
          </button>
        </>
      }
    >
      <p>Bisheriges Ende: {formatDateTime(endsAt)}. Höchstens 90 Tage nach dem Start.</p>
      <label className="field">
        <span>Neues Ende</span>
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <p className="muted">{info.text}</p>
      {!later && <p className="muted">Das neue Ende muss nach dem bisherigen liegen.</p>}
      {info.problem !== null && later && <p className="error">{info.problem}</p>}
      {error !== null && <p className="error">{error}</p>}
    </Modal>
  );
}

/** "Abbrechen": reason required; keep the answers for the internal evaluation or discard them. */
export function CancelDialog({ surveyId, title, responses, onClose, onDone }: Base & { responses: number }) {
  const [reason, setReason] = useState("");
  const [keep, setKeep] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 10 && reason.trim().length <= 500 && keep !== null;
  return (
    <Modal
      open
      title={`„${title}“ abbrechen?`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Zurück
          </button>
          <button
            type="button"
            className="button primary danger"
            disabled={busy || !valid}
            onClick={() => {
              if (keep === null) return;
              setBusy(true);
              cancelSurvey(surveyId, reason.trim(), keep)
                .then(() => onDone(keep ? "Abgebrochen, die Antworten bleiben für die Auswertung." : "Abgebrochen, Antworten und Zähler sind gelöscht."))
                .catch((e: unknown) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            Umfrage abbrechen
          </button>
        </>
      }
    >
      <p>Die Umfrage verschwindet sofort aus der App. Bisher {responses === 1 ? "1 Antwort" : `${responses} Antworten`}.</p>
      <label className="field">
        <span>Begründung (Pflicht, 10 bis 500 Zeichen, steht im Audit-Log)</span>
        <textarea rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <fieldset className="checklist">
        <legend>Antworten</legend>
        <label className="choice">
          <input type="radio" name="keep" checked={keep === true} onChange={() => setKeep(true)} />
          <span>Behalten: bleiben für die interne Auswertung (eine Auswertung lässt sich danach veröffentlichen).</span>
        </label>
        <label className="choice">
          <input type="radio" name="keep" checked={keep === false} onChange={() => setKeep(false)} />
          <span>Verwerfen: Antworten, Teilnahmen und Zähler werden endgültig gelöscht.</span>
        </label>
      </fieldset>
      {error !== null && <p className="error">{error}</p>}
    </Modal>
  );
}

/**
 * "Veröffentlichen": summary, the number of accounts that can take part, then the confirmation
 * with a fresh two-factor code (like other delicate actions).
 */
export function PublishDialog({ surveyId, title, eligible, summary, onClose, onDone }: Base & { eligible: number; summary: { label: string; value: string }[] }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      title={`„${title}“ veröffentlichen?`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ""))}
            onClick={() => {
              setBusy(true);
              setError(null);
              verifyTotpAgain(code)
                .then(() => publishSurvey(surveyId))
                .then((r) => onDone(`Veröffentlicht für ${r.eligible} Konten.`))
                .catch((e: unknown) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Bitte warten …" : "Jetzt veröffentlichen"}
          </button>
        </>
      }
    >
      <dl className="summary-list">
        {summary.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Erreicht <strong className="numeric">{eligible}</strong> aktive Konten. Danach lassen sich Fragen und Texte nur ändern, bis die erste Antwort
        eingeht.
      </p>
      <label className="field">
        <span>Zwei-Faktor-Code (6 Ziffern aus deiner Authenticator-App)</span>
        <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {error !== null && <p className="error">{error}</p>}
    </Modal>
  );
}
