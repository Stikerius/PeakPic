import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import { Stepper } from "./ResetWizard";
import { cancelResetJob, runResetBatch, type ResetJob } from "../lib/api";
import { downloadJson, fileStamp } from "../lib/download";
import { formatDateTime } from "../lib/format";
import { categoryLabel, categoryTotal, countsTotal, runActions, CATEGORIES } from "../lib/reset";
import { JOB_STATUS_LABELS, scopeText } from "../pages/ResetPage";

const TARGET_STATUS_LABELS: Record<string, string> = {
  pending: "Offen",
  claimed: "In Arbeit",
  files_pending: "Dateien offen",
  done: "Erledigt",
  failed: "Fehler",
  skipped: "Übersprungen",
};

const EMAIL_STATUS_LABELS: Record<string, string> = {
  none: "–",
  pending: "Wartet",
  sent: "Gesendet",
  failed: "Fehlgeschlagen",
  not_configured: "Kein Mail-Anbieter",
  in_app: "In der App",
};

/** The report as a file: numbers, states and mail status; no e-mail addresses. */
function report(job: ResetJob) {
  return {
    job_id: job.id,
    status: job.status,
    scope: scopeText(job.mode, job.categories),
    mode: job.mode,
    categories: job.categories,
    reason: job.reason,
    confirmed_at: job.confirmedAt,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    progress: job.progress,
    preview_totals: job.previewTotals,
    result_totals: job.resultTotals,
    people: job.targets.map((t) => ({
      username: t.username,
      user_hash: t.userHash,
      status: t.status,
      error: t.error,
      preview: t.counts,
      result: t.result,
      email_status: t.emailStatus,
    })),
  };
}

/**
 * Steps 6 and 7: start (or cancel) a confirmed job, follow the batches, continue after an
 * interruption or an error, and the result. Only the creator can start it; others only look.
 */
