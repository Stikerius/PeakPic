import { useCallback, useEffect, useState } from "react";

import { BarChart, LineChart } from "../components/Charts";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PatternChart } from "../components/PatternChart";
import { PublishResultsDialog } from "../components/surveys/PublishResultsDialog";
import { EmptyState, PageHeader, Skeleton } from "../components/ui";
import { fetchSurveyDetail, fetchSurveyResults, hideSurveyText, withdrawItem, type SurveyDetail, type SurveyResultsDetail } from "../lib/api";
import { downloadJson, downloadText, fileStamp } from "../lib/download";
import { formatDateTime } from "../lib/format";
import { href } from "../lib/router";
import { MIN_ANSWERS, chartRows, exportCsv, exportSummary, percent, publishBlocker, rate, stateLabel } from "../lib/surveyAdmin";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");
const numberFormat = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 });

/**
 * The evaluation of one survey (also an interim result while it runs): participation, completion,
 * per question distribution, mean, median and NPS, free text with hiding, participations per day
 * and, from enough data, per hour. Below 5 answers the numbers come with a warning and can't be
 * published. Exports hold aggregated numbers only.
 */
export function SurveyResultsPage({ id }: { id: string }) {
  const [results, setResults] = useState<SurveyResultsDetail | null>(null);
  const [detail, setDetail] = useState<SurveyDetail | null>(null);
  const [tables, setTables] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchSurveyResults(id), fetchSurveyDetail(id)])
      .then(([r, d]) => {
        setResults(r);
        setDetail(d);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  if (results === null || detail === null) return error !== null ? <p className="error">{error}</p> : <Skeleton lines={8} label="Auswertung laden" />;

  const few = results.responses < MIN_ANSWERS;
  const blocker = publishBlocker(results, results.cancelKeepAnswers);
  const running = results.state === "active" || results.state === "scheduled";

  return (
    <>
      <PageHeader
        title={`Auswertung: ${results.title}`}
        back={{ href: href({ page: "surveys" }), label: "Umfragen" }}
        actions={
          <>
            <button type="button" className="button" onClick={() => downloadJson(`umfrage-${fileStamp()}.json`, exportSummary(results))}>
              Export JSON
            </button>
            <button type="button" className="button" onClick={() => downloadText(`umfrage-${fileStamp()}.csv`, exportCsv(results))}>
              Export CSV
            </button>
            <button type="button" className="button primary" disabled={blocker !== null} title={blocker ?? undefined} onClick={() => setPublishing(true)}>
              Auswertung veröffentlichen …
            </button>
          </>
        }
      >
        {stateLabel(results.state)}
        {running ? " – Zwischenstand, die Zahlen ändern sich noch." : "."} Exporte enthalten nur zusammengefasste Zahlen (keine einzelnen Antworten,
        keine Zeitpunkte).
      </PageHeader>
      {error !== null && <p className="error">{error}</p>}
      {notice !== null && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {results.answersPurgedAt !== null && (
        <p className="notice" role="status">
          Die anonymen Antworten wurden am {formatDateTime(results.answersPurgedAt)} nach Ablauf der Aufbewahrungsfrist gelöscht. Veröffentlichte
          Auswertungen bleiben unverändert.
        </p>
      )}
      {few && results.answersPurgedAt === null && (
        <p className="notice" role="alert">
          Weniger als {MIN_ANSWERS} Antworten ({results.responses}): Die Zahlen sind kaum aussagekräftig und könnten Rückschlüsse auf einzelne Personen
          erlauben. Veröffentlichen ist erst ab {MIN_ANSWERS} Antworten möglich.
        </p>
      )}
      {blocker !== null && !few && <p className="muted">{blocker}</p>}

      <div className="cards">
        <div className="card">
          <span className="card-value">{results.participants}</span>
          <span className="card-label">Teilnahmen</span>
        </div>
        <div className="card">
          <span className="card-value">{percent(rate(results.participants, results.eligibleStart))}</span>
          <span className="card-label">Teilnahmequote bei Start ({results.eligibleStart ?? "–"} erreichbare Konten)</span>
        </div>
        <div className="card">
          <span className="card-value">{percent(rate(results.participants, results.eligibleEnd))}</span>
          <span className="card-label">
            Teilnahmequote {running ? "jetzt" : "bei Ende"} ({results.eligibleEnd ?? "–"} Konten)
          </span>
        </div>
        <div className="card">
          <span className="card-value">{percent(rate(results.participants, results.started))}</span>
          <span className="card-label">Abschlussquote (abgeschickt von {results.started} begonnenen)</span>
        </div>
        <div className="card">
          <span className="card-value">{percent(rate(results.reach, results.eligibleStart))}</span>
          <span className="card-label">Reichweite ({results.reach} Konten haben die Karte gesehen)</span>
        </div>
        <div className="card">
          <span className="card-value">–</span>
          <span className="card-label">Median der Ausfülldauer (wird nicht erfasst)</span>
        </div>
      </div>

      {results.questions.map((q, i) => (
        <section key={q.questionId} className="panel" aria-labelledby={`q-${q.questionId}`}>
          <h2 id={`q-${q.questionId}`}>
            {i + 1}. {q.prompt}
          </h2>
          <p className="muted">
            {q.answered} Antworten
            {q.mean !== null ? ` · Mittelwert ${numberFormat.format(q.mean)}` : ""}
            {q.median !== null ? ` · Median ${numberFormat.format(q.median)}` : ""}
            {q.nps !== null ? ` · NPS ${numberFormat.format(q.nps)}` : ""}
          </p>
          {q.kind !== "text" ? (
            <>
              <PatternChart title={q.prompt} values={chartRows(q)} showTable={tables.has(q.questionId)} />
              <button
                type="button"
                className="button small"
                onClick={() =>
                  setTables((cur) => {
                    const next = new Set(cur);
                    if (next.has(q.questionId)) next.delete(q.questionId);
                    else next.add(q.questionId);
                    return next;
                  })
                }
              >
                {tables.has(q.questionId) ? "Tabelle ausblenden" : "Als Tabelle"}
              </button>
            </>
          ) : q.texts.length === 0 ? (
            <p className="muted">Noch keine Antworten.</p>
          ) : (
            <ul className="text-answers">
              {q.texts.map((t) => (
                <li key={t.responseId} className={t.hidden ? "hidden-answer" : undefined}>
                  <span>{t.hidden ? "(verborgen) " : ""}{t.text}</span>
                  <button
                    type="button"
                    className="button small"
                    onClick={() =>
                      hideSurveyText(t.responseId, q.questionId, !t.hidden)
                        .then(load)
                        .catch((e: unknown) => setError(errorText(e)))
                    }
                  >
                    {t.hidden ? "Wieder zeigen" : "Verbergen"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="panel">
        <h2>Teilnahmen pro Tag</h2>
        {results.perDay.length === 0 ? <p className="muted">Noch keine Teilnahmen.</p> : <LineChart title="Teilnahmen" bucket="day" points={results.perDay.map((d) => ({ bucket: d.day, value: d.count }))} />}
        <h3>Tageszeit</h3>
        {results.hours === null ? (
          <p className="muted">Erst ab 20 Teilnahmen (nur stündlich zusammengefasst).</p>
        ) : (
          <BarChart rows={results.hours.map((value, h) => ({ label: `${String(h).padStart(2, "0")} Uhr`, value }))} />
        )}
      </section>

      <section className="panel">
        <h2>Veröffentlichte Auswertungen</h2>
        {results.resultsItems.length === 0 ? (
          <EmptyState title="Noch keine">Eine Auswertung erscheint als eigene Karte im Feed und im Profil des offiziellen Kontos.</EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Veröffentlicht</th>
                <th>Im Feed bis</th>
                <th>Im Profil bis</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.resultsItems.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.publishedAt)}</td>
                  <td>{formatDateTime(item.feedUntil)}</td>
                  <td>{item.profileUntil === null ? "unbegrenzt" : formatDateTime(item.profileUntil)}</td>
                  <td>{item.status === "withdrawn" ? "Zurückgezogen" : "Sichtbar"}</td>
                  <td>
                    {item.status === "visible" && (
                      <button type="button" className="button small danger" onClick={() => setWithdrawing(item.id)}>
                        Zurückziehen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {publishing && (
        <PublishResultsDialog
          surveyId={id}
          results={results}
          detail={detail}
          onMediaChanged={load}
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            setNotice("Auswertung veröffentlicht.");
            load();
          }}
        />
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        title="Auswertung zurückziehen?"
        confirmLabel="Zurückziehen"
        danger
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => {
          if (withdrawing === null) return;
          withdrawItem(withdrawing)
            .then(() => {
              setWithdrawing(null);
              setNotice("Zurückgezogen: Die Karte ist sofort aus der App verschwunden.");
              load();
            })
            .catch((e: unknown) => setError(errorText(e)));
        }}
      >
        <p>Die Karte verschwindet sofort aus Feed und Profil. Der gespeicherte Snapshot bleibt im Hintergrund unverändert.</p>
      </ConfirmDialog>
    </>
  );
}
