import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  fetchEmailConfigured,
  fetchPendingConfirmations,
  legalBulkNotify,
  legalFollowup,
  legalSuspend,
  sendLegalEmails,
  type PendingRow,
} from "../lib/api";
import { formatDateTime } from "../lib/format";
import { href } from "../lib/router";
import { LEGAL_LABELS } from "./LegalPage";

type RowAction =
  | { kind: "suspend"; row: PendingRow }
  | { kind: "defer"; row: PendingRow }
  | { kind: "bulk-notify"; rows: PendingRow[] }
  | { kind: "bulk-email"; rows: PendingRow[] };

const ACTION_LABELS: Record<string, string> = {
  notify: "In-App erinnert",
  email: "E-Mail gesendet",
  defer: "Zurückgestellt",
  suspend: "Gesperrt",
};

const key = (row: PendingRow) => `${row.userId}:${row.documentId}`;

function groupByDocument(rows: PendingRow[]): Map<string, PendingRow[]> {
  const groups = new Map<string, PendingRow[]>();
  for (const row of rows) groups.set(row.documentId, [...(groups.get(row.documentId) ?? []), row]);
  return groups;
}

/**
 * Active accounts that haven't confirmed a current version and whose review date has come.
 * Every action moves the next review 5 days ahead. Suspending only one by one.
 */
