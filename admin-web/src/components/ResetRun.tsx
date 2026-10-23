import { useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import { Stepper } from "./ResetWizard";
import { cancelResetJob, runResetBatch, sendResetMails, type ResetJob, type ResetMailRun, type ResetTargetRow } from "../lib/api";
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
    collateral_totals: job.resultCollateral,
    mail: job.mail,
    people: job.targets.map((t) => ({
      role: t.role,
      username: t.username,
      user_hash: t.userHash,
      status: t.status,
      error: t.error,
      preview: t.counts,
      result: t.result,
      email_status: t.emailStatus,
      in_app: t.inApp,
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
  const [mailInfo, setMailInfo] = useState<string | null>(null);
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
  const chosen = job.targets.filter((t) => t.role === "selected");
  const collateral = job.targets.filter((t) => t.role === "collateral");

  function describeMails(run: ResetMailRun): string {
    if (!run.configured) return "Kein Mail-Dienst eingerichtet: keine E-Mails, behaltene Konten haben eine Mitteilung in der App.";
    const base = `E-Mails gesendet: ${run.sent}${run.failed > 0 ? `, abgelehnt: ${run.failed}` : ""}.`;
    return run.message !== null ? `${base} ${run.message}` : base;
  }

  function sendWaiting() {
    setBusy(true);
    setError(null);
    sendResetMails(job.id)
      .then((run) => {
        setMailInfo(describeMails(run));
        onChanged();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"))
      .finally(() => setBusy(false));
  }

  /** Batches until the job is no longer running; each batch is at most 25 people. */
  async function run() {
    setRunning(true);
    setError(null);
    try {
      for (;;) {
        if (!alive.current) return;
        const result = await runResetBatch(job.id);
        onChanged();
        if (result.mail !== null) setMailInfo(describeMails(result.mail));
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
        {(job.status === "done" || job.status === "failed") && (
          <div>
            <p className="numeric">
              Benachrichtigung: {job.mail.sent} E-Mails gesendet · {job.mail.pending} warten · {job.mail.failed} fehlgeschlagen ·{" "}
              {job.mail.notConfigured} ohne Mail-Dienst · {job.mail.inApp} Mitteilungen in der App
            </p>
            {job.mail.pending > 0 && (
              <div className="action-row">
                <button type="button" className="button" disabled={busy || running} onClick={sendWaiting}>
                  Offene Mails senden ({job.mail.pending})
                </button>
              </div>
            )}
            <p className="muted">
              Adressen werden erst auf dem Server gelesen und nach dem Versand gelöscht, spätestens nach 7 Tagen. Hier erscheinen keine
              Adressen.
            </p>
          </div>
        )}
        {mailInfo !== null && <p>{mailInfo}</p>}
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

          <h3>Ausgewählte Personen</h3>
          <PeopleTable rows={chosen} />
          <h3>Mitbetroffene Konten ({collateral.length})</h3>
          {collateral.length === 0 ? (
            <p className="muted">Niemand ausserhalb der Auswahl hat eine Unterhaltung verloren.</p>
          ) : (
            <PeopleTable rows={collateral} />
          )}
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

/** Per person: state, numbers (dry run and removed), mail and in-app notice; never addresses. */
function PeopleTable({ rows }: { rows: ResetTargetRow[] }) {
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>Nutzer</th>
          <th>Status</th>
          <th className="numeric">Vorschau</th>
          <th className="numeric">Gelöscht</th>
          <th>Fehler</th>
          <th>E-Mail</th>
          <th>In der App</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.targetId}>
            <td>{t.username !== null ? `@${t.username}` : <span className="muted">Gelöschtes Konto · {t.userHash}</span>}</td>
            <td>{TARGET_STATUS_LABELS[t.status] ?? t.status}</td>
            <td className="numeric">{countsTotal(t.counts)}</td>
            <td className="numeric">{t.status === "done" ? countsTotal(t.result) : "–"}</td>
            <td>{t.error ?? ""}</td>
            <td>{EMAIL_STATUS_LABELS[t.emailStatus] ?? t.emailStatus}</td>
            <td>{t.inApp ? "Ja" : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
