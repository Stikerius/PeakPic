import { useCallback, useEffect, useState } from "react";

import { AccountHistory } from "../components/AccountHistory";
import { ActionPanel, type PanelAction } from "../components/ActionPanel";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LegalHistory } from "../components/LegalHistory";
import { banUser, fetchUserDetail, fetchUserEmail, suspendUser, unbanUser, warnUser, type UserDetail } from "../lib/api";
import { useAuth } from "../lib/auth";
import { str, strOrNull } from "../lib/decode";
import { ACCOUNT_STATUS_LABELS, formatDateTime, label } from "../lib/format";
import { href } from "../lib/router";

export function UserDetailPage({ id }: { id: string }) {
  const { state } = useAuth();
  const isAdmin = state.step === "ready" && state.role === "admin";
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailReason, setEmailReason] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchUserDetail(id)
      .then((result) => {
        setError(null);
        setDetail(result);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, [id]);

  useEffect(load, [load]);

  if (error !== null) return <p className="error">{error}</p>;
  if (detail === null) return <p className="muted">Lädt …</p>;

  const profile = detail.profile;
  const status = str(profile.account_status);
  const staffRole = strOrNull(profile.staff_role);

  const actions: PanelAction[] =
    staffRole !== null
      ? []
      : [
          {
            key: "warn",
            label: "Verwarnen",
            needsUserMessage: true,
            run: ({ reason, userMessage }) => warnUser(id, reason, userMessage, null),
          },
          {
            key: "suspend",
            label: "Sperren bis Datum",
            danger: true,
            needsUntil: true,
            run: ({ reason, userMessage, untilIso }) => suspendUser(id, untilIso, reason, userMessage, null),
          },
          ...(isAdmin
            ? [
                {
                  key: "ban",
                  label: "Bannen",
                  danger: true,
                  confirm: "Das Konto wird dauerhaft gesperrt.",
                  run: ({ reason, userMessage }: { reason: string; userMessage: string }) => banUser(id, reason, userMessage, null),
                },
                ...(status === "suspended" || status === "banned"
                  ? [
                      {
                        key: "unban",
                        label: "Sperre aufheben",
                        noUserMessage: true,
                        confirm: "Das Konto wird wieder aktiv und sichtbar.",
                        run: ({ reason }: { reason: string }) => unbanUser(id, reason),
                      },
                    ]
                  : []),
              ]
            : []),
        ];

  return (
    <>
      <p><a href={href({ page: "users" })}>← Nutzer</a></p>
      <h1>
        {str(profile.display_name)} <span className="muted">@{str(profile.username)}</span>
      </h1>
      <div className="detail-grid">
        <div>
          <section className="panel">
            <dl className="facts">
              <dt>ID</dt>
              <dd><code>{str(profile.id)}</code></dd>
              <dt>Status</dt>
              <dd>
                {label(ACCOUNT_STATUS_LABELS, status)}
                {strOrNull(profile.suspended_until) !== null && ` bis ${formatDateTime(strOrNull(profile.suspended_until))}`}
              </dd>
              {strOrNull(profile.moderation_message) !== null && (
                <>
                  <dt>Text an den Nutzer</dt>
                  <dd className="user-text">{str(profile.moderation_message)}</dd>
                </>
              )}
              <dt>Konto seit</dt>
              <dd>{formatDateTime(strOrNull(profile.created_at))}</dd>
              <dt>Profil</dt>
              <dd>{profile.is_private === true ? "Privat" : "Öffentlich"}</dd>
              <dt>Eigene Meldungen</dt>
              <dd className="numeric">{detail.reportsFiled}</dd>
              {staffRole !== null && (
                <>
                  <dt>Rolle</dt>
                  <dd>{staffRole}</dd>
                </>
              )}
              {isAdmin && (
                <>
                  <dt>E-Mail</dt>
                  <dd>
                    {email !== null ? (
                      email
                    ) : (
                      <button type="button" className="button small" onClick={() => setEmailOpen(true)}>
                        Anzeigen (wird protokolliert)
                      </button>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </section>
          <AccountHistory reports={detail.reportsAgainst} actions={detail.actions} />
          {isAdmin && <LegalHistory userId={id} />}
        </div>
        <div>
          {staffRole !== null ? (
            <section className="panel"><p className="muted">Moderatoren und Admins können nicht moderiert werden.</p></section>
          ) : (
            <ActionPanel actions={actions} maxDays={isAdmin ? null : 7} onDone={load} />
          )}
        </div>
      </div>
      <ConfirmDialog
        open={emailOpen}
        title="E-Mail-Adresse anzeigen"
        confirmLabel="Anzeigen"
        onCancel={() => setEmailOpen(false)}
        onConfirm={() => {
          setEmailError(null);
          fetchUserEmail(id, emailReason)
            .then((address) => {
              setEmail(address);
              setEmailOpen(false);
            })
            .catch((e: unknown) => setEmailError(e instanceof Error ? e.message : "Fehler"));
        }}
      >
        <p>Der Abruf wird mit Begründung protokolliert.</p>
        <label className="field">
          <span>Begründung (mindestens 10 Zeichen)</span>
          <input value={emailReason} onChange={(e) => setEmailReason(e.target.value)} maxLength={500} />
        </label>
        {emailError !== null && <p className="error">{emailError}</p>}
      </ConfirmDialog>
    </>
  );
}