export function ResetRun({ job, onChanged }: { job: ResetJob; onChanged: () => void }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const actions = runActions(job.status);
  const finished = job.status === "done" || job.status === "cancelled" || (job.status === "failed" && !running);
  const step = job.status === "done" || job.status === "cancelled" ? "result" : "run";
  const progress = job.progress;
  const handled = progress.done + progress.failed + progress.skipped;
  const showCategories = job.mode === "full" ? CATEGORIES.map((c) => c.key) : job.categories;

  /** Batches until the job is no longer running; each batch is at most 25 people. */
  async function run() {
    setRunning(true);
    setError(null);
    try {
      for (;;) {
        if (!alive.current) return;
        const result = await runResetBatch(job.id);
        onChanged();
        if (result.status !== "running") break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      onChanged();
    } finally {
      if (alive.current) setRunning(false);
    }
  }

  function cancel() {
    setBusy(true);
    setError(null);
    cancelResetJob(job.id)
      .then(() => {
        setCancelOpen(false);
        onChanged();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"))
      .finally(() => setBusy(false));
  }

  return (
    <div className="wizard">
      <Stepper current={step} />
      <section className={job.status === "confirmed" ? "panel danger-zone" : "panel"}>
        <h3>
          {step === "run" ? "6. Ausführung" : "7. Ergebnis"}
          <span className={job.status === "failed" ? "pill warn" : "pill"}>{JOB_STATUS_LABELS[job.status] ?? job.status}</span>
        </h3>
        <dl className="facts">
          <dt>Umfang</dt>
          <dd>{scopeText(job.mode, job.categories)}</dd>
          <dt>Begründung</dt>
          <dd className="user-text">{job.reason}</dd>
          <dt>Bestätigt</dt>
          <dd>{formatDateTime(job.confirmedAt)}</dd>
          <dt>Gestartet</dt>
          <dd>{formatDateTime(job.startedAt)}</dd>
          <dt>Beendet</dt>
          <dd>{formatDateTime(job.finishedAt)}</dd>
        </dl>

        <div>
          <progress className="progress" max={Math.max(progress.total, 1)} value={handled} aria-label="Fortschritt" />
          <p className="numeric">
            {handled} von {progress.total} Personen verarbeitet · {progress.done} erledigt · {progress.failed} Fehler · {progress.skipped}{" "}
            übersprungen
            {running && " · läuft …"}
          </p>
        </div>

        {!job.own && <p className="muted">Diesen Auftrag hat ein anderer Admin erstellt. Starten und abbrechen kann nur er.</p>}
        {job.own && (
          <div className="action-row">
            {actions.start && (
              <button type="button" className="button danger" disabled={running} onClick={() => setStartOpen(true)}>
                Jetzt ausführen …
              </button>
            )}
            {actions.resume && (
              <button type="button" className="button primary" disabled={running} onClick={() => void run()}>
                {running ? "Läuft …" : "Fortsetzen"}
              </button>
            )}
            {actions.cancel && (
              <button type="button" className="button" disabled={running} onClick={() => setCancelOpen(true)}>
                Abbrechen
              </button>
            )}
          </div>
        )}
        {job.status === "confirmed" && (
          <p className="muted">Bis zum Start lässt sich der Auftrag abbrechen. Danach läuft er in Batches; nach einem Fehler „Fortsetzen“.</p>
        )}
        {job.status === "running" && !running && (
          <p className="notice">Der Auftrag wurde unterbrochen (Seite geschlossen oder Verbindung weg). „Fortsetzen“ macht dort weiter.</p>
        )}
        {error !== null && <p className="error">{error}</p>}
      </section>

      {(finished || job.status === "running") && (
        <section className="panel">
          <h3>Zahlen je Kategorie</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Kategorie</th>
                <th className="numeric">Vorschau</th>
                <th className="numeric">Gelöscht</th>
              </tr>
            </thead>
            <tbody>
              {showCategories.map((c) => (
                <tr key={c}>
                  <td>{categoryLabel(c)}</td>
                  <td className="numeric">{categoryTotal(job.previewTotals, c)}</td>
                  <td className="numeric">{categoryTotal(job.resultTotals, c)}</td>
                </tr>
              ))}
              <tr className="sum-row">
                <td>Summe</td>
                <td className="numeric">{countsTotal(job.previewTotals)}</td>
                <td className="numeric">{countsTotal(job.resultTotals)}</td>
              </tr>
            </tbody>
          </table>
          {job.status === "running" && <p className="muted">„Gelöscht“ wird am Ende des Auftrags gefüllt.</p>}

          <h3>Personen</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Nutzer</th>
                <th>Status</th>
                <th className="numeric">Vorschau</th>
                <th className="numeric">Gelöscht</th>
                <th>Fehler</th>
                <th>E-Mail</th>
              </tr>
            </thead>
            <tbody>
              {job.targets.map((t) => (
                <tr key={t.targetId}>
                  <td>{t.username !== null ? `@${t.username}` : <span className="muted">Gelöschtes Konto · {t.userHash}</span>}</td>
                  <td>{TARGET_STATUS_LABELS[t.status] ?? t.status}</td>
                  <td className="numeric">{countsTotal(t.counts)}</td>
                  <td className="numeric">{t.status === "done" ? countsTotal(t.result) : "–"}</td>
                  <td>{t.error ?? ""}</td>
                  <td>{EMAIL_STATUS_LABELS[t.emailStatus] ?? t.emailStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="action-row">
            <button type="button" className="button" onClick={() => downloadJson(`peakpic-bereinigung-${fileStamp()}.json`, report(job))}>
              Bericht als JSON herunterladen
            </button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={startOpen}
        title={`Auftrag für ${progress.total} Personen ausführen?`}
        confirmLabel="Jetzt ausführen"
        danger
        onConfirm={() => {
          setStartOpen(false);
          void run();
        }}
        onCancel={() => setStartOpen(false)}
      >
        <p>
          {job.mode === "full"
            ? `${progress.total} Konten werden mit allen Daten und Dateien endgültig gelöscht.`
            : `Bei ${progress.total} Personen werden gelöscht: ${job.categories.map(categoryLabel).join(", ")}.`}{" "}
          Das lässt sich nicht rückgängig machen. Die Seite bitte offen lassen, bis der Auftrag fertig ist.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Auftrag abbrechen?"
        confirmLabel="Auftrag abbrechen"
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setCancelOpen(false)}
      >
        <p>Der Auftrag wird nicht ausgeführt. Gelöscht wurde noch nichts.</p>
        {error !== null && <p className="error">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}
