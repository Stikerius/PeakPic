import { useState } from "react";

import { fetchLegalUserHistory } from "../lib/api";
import { num, str, strOrNull, type Json } from "../lib/decode";
import { formatDateTime } from "../lib/format";

const DOC_LABELS: Record<string, string> = {
  terms: "Nutzungsbedingungen",
  privacy: "Datenschutzerklärung",
  guidelines: "Community-Richtlinien",
};

const FOLLOWUP_LABELS: Record<string, string> = {
  announced: "Angekündigt",
  notify: "In-App erinnert",
  email: "E-Mail gesendet",
  defer: "Zurückgestellt",
  suspend: "Gesperrt",
};

/** Confirmation history of one account (admins only). Loaded on demand, because every view is logged. */
export function LegalHistory({ userId }: { userId: string }) {
  const [history, setHistory] = useState<{ confirmations: Json[]; followups: Json[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    fetchLegalUserHistory(userId)
      .then((result) => {
        setError(null);
        setHistory(result);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"))
      .finally(() => setLoading(false));
  }

  return (
    <section className="panel">
      <h3>Rechtstexte</h3>
      {history === null ? (
        <button type="button" className="button small" disabled={loading} onClick={load}>
          Bestätigungen anzeigen (wird protokolliert)
        </button>
      ) : (
        <>
          {history.confirmations.length === 0 ? (
            <p className="muted">Keine Bestätigungen.</p>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Text</th>
                  <th>Art</th>
                  <th>Am</th>
                  <th>App-Version</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {history.confirmations.map((row, index) => (
                  <tr key={index}>
                    <td>
                      {DOC_LABELS[str(row.doc_type)] ?? str(row.doc_type)} v{num(row.version)}
                    </td>
                    <td>{str(row.confirmation_type) === "accept" ? "Akzeptiert" : "Zur Kenntnis genommen"}</td>
                    <td>{formatDateTime(strOrNull(row.confirmed_at))}</td>
                    <td>{strOrNull(row.app_version) ?? "–"}</td>
                    <td>
                      <code title={str(row.content_hash)}>{str(row.content_hash).slice(0, 12)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {history.followups.length > 0 && (
            <>
              <h4>Offene Nachverfolgung</h4>
              <ul className="plain-list">
                {history.followups.map((row, index) => (
                  <li key={index}>
                    {DOC_LABELS[str(row.doc_type)] ?? str(row.doc_type)} v{num(row.version)}:{" "}
                    {FOLLOWUP_LABELS[str(row.last_action)] ?? str(row.last_action)} am {formatDateTime(strOrNull(row.last_action_at))},{" "}
                    {num(row.action_count)} Aktionen, nächste Prüfung {formatDateTime(strOrNull(row.next_review_at))}
                    {strOrNull(row.note) !== null && <div className="muted user-text">{str(row.note)}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {error !== null && <p className="error">{error}</p>}
    </section>
  );
}
