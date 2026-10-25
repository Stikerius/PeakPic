import { useCallback, useEffect, useState } from "react";

import { QuestionEditor } from "../components/surveys/QuestionEditor";
import { SurveyAppPreview } from "../components/surveys/SurveyAppPreview";
import { PublishDialog } from "../components/surveys/SurveyDialogs";
import { SurveyMediaManager } from "../components/surveys/SurveyMediaManager";
import { EmptyState, PageHeader, Skeleton } from "../components/ui";
import { fetchSurveyDetail, saveSurvey, type SurveyDetail } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { href } from "../lib/router";
import {
  EDITOR_STEPS,
  STEP_LABELS,
  durationInfo,
  editorReducer,
  emptyDraft,
  fromLocalInput,
  stateLabel,
  stepProblems,
  type EditorAction,
  type EditorState,
  type SurveyDraft,
} from "../lib/surveyAdmin";
import { QUESTION_KIND_LABELS, SURVEY_LIMITS } from "../lib/surveys";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");

/**
 * Editor of a survey, a wizard with "Zurück": basics, media, questions, display in the feed,
 * preview, publishing. Drafts are saved on "Weiter" and with "Entwurf speichern". Published
 * surveys can be changed until the first answer (start and end stay); after that everything
 * here is read only (extend and cancel are on the list).
 */
