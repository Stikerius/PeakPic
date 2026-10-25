import { useState } from "react";

import { Modal } from "../Modal";
import { ResultsAppPreview } from "./SurveyAppPreview";
import { SurveyMediaManager } from "./SurveyMediaManager";
import { previewResults, publishResults, type ResultsOptions, type SurveyDetail, type SurveyResultsDetail } from "../../lib/api";
import type { ResultsSnapshot } from "../../lib/surveys";

const STEPS = ["Fragen", "Zitate", "Fazit", "Medien", "Anzeige", "Vorschau"] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");

type Props = {
  surveyId: string;
  results: SurveyResultsDetail;
  detail: SurveyDetail;
  onMediaChanged: () => void;
  onClose: () => void;
  onDone: () => void;
};

/**
 * Publishing results as a post of the official account: which questions, single quotes of free
 * text (with a warning), the conclusion, images or logos, how long in feed and profile, the
 * preview as in the app, then the confirmation. The server builds the snapshot from this choice
 * and stores it once; later answers never change it.
 */
export function PublishResultsDialog({ surveyId, results, detail, onMediaChanged, onClose, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [questions, setQuestions] = useState<string[]>(() => results.questions.filter((q) => q.kind !== "text").map((q) => q.questionId));
  const [quotes, setQuotes] = useState<Record<string, string[]>>({});
  const [conclusion, setConclusion] = useState("");
  const [showRate, setShowRate] = useState(true);
  const [feedDays, setFeedDays] = useState(7);
  const [profileDays, setProfileDays] = useState<number | null>(90);
  const [preview, setPreview] = useState<ResultsSnapshot | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textQuestions = results.questions.filter((q) => q.kind === "text" && questions.includes(q.questionId));
  const options: ResultsOptions = {
    questions: results.questions.map((q) => q.questionId).filter((qid) => questions.includes(qid)),
    quotes,
    conclusion: conclusion.trim(),
    show_rate: showRate,
  };
  const stepProblem =
    step === 0 && questions.length === 0
      ? "Mindestens eine Frage."
      : step === 2 && (conclusion.trim().length < 1 || conclusion.trim().length > 600)
        ? "Bitte ein Fazit mit 1 bis 600 Zeichen."
        : step === 4 && (feedDays < 1 || feedDays > 90 || (profileDays !== null && (profileDays < 1 || profileDays > 3650)))
          ? "Feed 1 bis 90 Tage, Profil 1 bis 3650 oder unbegrenzt."
          : null;

  async function next() {
    setError(null);
    if (step === STEPS.length - 2) {
      setBusy(true);
      try {
        setPreview(await previewResults(surveyId, options));
        setStep(step + 1);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep(step + 1);
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <Modal
      open
      wide
      title="Auswertung veröffentlichen"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="button" onClick={step === 0 ? onClose : () => setStep(step - 1)} disabled={busy}>
            {step === 0 ? "Abbrechen" : "Zurück"}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="button primary" disabled={busy || stepProblem !== null} onClick={() => void next()}>
              {busy ? "Bitte warten …" : "Weiter"}
            </button>
          ) : (
            <button type="button" className="button primary" disabled={busy || preview === null} onClick={() => setConfirming(true)}>
              Veröffentlichen …
            </button>
          )}
        </>
      }
    >
      <ol className="stepper" aria-label="Schritte">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "current" : i < step ? "done" : undefined} aria-current={i === step ? "step" : undefined}>
            <span className="numeric">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <fieldset className="checklist">
          <legend>Welche Fragen zeigt die Auswertung?</legend>
          {results.questions.map((q, i) => (
            <label key={q.questionId} className="choice">
              <input type="checkbox" checked={questions.includes(q.questionId)} onChange={() => setQuestions(toggle(questions, q.questionId))} />
              <span>
                {i + 1}. {q.prompt} ({q.kind === "text" ? "Freitext: nur ausgewählte Zitate" : `${q.answered} Antworten`})
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 1 &&
        (textQuestions.length === 0 ? (
          <p className="muted">Keine Freitext-Frage ausgewählt: keine Zitate.</p>
        ) : (
          <>
            <p className="notice">
              Achtung: Auch anonyme Freitexte können eine Person erkennbar machen (Namen, Orte, Ereignisse, Schreibstil). Nur einzeln auswählen, was
              niemanden erkennen lässt. Verborgene Antworten lassen sich nicht zitieren.
            </p>
            {textQuestions.map((q) => (
              <fieldset key={q.questionId} className="checklist">
                <legend>{q.prompt}</legend>
                {q.texts
                  .filter((t) => !t.hidden)
                  .map((t) => (
                    <label key={t.responseId} className="choice">
                      <input
                        type="checkbox"
                        checked={(quotes[q.questionId] ?? []).includes(t.responseId)}
                        onChange={() => setQuotes({ ...quotes, [q.questionId]: toggle(quotes[q.questionId] ?? [], t.responseId).slice(0, 20) })}
                      />
                      <span>„{t.text}“</span>
                    </label>
                  ))}
              </fieldset>
            ))}
          </>
        ))}

      {step === 2 && (
        <>
          <label className="field">
            <span>Fazit (Pflicht, {[...conclusion.trim()].length} von 600 Zeichen)</span>
            <textarea rows={5} value={conclusion} maxLength={600} onChange={(e) => setConclusion(e.target.value)} />
          </label>
          <label className="choice">
            <input type="checkbox" checked={showRate} onChange={(e) => setShowRate(e.target.checked)} />
            Teilnahmequote zeigen
          </label>
        </>
      )}

      {step === 3 && <SurveyMediaManager surveyId={surveyId} scope="results" media={detail.media} onChanged={onMediaChanged} />}

      {step === 4 && (
        <>
          <label className="field">
            <span>Sichtbar im Feed (Tage ab jetzt, 1 bis 90)</span>
            <input type="number" min={1} max={90} value={feedDays} onChange={(e) => setFeedDays(Math.round(Number(e.target.value) || 0))} />
          </label>
          <label className="choice">
            <input type="checkbox" checked={profileDays === null} onChange={(e) => setProfileDays(e.target.checked ? null : 90)} />
            Im Profil unbegrenzt sichtbar
          </label>
          {profileDays !== null && (
            <label className="field">
              <span>Sichtbar im Profil (Tage, 1 bis 3650)</span>
              <input type="number" min={1} max={3650} value={profileDays} onChange={(e) => setProfileDays(Math.round(Number(e.target.value) || 0))} />
            </label>
          )}
        </>
      )}

      {step === 5 && preview !== null && (
        <>
          <p className="muted">So erscheint die Auswertung in der App. Diese Zahlen werden beim Veröffentlichen fest gespeichert.</p>
          <ResultsAppPreview snapshot={preview} />
        </>
      )}

      {stepProblem !== null && <p className="muted">{stepProblem}</p>}
      {error !== null && <p className="error">{error}</p>}

      {confirming && (
        <Modal
          open
          title="Jetzt veröffentlichen?"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button type="button" className="button" onClick={() => setConfirming(false)} disabled={busy}>
                Abbrechen
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  publishResults(surveyId, options, feedDays, profileDays)
                    .then(onDone)
                    .catch((e: unknown) => {
                      setError(errorText(e));
                      setConfirming(false);
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Veröffentlichen
              </button>
            </>
          }
        >
          <p>
            Die Auswertung erscheint für alle aktiven Konten im Feed ({feedDays} Tage) und im Profil des offiziellen Kontos (
            {profileDays === null ? "unbegrenzt" : `${profileDays} Tage`}). Die Zahlen sind danach fest; zurückziehen geht jederzeit.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
