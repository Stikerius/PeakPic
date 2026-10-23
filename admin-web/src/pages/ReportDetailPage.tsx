import { useCallback, useEffect, useState } from "react";

import { AccountHistory } from "../components/AccountHistory";
import { ActionPanel, type PanelAction } from "../components/ActionPanel";
import { ContentPreview } from "../components/ContentPreview";
import {
  banUser,
  fetchReportDetail,
  fetchUserDetail,
  quarantineContent,
  removeContent,
  resolveReport,
  restoreContent,
  suspendUser,
  warnUser,
  type ContentType,
  type ReportDetail,
  type UserDetail,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { str, strOrNull } from "../lib/decode";
import { ACCOUNT_STATUS_LABELS, REASON_LABELS, STATUS_LABELS, TYPE_LABELS, formatDateTime, label } from "../lib/format";
import { href } from "../lib/router";

const CONTENT_TYPES: readonly string[] = ["post", "story", "comment", "message", "plan", "workout"];

export function ReportDetailPage({ id }: { id: string }) {
  const { state } = useAuth();
  const isAdmin = state.step === "ready" && state.role === "admin";
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [history, setHistory] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchReportDetail(id)
      .then(async (result) => {
        setError(null);
        setDetail(result);
        const userId = strOrNull(result.targetUser?.id);
        setHistory(userId !== null ? await fetchUserDetail(userId) : null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, [id]);

  useEffect(load, [load]);

  if (error !== null) return <p className="error">{error}</p>;
  if (detail === null) return <p className="muted">Lädt …</p>;

  const report = detail.report;
  const targetType = str(report.target_type);
  const targetId = str(report.target_id);
  const targetUserId = strOrNull(detail.targetUser?.id);
  const contentState = strOrNull(detail.content?.moderation_state);
  // A message its sender deleted for everyone: only the snapshots are left, nothing to remove.
  const originalGone = targetType === "message" && detail.content?.original_exists === false;
  const isContent = CONTENT_TYPES.includes(targetType) && !originalGone;
  const contentType = targetType as ContentType;

  const actions: PanelAction[] = [];
  if (isContent) {
    if (contentState !== "removed") {
      actions.push({
        key: "remove",
        label: "Inhalt entfernen",
        danger: true,
        run: ({ reason, userMessage }) => removeContent(contentType, targetId, reason, userMessage, id),
      });
    }
    if (contentState !== "quarantined") {
      actions.push({
        key: "quarantine",
        label: "Quarantäne",
        danger: true,
        noUserMessage: true,
        confirm:
          "Nur für möglicherweise illegale Inhalte: nur Admins sehen sie danach. Nichts wird gelöscht. Vor einer Meldung an Behörden Rechtsrat einholen.",
        run: ({ reason }) => quarantineContent(contentType, targetId, reason, id),
      });
    }
    if (isAdmin && contentState !== null) {
      actions.push({
        key: "restore",
        label: "Wiederherstellen",
        noUserMessage: true,
        confirm: "Der Inhalt wird für alle wieder sichtbar.",
        run: ({ reason }) => restoreContent(contentType, targetId, reason, id),
      });
    }
  }
  if (targetUserId !== null) {
    actions.push({
      key: "warn",
      label: "Verwarnen",
      needsUserMessage: true,
      run: ({ reason, userMessage }) => warnUser(targetUserId, reason, userMessage, id),
    });
    actions.push({
      key: "suspend",
      label: "Sperren bis Datum",
      danger: true,
      needsUntil: true,
      run: ({ reason, userMessage, untilIso }) => suspendUser(targetUserId, untilIso, reason, userMessage, id),
    });
    if (isAdmin) {
      actions.push({
        key: "ban",
        label: "Bannen",
        danger: true,
        confirm: "Das Konto wird dauerhaft gesperrt. Inhalte bleiben erhalten, sind aber für niemanden mehr sichtbar.",
        run: ({ reason, userMessage }) => banUser(targetUserId, reason, userMessage, id),
      });
    }
  }
  actions.push({
    key: "resolve",
    label: "Meldung erledigt",
    noUserMessage: true,
    run: ({ reason }) => resolveReport(id, "resolved", reason),
  });
  actions.push({
    key: "dismiss",
    label: "Meldung abweisen",
    noUserMessage: true,
    run: ({ reason }) => resolveReport(id, "dismissed", reason),
  });

  return (
    <>
      <p><a href={href({ page: "queue" })}>← Warteschlange</a></p>
      <h1>
        {label(TYPE_LABELS, targetType)} gemeldet: {label(REASON_LABELS, str(report.reason))}
      </h1>
      <div className="detail-grid">
        <div>
          <section className="panel">
            <dl className="facts">
              <dt>Status</dt>
              <dd>{label(STATUS_LABELS, str(report.status))}</dd>
              <dt>Eingang</dt>
              <dd>{formatDateTime(strOrNull(report.created_at))}</dd>
              <dt>Gemeldet von</dt>
              <dd>{detail.reporter !== null ? `@${str(detail.reporter.username)}` : "Gelöschtes Konto"}</dd>
              <dt>Betroffen</dt>
              <dd>
                {detail.targetUser !== null && targetUserId !== null ? (
                  <a href={href({ page: "user", id: targetUserId })}>
                    {str(detail.targetUser.display_name)} (@{str(detail.targetUser.username)}) ·{" "}
                    {label(ACCOUNT_STATUS_LABELS, str(detail.targetUser.account_status))}
                  </a>
                ) : (
                  "Gelöschtes Konto"
                )}
              </dd>
              <dt>Weitere Meldungen zum Ziel</dt>
              <dd className="numeric">{detail.otherReports}</dd>
              {strOrNull(report.resolution_note) !== null && (
                <>
                  <dt>Notiz</dt>
                  <dd className="user-text">{str(report.resolution_note)}</dd>
                </>
              )}
            </dl>
            {str(report.details) !== "" && (
              <>
                <h4>Angaben des Melders</h4>
                <p className="user-text">{str(report.details)}</p>
              </>
            )}
          </section>
          {detail.contentHiddenQuarantine ? (
            <section className="panel"><p className="muted">Inhalt in Quarantäne: nur für Admins sichtbar.</p></section>
          ) : detail.content !== null ? (
            <ContentPreview type={targetType} content={detail.content} />
          ) : (
            <section className="panel"><p className="muted">Inhalt nicht mehr vorhanden.</p></section>
          )}
        </div>
        <div>
          <ActionPanel actions={actions} maxDays={isAdmin ? null : 7} onDone={load} />
          {history !== null && <AccountHistory reports={history.reportsAgainst} actions={history.actions} />}
        </div>
      </div>
    </>
  );
}
