import { useCallback, useEffect, useState, type FormEvent } from "react";

import { fetchAuditLog, type AuditRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import { href } from "../lib/router";

const ACTIONS = [
  "remove_content", "quarantine_content", "restore_content", "warn_user", "suspend_user", "ban_user",
  "unban_user", "resolve_report", "view_report", "view_user", "view_email",
];

/** Read-only audit log (admins). */
export function AuditPage() {
  const { state } = useAuth();
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAuditLog(applied, action, offset)
      .then((result) => {
        setError(null);
        setRows(result);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, [applied, action, offset]);

  useEffect(load, [load]);

  if (state.step !== "ready" || state.role !== "admin") return <p className="error">Nur für Admins.</p>;

  function submit(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setApplied(query.trim().slice(0, 100));
  }

  return (
    <>
      <h1>Audit-Log</h1>
      <form className="filters" onSubmit={submit}>
        <label className="grow">
          Suche (Begründung, Aktion, Username)
          <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} />
        </label>
        <label>
          Aktion
          <select value={action ?? ""} onChange={(e) => { setOffset(0); setAction(e.target.value === "" ? null : e.target.value); }}>
            <option value="">Alle</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button type="submit" className="button primary">Suchen</button>
      </form>
      {error !== null && <p className="error">{error}</p>}
      {rows !== null && (
        <table className="table">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Wer</th>
              <th>Aktion</th>
              <th>Ziel</th>
              <th>Begründung</th>
              <th>Nachricht an Nutzer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.createdAt)}</td>
                <td>{row.actorUsername !== null ? `@${row.actorUsername}` : "–"}</td>
                <td><code>{row.action}</code></td>
                <td>
                  {row.targetUserId !== null ? <a href={href({ page: "user", id: row.targetUserId })}>{row.targetType ?? "Konto"}</a> : (row.targetType ?? "–")}
                </td>
                <td className="user-text">{row.reason}</td>
                <td className="user-text">{row.userMessage ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pager">
        <button type="button" className="button small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Zurück</button>
        <button type="button" className="button small" disabled={rows === null || rows.length < 100} onClick={() => setOffset(offset + 100)}>Weiter</button>
      </div>
    </>
  );
}
