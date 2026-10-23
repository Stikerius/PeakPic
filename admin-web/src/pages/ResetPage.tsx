import { useCallback, useEffect, useState } from "react";

import { ResetRun } from "../components/ResetRun";
import { ResetWizard } from "../components/ResetWizard";
import { fetchResetJob, fetchResetJobs, fetchResetSettings, type ResetJob, type ResetJobRow, type ResetSettings } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { categoryListText } from "../lib/reset";
import { href, navigate } from "../lib/router";

export const JOB_STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  confirmed: "Bestätigt",
  running: "Läuft",
  done: "Abgeschlossen",
  failed: "Mit Fehlern",
  cancelled: "Abgebrochen",
};

export function scopeText(mode: string, categories: string[]): string {
  return mode === "full" ? "Konten komplett löschen" : `Nur Daten: ${categoryListText(categories)}`;
}

/**
 * "Bereinigung": earlier jobs and a new one (wizard), or one job (#/reset/<id>): a draft of the
 * own continues in the wizard, everything else shows the run and the result.
 */
export function ResetPage({ jobId }: { jobId: string | null }) {
  const [settings, setSettings] = useState<ResetSettings | null>(null);
  const [jobs, setJobs] = useState<ResetJobRow[] | null>(null);
  const [job, setJob] = useState<ResetJob | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchResetSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
    if (jobId === null) {
      fetchResetJobs()
        .then(setJobs)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
    } else {
      fetchResetJob(jobId)
        .then(setJob)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
    }
  }, [jobId]);

  useEffect(load, [load]);

  const fullOff = settings !== null && !settings.allowFullReset;

  return (
    <>
      <h1>Bereinigung</h1>
      {fullOff && (
        <p className="notice">
          Komplettes Löschen von Konten ist ausgeschaltet (<code>app_settings.allow_full_reset = false</code>). Nur das
          Löschen einzelner Datenkategorien ist möglich.
        </p>
      )}
      {error !== null && <p className="error">{error}</p>}

      {jobId !== null && job !== null && settings !== null && (
        <>
          <p>
            <a href={href({ page: "reset" })}>← Alle Aufträge</a>
          </p>
          {job.status === "draft" && job.own ? (
            <ResetWizard settings={settings} job={job} onConfirmed={load} onCancelled={() => navigate({ page: "reset" })} />
          ) : (
            <ResetRun job={job} onChanged={load} />
          )}
        </>
      )}

      {jobId === null && settings !== null && (
        <>
          {creating ? (
            <ResetWizard
              settings={settings}
              job={null}
              onConfirmed={(id) => navigate({ page: "reset-job", id })}
              onCancelled={() => {
                setCreating(false);
                load();
              }}
            />
          ) : (
            <div className="action-row">
              <button type="button" className="button primary" onClick={() => setCreating(true)}>
                Neuer Auftrag
              </button>
            </div>
          )}

          <h2 className="section-title">Frühere Aufträge</h2>
          {jobs !== null && jobs.length === 0 && <p className="muted">Noch keine Aufträge.</p>}
          {jobs !== null && jobs.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Erstellt</th>
                  <th>Umfang</th>
                  <th className="numeric">Personen</th>
                  <th>Status</th>
                  <th>Bestätigt</th>
                  <th>Beendet</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a href={href({ page: "reset-job", id: row.id })}>{formatDateTime(row.createdAt)}</a>
                      {!row.own && <span className="muted"> · anderer Admin</span>}
                    </td>
                    <td>{scopeText(row.mode, row.categories)}</td>
                    <td className="numeric">{row.targets}</td>
                    <td>
                      <span className={row.status === "failed" ? "pill warn" : "pill"}>{JOB_STATUS_LABELS[row.status] ?? row.status}</span>
                    </td>
                    <td>{formatDateTime(row.confirmedAt)}</td>
                    <td>{formatDateTime(row.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