export function SurveyEditorPage({ id: initialId }: { id: string | null }) {
  const [id, setId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<SurveyDetail | null>(null);
  const [draft, setDraft] = useState<SurveyDraft | null>(initialId === null ? emptyDraft() : null);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<EditorState>({ step: 0, furthest: initialId === null ? 0 : EDITOR_STEPS.length - 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const reload = useCallback((surveyId: string, keepDraft: boolean) => {
    return fetchSurveyDetail(surveyId)
      .then((d) => {
        setDetail(d);
        if (!keepDraft) setDraft(d.draft);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    if (initialId !== null) void reload(initialId, false);
  }, [initialId, reload]);

  const now = new Date();
  const published = detail !== null && detail.state !== "draft";
  const finished = detail !== null && (detail.state === "closed" || detail.state === "cancelled");
  const readOnly = finished || (detail?.locked ?? false);
  const step = EDITOR_STEPS[state.step] ?? "basics";

  if (draft === null) return error !== null ? <p className="error">{error}</p> : <Skeleton lines={6} label="Umfrage laden" />;

  function change(next: Partial<SurveyDraft>) {
    setDraft((d) => (d === null ? d : { ...d, ...next }));
    setDirty(true);
    setNotice(null);
  }

  /** Saves the draft (creates it the first time); returns the id or null on an error. */
  async function save(): Promise<string | null> {
    if (draft === null) return null;
    if (readOnly) return id;
    if (!dirty && id !== null) return id;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveSurvey(id, draft);
      if (id === null) {
        setId(saved);
        // Stays on this page (no new mount): the address now names the draft.
        window.history.replaceState(null, "", href({ page: "survey-edit", id: saved }));
      }
      setDirty(false);
      await reload(saved, true);
      return saved;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function go(action: EditorAction) {
    if (draft === null) return;
    if (action.type !== "back" && (await save()) === null) return;
    setState((s) => editorReducer(s, action, draft, new Date(), published));
  }

  const problems = stepProblems(draft, step, now, published);
  const start = draft.startMode === "now" ? null : fromLocalInput(draft.startsAt);
  const duration = durationInfo(start, fromLocalInput(draft.endsAt), now);

  return (
    <>
      <PageHeader title={draft.title.trim() === "" ? "Neue Umfrage" : draft.title} back={{ href: href({ page: "surveys" }), label: "Umfragen" }}>
        {detail === null ? "Entwurf, noch nicht gespeichert." : `${stateLabel(detail.state)}${detail.publishedAt !== null ? `, veröffentlicht ${formatDateTime(detail.publishedAt)}` : ""}.`}
      </PageHeader>

      {readOnly && (
        <p className="notice">
          {finished
            ? "Die Umfrage ist beendet oder abgebrochen und lässt sich nicht mehr ändern."
            : "Es gibt schon Antworten: Fragen, Optionen und Texte sind gesperrt. Möglich bleiben Verlängern, Abbrechen (in der Liste) und der Austausch von Bildern."}
        </p>
      )}

      <div className="wizard">
        <ol className="stepper" aria-label="Schritte">
          {EDITOR_STEPS.map((s, i) => (
            <li key={s} className={i === state.step ? "current" : i <= state.furthest ? "done" : undefined} aria-current={i === state.step ? "step" : undefined}>
              <button type="button" className="step-button" disabled={i > state.furthest || busy} onClick={() => void go({ type: "goto", step: i })}>
                <span className="numeric">{i + 1}</span> {STEP_LABELS[s]}
              </button>
            </li>
          ))}
        </ol>

        <section className="panel" aria-labelledby="step-title">
          <h2 id="step-title">{STEP_LABELS[step]}</h2>

          {step === "basics" && (
            <fieldset className="form-grid" disabled={readOnly}>
              <label className="field">
                <span>
                  Titel ({[...draft.title.trim()].length} von {SURVEY_LIMITS.title[1]})
                </span>
                <input value={draft.title} maxLength={SURVEY_LIMITS.title[1]} onChange={(e) => change({ title: e.target.value })} />
              </label>
              <label className="field">
                <span>
                  Worum geht es ({[...draft.topic.trim()].length} von {SURVEY_LIMITS.topic[1]})
                </span>
                <textarea rows={4} value={draft.topic} maxLength={SURVEY_LIMITS.topic[1]} onChange={(e) => change({ topic: e.target.value })} />
              </label>
              <fieldset className="checklist" disabled={published}>
                <legend>Start</legend>
                <label className="choice">
                  <input type="radio" checked={draft.startMode === "now"} onChange={() => change({ startMode: "now" })} />
                  Sofort beim Veröffentlichen
                </label>
                <label className="choice">
                  <input type="radio" checked={draft.startMode === "scheduled"} onChange={() => change({ startMode: "scheduled" })} />
                  Geplant
                </label>
                {draft.startMode === "scheduled" && (
                  <label className="field">
                    <span>Start</span>
                    <input type="datetime-local" value={draft.startsAt} onChange={(e) => change({ startsAt: e.target.value })} />
                  </label>
                )}
              </fieldset>
              <label className="field">
                <span>Ende (Pflicht; mindestens 1 Stunde, höchstens 90 Tage nach dem Start)</span>
                <input type="datetime-local" value={draft.endsAt} disabled={published} onChange={(e) => change({ endsAt: e.target.value })} />
              </label>
              {duration.text !== "" && <p className="muted">{duration.text}</p>}
              {published && <p className="muted">Start und Ende sind nach dem Veröffentlichen fest; das Ende lässt sich in der Liste verlängern.</p>}
            </fieldset>
          )}

          {step === "media" &&
            (id === null || detail === null ? (
              <EmptyState title="Zuerst speichern">Bilder und Logos lassen sich hinzufügen, sobald der Entwurf gespeichert ist.</EmptyState>
            ) : (
              <SurveyMediaManager
                surveyId={id}
                scope="survey"
                media={detail.media}
                onChanged={() => void reload(id, true)}
                note={detail.locked ? "Es gibt schon Antworten: Ein ausgetauschtes Bild sehen alle sofort, auch wer schon teilgenommen hat." : undefined}
              />
            ))}

          {step === "questions" && (
            <>
              <fieldset className="free-text" disabled={readOnly || published}>
                <label className="choice">
                  <input
                    type="checkbox"
                    checked={draft.allowText}
                    onChange={(e) =>
                      change({ allowText: e.target.checked, questions: e.target.checked ? draft.questions : draft.questions.filter((q) => q.kind !== "text") })
                    }
                  />
                  Freitext-Fragen erlauben
                </label>
                {draft.allowText && (
                  <p className="notice">
                    Datenschutz: Freitext kann Personen erkennbar machen (Namen, Orte, Schreibstil). Antworten bleiben anonym gespeichert, sind aber nur
                    für die interne Auswertung; veröffentlicht werden höchstens einzeln ausgewählte Zitate. Bitte nur fragen, wenn nötig.
                  </p>
                )}
              </fieldset>
              <QuestionEditor questions={draft.questions} allowText={draft.allowText} disabled={readOnly} onChange={(questions) => change({ questions })} />
            </>
          )}

          {step === "display" && (
            <fieldset className="form-grid" disabled={readOnly || published}>
              <label className="choice">
                <input type="checkbox" checked={draft.pinUntilAnswered} onChange={(e) => change({ pinUntilAnswered: e.target.checked })} />
                Oben im Feed anheften, bis beantwortet (oder ausgeblendet)
              </label>
              <p className="muted">Ohne Haken steht die Umfrage nur beim ersten Anzeigen oben und rückt danach an ihren Platz nach Datum.</p>
              <label className="field">
                <span>Sichtbar im Feed (Tage ab Start, 1 bis 90)</span>
                <input type="number" min={1} max={90} value={draft.feedDays} onChange={(e) => change({ feedDays: Math.round(Number(e.target.value) || 0) })} />
              </label>
              <label className="choice">
                <input type="checkbox" checked={draft.profileDays === null} onChange={(e) => change({ profileDays: e.target.checked ? null : 90 })} />
                Im Profil unbegrenzt sichtbar
              </label>
              {draft.profileDays !== null && (
                <label className="field">
                  <span>Sichtbar im Profil (Tage ab Start, 1 bis 3650)</span>
                  <input type="number" min={1} max={3650} value={draft.profileDays} onChange={(e) => change({ profileDays: Math.round(Number(e.target.value) || 0) })} />
                </label>
              )}
              {published && <p className="muted">Die Anzeige ist nach dem Veröffentlichen fest.</p>}
            </fieldset>
          )}

          {step === "preview" && <SurveyAppPreview draft={draft} media={detail?.media ?? []} />}

          {step === "publish" && (
            <>
              <dl className="summary-list">
                <div>
                  <dt>Titel</dt>
                  <dd>{draft.title}</dd>
                </div>
                <div>
                  <dt>Zeitraum</dt>
                  <dd>
                    {draft.startMode === "now" ? "ab Veröffentlichung" : formatDateTime(fromLocalInput(draft.startsAt))} bis {formatDateTime(fromLocalInput(draft.endsAt))}{" "}
                    {duration.text !== "" ? `(${duration.text})` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Fragen</dt>
                  <dd>{draft.questions.map((q, i) => `${i + 1}. ${QUESTION_KIND_LABELS[q.kind]}${q.required ? "" : " (freiwillig)"}`).join(", ")}</dd>
                </div>
                <div>
                  <dt>Anzeige</dt>
                  <dd>
                    {draft.pinUntilAnswered ? "oben bis beantwortet" : "beim ersten Mal oben"}, Feed {draft.feedDays} Tage, Profil{" "}
                    {draft.profileDays === null ? "unbegrenzt" : `${draft.profileDays} Tage`}
                  </dd>
                </div>
                <div>
                  <dt>Medien</dt>
                  <dd>{(detail?.media ?? []).filter((m) => m.scope === "survey").length} Bilder und Logos</dd>
                </div>
              </dl>
              {problems.length === 0 && detail !== null && !published && (
                <button type="button" className="button primary" disabled={busy || dirty} onClick={() => setPublishing(true)}>
                  Veröffentlichen …
                </button>
              )}
              {dirty && <p className="muted">Bitte zuerst speichern.</p>}
              {published && <p className="success">Diese Umfrage ist veröffentlicht ({stateLabel(detail?.state ?? "draft")}).</p>}
            </>
          )}

          {problems.length > 0 && step !== "preview" && step !== "media" && (
            <ul className="problems" aria-live="polite">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </section>

        {error !== null && <p className="error">{error}</p>}
        {notice !== null && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        <div className="action-row">
          <button type="button" className="button" disabled={busy || state.step === 0} onClick={() => void go({ type: "back" })}>
            Zurück
          </button>
          {!readOnly && (
            <button
              type="button"
              className="button"
              disabled={busy || (!dirty && id !== null)}
              onClick={() => void save().then((saved) => saved !== null && setNotice(published ? "Änderungen gespeichert." : "Entwurf gespeichert."))}
            >
              {published ? "Änderungen speichern" : "Entwurf speichern"}
            </button>
          )}
          {state.step < EDITOR_STEPS.length - 1 && (
            <button type="button" className="button primary" disabled={busy || problems.length > 0} onClick={() => void go({ type: "next" })}>
              {busy ? "Bitte warten …" : "Weiter"}
            </button>
          )}
        </div>
      </div>

      {publishing && id !== null && detail !== null && (
        <PublishDialog
          surveyId={id}
          title={draft.title}
          eligible={detail.eligibleNow}
          summary={[
            { label: "Start", value: draft.startMode === "now" ? "sofort" : formatDateTime(fromLocalInput(draft.startsAt)) },
            { label: "Ende", value: formatDateTime(fromLocalInput(draft.endsAt)) },
            { label: "Fragen", value: String(draft.questions.length) },
          ]}
          onClose={() => setPublishing(false)}
          onDone={(message) => {
            setPublishing(false);
            setNotice(message);
            void reload(id, false);
          }}
        />
      )}
    </>
  );
}