export function PendingPage() {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [email, setEmail] = useState<{ configured: boolean; reason: string | null }>({ configured: false, reason: "Wird geprüft …" });
  const [action, setAction] = useState<RowAction | null>(null);
  const [reason, setReason] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPendingConfirmations(offset)
      .then((result) => {
        setError(null);
        setRows(result);
        setSelected(new Set());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, [offset]);

  useEffect(load, [load]);
  useEffect(() => {
    fetchEmailConfigured()
      .then(setEmail)
      .catch(() => setEmail({ configured: false, reason: "Status unbekannt." }));
  }, []);

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setMessage(await task());
      setAction(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  function notifyOne(row: PendingRow) {
    void run(async () => {
      await legalFollowup(row.userId, row.documentId, "notify", null);
      return `@${row.username}: In-App-Erinnerung gesendet.`;
    });
  }

  function emailRows(list: PendingRow[]) {
    void run(async () => {
      let sent = 0;
      let failed = 0;
      for (const [documentId, group] of groupByDocument(list)) {
        // The Edge Function takes at most 50 recipients per call.
        for (let i = 0; i < group.length; i += 50) {
          const result = await sendLegalEmails(group.slice(i, i + 50).map((r) => r.userId), documentId);
          sent += result.sent;
          failed += result.failed;
        }
      }
      return `E-Mails gesendet: ${sent}${failed > 0 ? `, fehlgeschlagen: ${failed}` : ""}.`;
    });
  }

  function confirmAction() {
    if (action === null) return;
    if (action.kind === "suspend") {
      if (reason.trim().length < 10 || userMessage.trim() === "") {
        setError("Begründung (mindestens 10 Zeichen) und Text an den Nutzer sind Pflicht.");
        return;
      }
      const row = action.row;
      void run(async () => {
        await legalSuspend(row.userId, row.documentId, reason.trim(), userMessage.trim());
        return `@${row.username} gesperrt, bis die Texte bestätigt sind.`;
      });
    } else if (action.kind === "defer") {
      if (reason.trim() === "") {
        setError("Bitte eine Notiz angeben.");
        return;
      }
      const row = action.row;
      void run(async () => {
        await legalFollowup(row.userId, row.documentId, "defer", reason.trim());
        return `@${row.username}: zurückgestellt.`;
      });
    } else if (action.kind === "bulk-notify") {
      const list = action.rows;
      void run(async () => {
        let done = 0;
        for (const [documentId, group] of groupByDocument(list)) done += await legalBulkNotify(group.map((r) => r.userId), documentId);
        return `${done} In-App-Erinnerungen gesendet.`;
      });
    } else {
      emailRows(action.rows);
    }
  }

  const selectedRows = (rows ?? []).filter((row) => selected.has(key(row)));

  function openAction(next: RowAction) {
    setReason("");
    setUserMessage("");
    setError(null);
    setAction(next);
  }

  return (
    <>
      <h1>Offene Bestätigungen</h1>
      <p className="muted">
        Aktive Konten, die die aktuelle Version noch nicht bestätigt haben und deren nächste Prüfung fällig ist. Jede
        Aktion verschiebt die nächste Prüfung um 5 Tage. Gesperrte und gebannte Konten erscheinen hier nicht.
      </p>
      {!email.configured && <p className="muted">E-Mail-Versand nicht verfügbar: {email.reason}</p>}
      <div className="action-row">
        <button
          type="button"
          className="button"
          disabled={selectedRows.length === 0 || busy}
          onClick={() => openAction({ kind: "bulk-notify", rows: selectedRows })}
        >
          In-App erinnern ({selectedRows.length})
        </button>
        <button
          type="button"
          className="button"
          disabled={selectedRows.length === 0 || busy || !email.configured}
          title={email.configured ? undefined : (email.reason ?? undefined)}
          onClick={() => openAction({ kind: "bulk-email", rows: selectedRows })}
        >
          E-Mail senden ({selectedRows.length})
        </button>
      </div>
      {error !== null && action === null && <p className="error">{error}</p>}
      {message !== null && <p className="success">{message}</p>}
      {rows !== null && rows.length === 0 && <p className="muted">Niemand ist überfällig.</p>}
      {rows !== null && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Alle auswählen"
                  checked={selected.size === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(key)) : new Set())}
                />
              </th>
              <th>Nutzer</th>
              <th>Text</th>
              <th className="numeric">Tage seit Ankündigung</th>
              <th className="numeric">Aktionen</th>
              <th>Letzte Aktion</th>
              <th>Fällig seit</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={key(row)}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`@${row.username} auswählen`}
                    checked={selected.has(key(row))}
                    onChange={(e) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(key(row));
                        else next.delete(key(row));
                        return next;
                      })
                    }
                  />
                </td>
                <td>
                  <a href={href({ page: "user", id: row.userId })}>@{row.username}</a>
                </td>
                <td>
                  {LEGAL_LABELS[row.docType]} v{row.version}
                </td>
                <td className="numeric">{row.daysSinceAnnounce}</td>
                <td className="numeric">{row.actionCount}</td>
                <td>
                  {row.lastAction !== null ? `${ACTION_LABELS[row.lastAction] ?? row.lastAction}, ${formatDateTime(row.lastActionAt)}` : "–"}
                  {row.note !== null && <div className="muted user-text">{row.note}</div>}
                </td>
                <td>{formatDateTime(row.dueAt)}</td>
                <td>
                  <div className="action-row">
                    <button type="button" className="button small" disabled={busy} onClick={() => notifyOne(row)}>
                      Erinnern
                    </button>
                    <button
                      type="button"
                      className="button small"
                      disabled={busy || !email.configured}
                      title={email.configured ? undefined : (email.reason ?? undefined)}
                      onClick={() => emailRows([row])}
                    >
                      E-Mail
                    </button>
                    <button type="button" className="button small" disabled={busy} onClick={() => openAction({ kind: "defer", row })}>
                      Zurückstellen
                    </button>
                    <button type="button" className="button small danger" disabled={busy} onClick={() => openAction({ kind: "suspend", row })}>
                      Sperren
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pager">
        <button type="button" className="button small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Zurück</button>
        <button type="button" className="button small" disabled={rows === null || rows.length < 100} onClick={() => setOffset(offset + 100)}>Weiter</button>
      </div>

      <ConfirmDialog
        open={action !== null}
        title={
          action?.kind === "suspend"
            ? `@${action.row.username} sperren`
            : action?.kind === "defer"
              ? `@${action.row.username} zurückstellen`
              : action?.kind === "bulk-notify"
                ? `In-App-Erinnerung an ${action.rows.length} Konten`
                : `E-Mail an ${action?.kind === "bulk-email" ? action.rows.length : 0} Konten`
        }
        confirmLabel={action?.kind === "suspend" ? "Sperren" : action?.kind === "defer" ? "Zurückstellen" : "Senden"}
        danger={action?.kind === "suspend"}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setAction(null)}
      >
        {action?.kind === "suspend" && (
          <>
            <p>Unbefristet, bis die Person die Texte bestätigt (dann wird die Sperre automatisch aufgehoben).</p>
            <label className="field">
              <span>Begründung (intern, mindestens 10 Zeichen)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </label>
            <label className="field">
              <span>Text an den Nutzer</span>
              <textarea value={userMessage} onChange={(e) => setUserMessage(e.target.value)} maxLength={1000} rows={3} />
            </label>
          </>
        )}
        {action?.kind === "defer" && (
          <label className="field">
            <span>Notiz</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
        )}
        {(action?.kind === "bulk-notify" || action?.kind === "bulk-email") && (
          <p>Erinnerung an {action.rows.length} ausgewählte Konten senden? Die nächste Prüfung verschiebt sich jeweils um 5 Tage.</p>
        )}
        {error !== null && <p className="error">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
