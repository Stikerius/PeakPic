import { str, strOrNull, type Json } from "../lib/decode";
import { REASON_LABELS, STATUS_LABELS, TYPE_LABELS, formatDateTime, label } from "../lib/format";
import { href } from "../lib/router";

const ACTION_LABELS: Record<string, string> = {
  remove_content: "Inhalt entfernt",
  quarantine_content: "Quarantäne",
  restore_content: "Wiederhergestellt",
  warn_user: "Verwarnt",
  suspend_user: "Gesperrt",
  ban_user: "Gebannt",
  unban_user: "Entsperrt",
  resolve_report: "Meldung abgeschlossen",
};

export function AccountHistory({ reports, actions }: { reports: Json[]; actions: Json[] }) {
  return (
    <section className="panel" aria-label="Verlauf des Kontos">
      <h3>Verlauf</h3>
      <h4>Aktionen ({actions.length})</h4>
      {actions.length === 0 ? (
        <p className="muted">Keine früheren Aktionen.</p>
      ) : (
        <table className="table compact">
          <tbody>
            {actions.map((a) => (
              <tr key={str(a.id)}>
                <td>{formatDateTime(strOrNull(a.created_at))}</td>
                <td>{label(ACTION_LABELS, str(a.action))}</td>
                <td className="user-text">{str(a.reason)}</td>
                <td className="muted">{strOrNull(a.actor_username) ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>Meldungen gegen das Konto ({reports.length})</h4>
      {reports.length === 0 ? (
        <p className="muted">Keine Meldungen.</p>
      ) : (
        <table className="table compact">
          <tbody>
            {reports.map((r) => (
              <tr key={str(r.id)}>
                <td>
                  <a href={href({ page: "report", id: str(r.id) })}>{formatDateTime(strOrNull(r.created_at))}</a>
                </td>
                <td>{label(TYPE_LABELS, str(r.target_type))}</td>
                <td>{label(REASON_LABELS, str(r.reason))}</td>
                <td>{label(STATUS_LABELS, str(r.status))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
