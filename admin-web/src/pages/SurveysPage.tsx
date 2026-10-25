import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { SurveyAppPreview } from "../components/surveys/SurveyAppPreview";
import { CancelDialog, ExtendDialog } from "../components/surveys/SurveyDialogs";
import { EmptyState, PageHeader, SegmentedChoice, Skeleton } from "../components/ui";
import { addSurveyLogo, deleteSurvey, fetchSurveyDetail, fetchSurveyList, saveSurvey, type SurveyDetail } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { href } from "../lib/router";
import { actionsFor, duplicateDraft, filterSurveys, percent, rate, stateLabel, type SurveyListRow } from "../lib/surveyAdmin";
import { remainingText, type SurveyState } from "../lib/surveys";

const FILTERS: readonly (readonly [SurveyState | "all", string])[] = [
  ["all", "Alle"],
  ["draft", "Entwurf"],
  ["scheduled", "Geplant"],
  ["active", "Aktiv"],
  ["closed", "Beendet"],
  ["cancelled", "Abgebrochen"],
];

type Dialog =
  | { kind: "extend"; row: SurveyListRow }
  | { kind: "cancel"; row: SurveyListRow }
  | { kind: "delete"; row: SurveyListRow }
  | { kind: "preview"; detail: SurveyDetail };

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");

/** "Umfragen" (admins): all surveys with state, period, answers and participation, and their actions. */
export function SurveysPage() {
  const [rows, setRows] = useState<SurveyListRow[] | null>(null);
  const [filter, setFilter] = useState<SurveyState | "all">("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSurveyList()
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    load();
  }

  async function duplicate(row: SurveyListRow) {
    setBusy(true);
    setError(null);
    try {
      const detail = await fetchSurveyDetail(row.id);
      const id = await saveSurvey(null, duplicateDraft(detail.draft));
      // Logos come along; images stay with the original (upload them again if needed).
      for (const m of detail.media.filter((x) => x.kind === "logo" && x.scope === "survey" && x.logoId !== null)) {
        await addSurveyLogo(id, "survey", m.logoId ?? "", m.altText);
      }
      window.location.hash = href({ page: "survey-edit", id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function preview(row: SurveyListRow) {
    try {
      setDialog({ kind: "preview", detail: await fetchSurveyDetail(row.id) });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const visible = rows === null ? [] : filterSurveys(rows, filter, query);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Umfragen"
        actions={
          <a className="button primary" href={href({ page: "survey-edit", id: null })}>
            Neue Umfrage
          </a>
        }
      >
        Umfragen des offiziellen Kontos: anlegen, veröffentlichen, verlängern, abbrechen und auswerten. Antworten sind anonym; Zahlen gibt es nur
        zusammengefasst.
      </PageHeader>
      {error !== null && <p className="error">{error}</p>}
      {notice !== null && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="filters">
        <SegmentedChoice<SurveyState | "all"> label="Status" value={filter} options={FILTERS} onChange={setFilter} small />
        <label className="grow">
          Suche
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titel" />
        </label>
      </div>

      {rows === null && error === null && <Skeleton lines={5} label="Umfragen laden" />}
      {rows !== null && visible.length === 0 && (
        <EmptyState
          title={rows.length === 0 ? "Noch keine Umfragen" : "Keine Treffer"}
          action={
            rows.length === 0 ? (
              <a className="button primary" href={href({ page: "survey-edit", id: null })}>
                Erste Umfrage anlegen
              </a>
            ) : undefined
          }
        >
          {rows.length === 0 ? "Eine Umfrage erscheint nach dem Veröffentlichen oben im Feed aller aktiven Konten." : "Filter oder Suche anpassen."}
        </EmptyState>
      )}
      {visible.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Titel</th>
                <th>Status</th>
                <th>Zeitraum</th>
                <th>Restzeit</th>
                <th className="numeric">Antworten</th>
                <th className="numeric">Teilnahmequote</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const actions = actionsFor(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <a href={href({ page: "survey-edit", id: row.id })}>{row.title}</a>
                      {row.locked && row.state !== "closed" && row.state !== "cancelled" && <span className="pill">Fragen gesperrt</span>}
                    </td>
                    <td>
                      <span className={row.state === "active" ? "pill accent" : "pill"}>{stateLabel(row.state)}</span>
                    </td>
                    <td>
                      {row.startsAt !== null ? formatDateTime(row.startsAt) : "–"} bis {row.endsAt !== null ? formatDateTime(row.endsAt) : "–"}
                    </td>
                    <td>{row.state === "active" ? remainingText(row.endsAt, now) : row.state === "scheduled" ? "startet später" : "–"}</td>
                    <td className="numeric">{row.responses}</td>
                    <td className="numeric">{percent(rate(row.participants, row.eligibleStart))}</td>
                    <td>
                      <div className="action-row">
                        {actions.edit && (
                          <a className="button small" href={href({ page: "survey-edit", id: row.id })}>
                            {row.state === "draft" ? "Bearbeiten" : "Ändern"}
                          </a>
                        )}
                        <button type="button" className="button small" onClick={() => void preview(row)}>
                          Vorschau
                        </button>
                        {actions.publish && (
                          <a className="button small primary" href={href({ page: "survey-edit", id: row.id })}>
                            Veröffentlichen
                          </a>
                        )}
                        {actions.extend && (
                          <button type="button" className="button small" onClick={() => setDialog({ kind: "extend", row })}>
                            Verlängern
                          </button>
                        )}
                        {actions.cancel && (
                          <button type="button" className="button small danger" onClick={() => setDialog({ kind: "cancel", row })}>
                            Abbrechen
                          </button>
                        )}
                        {actions.results && (
                          <a className="button small" href={href({ page: "survey-results", id: row.id })}>
                            Auswerten
                          </a>
                        )}
                        <button type="button" className="button small" disabled={busy} onClick={() => void duplicate(row)}>
                          Duplizieren
                        </button>
                        {actions.remove && (
                          <button type="button" className="button small danger" onClick={() => setDialog({ kind: "delete", row })}>
                            Löschen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "extend" && dialog.row.startsAt !== null && dialog.row.endsAt !== null && (
        <ExtendDialog
          surveyId={dialog.row.id}
          title={dialog.row.title}
          startsAt={dialog.row.startsAt}
          endsAt={dialog.row.endsAt}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog surveyId={dialog.row.id} title={dialog.row.title} responses={dialog.row.responses} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === "preview" && (
        <Modal open wide title={`Vorschau: ${dialog.detail.draft.title}`} onClose={() => setDialog(null)} actions={<button type="button" className="button" onClick={() => setDialog(null)}>Schliessen</button>}>
          <SurveyAppPreview draft={dialog.detail.draft} media={dialog.detail.media} />
        </Modal>
      )}
      <ConfirmDialog
        open={dialog?.kind === "delete"}
        title="Entwurf löschen?"
        confirmLabel="Löschen"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          setBusy(true);
          deleteSurvey(dialog.row.id)
            .then(() => done("Entwurf gelöscht."))
            .catch((e: unknown) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        <p>„{dialog?.kind === "delete" ? dialog.row.title : ""}“ wird endgültig gelöscht.</p>
      </ConfirmDialog>
    </>
  );
}
