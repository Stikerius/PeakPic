import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  ADMIN_MAIL_LIMITS,
  attachmentProblem,
  buildAdminMail,
  checkMailContent,
  claimedExtension,
  MAIL_CATEGORIES,
  mailCategoryLabel,
  sanitizeFilename,
  type AttachmentExt,
} from "../lib/adminMail";
import {
  continueMail,
  deleteMailTemplate,
  fetchMailCampaign,
  fetchMailCampaigns,
  fetchMailCandidates,
  fetchMailSettings,
  fetchMailStatus,
  fetchMailTemplates,
  removeMailAttachment,
  saveMailTemplate,
  sendMailCampaign,
  sendTestMail,
  uploadMailAttachment,
  type MailCampaign,
  type MailCampaignRow,
  type MailCandidate,
  type MailRun,
  type MailSettings,
  type MailTemplate,
} from "../lib/api";
import { formatDateTime } from "../lib/format";
import { href } from "../lib/router";
import { EmptyState, PageHeader, Skeleton } from "../components/ui";

const CAMPAIGN_STATUS: Record<string, string> = { sending: "Wird gesendet", waiting: "Wartet", done: "Abgeschlossen" };
const RECIPIENT_STATUS: Record<string, string> = {
  pending: "Wartend",
  claimed: "Wird gesendet",
  sent: "Gesendet",
  failed: "Fehlgeschlagen",
  skipped: "Übersprungen",
};
const REASONS: Record<string, string> = {
  quota: "Kontingent des Mail-Dienstes erreicht",
  rate_limit: "Zu viele Mails auf einmal",
  unavailable: "Mail-Dienst nicht erreichbar",
  config: "Mail-Dienst lehnt ab (Schlüssel oder Domain)",
  not_configured: "Kein Mail-Dienst eingerichtet",
  not_active: "Konto nicht mehr aktiv",
  account_deleted: "Konto gelöscht",
  no_address: "Keine Adresse",
  rejected: "Vom Mail-Dienst abgelehnt",
  attachments_expired: "Anhänge nach 24 Stunden gelöscht",
  expired: "Nach 7 Tagen abgelaufen",
  text_expired: "Text nicht mehr vorhanden",
  attachment_missing: "Anhang fehlt",
  attachment_type_not_allowed: "Anhang nicht erlaubt",
};
const AUDIENCE: Record<string, string> = { single: "Einzelne Person", selected: "Auswahl", all: "Alle aktiven Konten" };
const CONTENT_TYPES: Record<AttachmentExt, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  txt: "text/plain",
};

type Attachment = { name: string; size: number; path: string };
type Audience = "single" | "selected" | "all";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Fehler";
}

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function countsText(c: { sent: number; failed: number; pending: number; skipped: number }): string {
  return [
    `${c.sent} gesendet`,
    c.failed > 0 ? `${c.failed} fehlgeschlagen` : null,
    c.pending > 0 ? `${c.pending} wartend` : null,
    c.skipped > 0 ? `${c.skipped} übersprungen` : null,
  ]
    .filter((x) => x !== null)
    .join(" · ");
}

/** Sends until nothing more fits (time limit) or the provider stops (quota): repeated calls. */
async function sendUntilStopped(first: MailRun): Promise<MailRun> {
  let run = first;
  while (run.more && run.message === null && run.campaignId !== null) {
    const next = await continueMail(run.campaignId);
    run = { ...next, campaignId: run.campaignId };
  }
  return run;
}

/** "Mitteilungen": e-mail notices to people (admins only), the history, or one campaign. */
export function MailPage({ campaignId }: { campaignId: string | null }) {
  return campaignId === null ? <MailOverview /> : <CampaignDetail key={campaignId} id={campaignId} />;
}

function MailOverview() {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [status, setStatus] = useState<{ configured: boolean; reason: string | null } | null>(null);
  const [campaigns, setCampaigns] = useState<MailCampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchMailSettings().then(setSettings).catch((e: unknown) => setError(errorText(e)));
    fetchMailCampaigns().then(setCampaigns).catch((e: unknown) => setError(errorText(e)));
    fetchMailStatus().then(setStatus).catch(() => setStatus({ configured: false, reason: null }));
  }, []);
  useEffect(load, [load]);

  const open = (campaigns ?? []).filter((c) => c.status !== "done");

  async function sendRest() {
    setBusy(true);
    setError(null);
    try {
      let run = await continueMail(null);
      while (run.more && run.message === null) run = await continueMail(null);
      const sent = run.campaigns.reduce((sum, c) => sum + c.sent, 0);
      setNotice(run.message ?? `Fertig. ${sent} Mails insgesamt gesendet in den bearbeiteten Sendungen.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      load();
    }
  }

  return (
    <>
      <PageHeader title="Mitteilungen">Servicemitteilungen per E-Mail an Konten, mit Testmail, Bestätigung und Verlauf.</PageHeader>
      {status !== null && !status.configured && (
        <p className="notice">{status.reason ?? "Kein Mail-Dienst eingerichtet."} Testmails und Versand sind erst danach möglich.</p>
      )}
      {error !== null && <p className="error">{error}</p>}
      {notice !== null && <p className="success">{notice}</p>}

      {settings !== null && (
        <Composer
          settings={settings}
          onSent={(text) => {
            setNotice(text);
            load();
          }}
        />
      )}

      <h2 className="section-title">Verlauf</h2>
      {open.length > 0 && (
        <div className="action-row">
          <button type="button" className="button" disabled={busy} onClick={() => void sendRest()}>
            {busy ? "Wird gesendet …" : `Rest senden (${open.length} offene ${open.length === 1 ? "Sendung" : "Sendungen"})`}
          </button>
          <span className="muted">Einzelnachrichten zuerst, dann die ältesten.</span>
        </div>
      )}
      {campaigns !== null && campaigns.length === 0 && <EmptyState title="Noch keine Sendungen">Neue Mitteilungen erscheinen hier mit Datum, Kategorie und Status.</EmptyState>}
      {campaigns === null && error === null && <Skeleton lines={4} label="Verlauf lädt" />}
      {campaigns !== null && campaigns.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Kategorie</th>
                <th>Betreff</th>
                <th className="numeric">Empfänger</th>
                <th>Ergebnis</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={href({ page: "mail-campaign", id: c.id })}>{formatDateTime(c.createdAt)}</a>
                  </td>
                  <td>{mailCategoryLabel(c.category) ?? c.category}</td>
                  <td>{c.subject}</td>
                  <td className="numeric">{c.recipientCount}</td>
                  <td>{countsText(c.counts)}</td>
                  <td>
                    <span className={c.status === "done" ? "pill" : "pill warn"}>{CAMPAIGN_STATUS[c.status] ?? c.status}</span>
                    {c.stopReason !== null && <span className="muted"> · {REASONS[c.stopReason] ?? c.stopReason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Composer({ settings, onSent }: { settings: MailSettings; onSent: (text: string) => void }) {
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("single");
  const [recipients, setRecipients] = useState<MailCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MailCandidate[] | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [serviceOnly, setServiceOnly] = useState(false);
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [testedKey, setTestedKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedCount, setTypedCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadTemplates = useCallback(() => {
    fetchMailTemplates().then(setTemplates).catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(loadTemplates, [loadTemplates]);

  const checked = checkMailContent(category, subject, body);
  const preview = checked.ok ? buildAdminMail(checked.content, null) : null;
  const paths = attachments.map((a) => a.path);
  // The test must have exactly this content (the database checks the same).
  const contentKey = JSON.stringify({ category, subject: subject.trim(), body, paths });
  const tested = testedKey === contentKey;
  const recipientCount = audience === "all" ? settings.activeAccounts : recipients.length;
  const needsTypedCount = recipientCount > settings.confirmCountAbove;
  const canSend =
    checked.ok &&
    tested &&
    !uploading &&
    recipientCount > 0 &&
    recipientCount <= settings.maxRecipients &&
    (audience !== "all" || serviceOnly);

  const searchMatches = useMemo(
    () => (results ?? []).filter((r) => !recipients.some((x) => x.userId === r.userId)),
    [results, recipients],
  );

  async function search() {
    setError(null);
    try {
      setResults(await fetchMailCandidates(query));
    } catch (e) {
      setError(errorText(e));
    }
  }

  function addRecipient(candidate: MailCandidate) {
    setRecipients((current) => (audience === "single" ? [candidate] : [...current, candidate].slice(0, settings.maxRecipients)));
  }

  async function addFiles(list: FileList | null) {
    if (list === null || list.length === 0) return;
    const files = Array.from(list);
    const problem = attachmentProblem([...attachments, ...files.map((f) => ({ name: f.name, size: f.size }))]);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const file of files) {
        const ext = claimedExtension(file.name) as AttachmentExt;
        let name = sanitizeFilename(file.name, ext);
        const taken = new Set([...attachments, ...added].map((a) => a.name));
        for (let i = 2; taken.has(name); i += 1) name = sanitizeFilename(`${file.name.replace(/\.[^.]*$/, "")}-${i}.${ext}`, ext);
        const path = await uploadMailAttachment(file, draftId, name, CONTENT_TYPES[ext]);
        added.push({ name, size: file.size, path });
      }
      setAttachments((current) => [...current, ...added]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attachment: Attachment) {
    setAttachments((current) => current.filter((a) => a.path !== attachment.path));
    await removeMailAttachment(attachment.path).catch(() => undefined);
  }

  function applyTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    if (template === undefined) {
      setTemplateId(null);
      return;
    }
    setTemplateId(template.id);
    setTemplateName(template.name);
    setCategory(template.category);
    setSubject(template.subject);
    setBody(template.body);
  }

  async function saveTemplate() {
    setError(null);
    try {
      const id = await saveMailTemplate(templateId, templateName, category, subject, body);
      setTemplateId(id);
      setInfo("Vorlage gespeichert.");
      loadTemplates();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function removeTemplate() {
    if (templateId === null) return;
    try {
      await deleteMailTemplate(templateId);
      setTemplateId(null);
      setTemplateName("");
      loadTemplates();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const files = await sendTestMail({ category, subject: subject.trim(), body, attachments: paths });
      setTestedKey(contentKey);
      setInfo(
        `Testmail an deine Adresse gesendet${files.length > 0 ? ` mit ${files.map((f) => f.name).join(", ")}` : ""}. Bitte im Postfach prüfen; der Versand ist 60 Minuten lang freigegeben.`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const first = await sendMailCampaign({
        category,
        subject: subject.trim(),
        body,
        attachments: paths,
        audience,
        userIds: audience === "all" ? [] : recipients.map((r) => r.userId),
        confirmCount: needsTypedCount ? Number(typedCount) : null,
        serviceOnly: audience === "all" && serviceOnly,
        templateId,
      });
      const run = await sendUntilStopped(first);
      const c = run.campaigns[run.campaigns.length - 1];
      setConfirmOpen(false);
      // Start fresh: attachments are deleted by the server once the campaign is done.
      setDraftId(crypto.randomUUID());
      setAttachments([]);
      setRecipients([]);
      setSubject("");
      setBody("");
      setCategory("");
      setTemplateId(null);
      setTestedKey(null);
      setServiceOnly(false);
      setTypedCount("");
      onSent(
        `Sendung erstellt. ${c !== undefined ? countsText(c) : ""}.${run.message !== null ? ` ${run.message} Die übrigen Mails warten; später „Rest senden“.` : ""}`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Neue Mitteilung</h2>
      <div className="filters">
        <label className="grow">
          Vorlage
          <select value={templateId ?? ""} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Keine Vorlage</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Kategorie (Pflicht)</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} required>
          <option value="">Bitte wählen</option>
          {MAIL_CATEGORIES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">Nur Servicemitteilungen. Werbung ist nicht erlaubt und hat keine Kategorie.</p>
      <label className="field">
        <span>
          Betreff ({subject.length}/{ADMIN_MAIL_LIMITS.subjectMax})
        </span>
        <input
          value={subject}
          maxLength={ADMIN_MAIL_LIMITS.subjectMax}
          onChange={(e) => setSubject(e.target.value.replace(/[\r\n]+/g, " "))}
        />
      </label>
      <label className="field">
        <span>
          Text ({body.length}/{ADMIN_MAIL_LIMITS.bodyMax}). Einfacher Text, Absätze mit Leerzeile. HTML wird nicht ausgeführt, sondern als Text
          angezeigt.
        </span>
        <textarea rows={10} value={body} maxLength={ADMIN_MAIL_LIMITS.bodyMax} onChange={(e) => setBody(e.target.value)} />
      </label>

      <div className="filters">
        <label className="grow">
          Name der Vorlage
          <input value={templateName} maxLength={80} onChange={(e) => setTemplateName(e.target.value)} />
        </label>
        <button type="button" className="button" disabled={!checked.ok || templateName.trim() === ""} onClick={() => void saveTemplate()}>
          {templateId === null ? "Als Vorlage speichern" : "Vorlage aktualisieren"}
        </button>
        {templateId !== null && (
          <button type="button" className="button" onClick={() => void removeTemplate()}>
            Vorlage löschen
          </button>
        )}
      </div>
      <p className="muted">Der Text wird nur als Vorlage gespeichert, wenn du das ausdrücklich tust. Sonst bleibt nur sein Hash im Verlauf.</p>

      <h3>Anhänge</h3>
      <p className="muted">
        Bis zu {ADMIN_MAIL_LIMITS.maxFiles} Dateien, zusammen höchstens 5 MB: PDF, PNG, JPG oder TXT. Anhänge werden nicht auf Schadsoftware
        geprüft. Sie werden nach dem Versand gelöscht, spätestens nach 24 Stunden.
      </p>
      {attachments.length > 0 && (
        <ul className="plain-list">
          {attachments.map((a) => (
            <li key={a.path}>
              {a.name} ({sizeText(a.size)}){" "}
              <button type="button" className="button small" onClick={() => void removeAttachment(a)}>
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachments.length < ADMIN_MAIL_LIMITS.maxFiles && (
        <input
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
          disabled={uploading}
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      )}
      {uploading && <p className="muted">Wird hochgeladen …</p>}

      <h3>Empfänger</h3>
      <div className="segmented" role="radiogroup" aria-label="Empfänger">
        {(["single", "selected", "all"] as const).map((a) => (
          <label key={a} className="choice">
            <input
              type="radio"
              name="audience"
              checked={audience === a}
              onChange={() => {
                setAudience(a);
                if (a === "single") setRecipients((current) => current.slice(0, 1));
              }}
            />
            {AUDIENCE[a]}
          </label>
        ))}
      </div>
      {audience !== "all" && (
        <>
          <div className="filters">
            <label className="grow">
              Benutzername oder Name (mindestens 2 Zeichen)
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void search();
                }}
              />
            </label>
            <button type="button" className="button" disabled={query.trim().length < 2} onClick={() => void search()}>
              Suchen
            </button>
          </div>
          <p className="muted">Gesperrte, gebannte und im Löschen befindliche Konten erscheinen nicht.</p>
          {results !== null && searchMatches.length === 0 && <p className="muted">Keine weiteren Treffer.</p>}
          {searchMatches.length > 0 && (
            <ul className="plain-list">
              {searchMatches.map((r) => (
                <li key={r.userId}>
                  @{r.username} · {r.displayName}{" "}
                  <button type="button" className="button small" onClick={() => addRecipient(r)}>
                    {audience === "single" ? "Wählen" : "Hinzufügen"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recipients.length > 0 && (
            <>
              <p>Ausgewählt ({recipients.length}):</p>
              <ul className="plain-list">
                {recipients.map((r) => (
                  <li key={r.userId}>
                    @{r.username}{" "}
                    <button type="button" className="button small" onClick={() => setRecipients((current) => current.filter((x) => x.userId !== r.userId))}>
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {audience === "all" && (
        <>
          <p>An alle aktiven Konten: {settings.activeAccounts}.</p>
          {settings.activeAccounts > settings.maxRecipients && (
            <p className="error">Mehr als {settings.maxRecipients} aktive Konten: Senden an alle ist nicht möglich.</p>
          )}
          <p className="notice">An alle dürfen nur Servicemitteilungen gehen (Konto, Rechtliches, Betrieb), keine Werbung.</p>
          <label className="choice">
            <input type="checkbox" checked={serviceOnly} onChange={(e) => setServiceOnly(e.target.checked)} />
            Ich bestätige: Das ist eine Servicemitteilung und keine Werbung.
          </label>
        </>
      )}

      <h3>Vorschau</h3>
      {preview === null ? (
        <p className="muted">Kategorie, Betreff und Text ausfüllen.</p>
      ) : (
        <div className="mail-preview">
          <p>
            <strong>{preview.subject}</strong>
          </p>
          <p className="user-text">{preview.text}</p>
          {attachments.length > 0 && <p className="muted">Anhänge: {attachments.map((a) => a.name).join(", ")}</p>}
        </div>
      )}
      <p className="muted">
        Absender ist EMAIL_FROM, Antworten gehen an SUPPORT_EMAIL; die Kontaktadresse setzt der Server ein. Keine Links, keine Tracking-Pixel.
      </p>

      {error !== null && <p className="error">{error}</p>}
      {info !== null && <p className="success">{info}</p>}
      <div className="action-row">
        <button type="button" className="button" disabled={!checked.ok || busy || uploading} onClick={() => void test()}>
          Testmail an mich senden
        </button>
        <button type="button" className="button primary" disabled={!canSend || busy} onClick={() => setConfirmOpen(true)}>
          Senden …
        </button>
        {checked.ok && !tested && <span className="muted">Vor dem Senden ist eine Testmail mit genau diesem Inhalt nötig.</span>}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Mitteilung senden?"
        confirmLabel={`An ${recipientCount} senden`}
        busy={busy}
        onConfirm={() => {
          if (needsTypedCount && Number(typedCount) !== recipientCount) {
            setError("Die eingegebene Anzahl stimmt nicht mit der Empfängerzahl überein.");
            return;
          }
          void send();
        }}
        onCancel={() => setConfirmOpen(false)}
      >
        <dl className="facts">
          <dt>Empfänger</dt>
          <dd>
            {recipientCount} ({AUDIENCE[audience]})
          </dd>
          <dt>Betreff</dt>
          <dd>{subject.trim()}</dd>
          <dt>Kategorie</dt>
          <dd>{mailCategoryLabel(category)}</dd>
          <dt>Anhänge</dt>
          <dd>{attachments.length}</dd>
        </dl>
        {needsTypedCount && (
          <label className="field">
            <span>Zur Bestätigung die Anzahl der Empfänger eingeben ({recipientCount})</span>
            <input inputMode="numeric" value={typedCount} onChange={(e) => setTypedCount(e.target.value.replace(/\D/g, ""))} />
          </label>
        )}
        {error !== null && <p className="error">{error}</p>}
      </ConfirmDialog>
    </section>
  );
}

function CampaignDetail({ id }: { id: string }) {
  const [campaign, setCampaign] = useState<MailCampaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchMailCampaign(id).then(setCampaign).catch((e: unknown) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  async function sendRest() {
    setBusy(true);
    setError(null);
    try {
      const run = await sendUntilStopped({ ...(await continueMail(id)), campaignId: id });
      setNotice(run.message ?? "Fertig gesendet.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      load();
    }
  }

  return (
    <>
      <PageHeader title="Sendung" back={{ href: href({ page: "mail" }), label: "Alle Mitteilungen" }} />
      {error !== null && <p className="error">{error}</p>}
      {notice !== null && <p className="success">{notice}</p>}
      {campaign !== null && (
        <>
          <section className="panel">
            <dl className="facts">
              <dt>Erstellt</dt>
              <dd>{formatDateTime(campaign.createdAt)}</dd>
              <dt>Kategorie</dt>
              <dd>{mailCategoryLabel(campaign.category) ?? campaign.category}</dd>
              <dt>Empfänger</dt>
              <dd>
                {campaign.recipientCount} ({AUDIENCE[campaign.audience] ?? campaign.audience})
              </dd>
              <dt>Betreff</dt>
              <dd>{campaign.subject}</dd>
              <dt>Anhänge</dt>
              <dd>{campaign.attachmentCount}</dd>
              <dt>Ergebnis</dt>
              <dd>{countsText(campaign.counts)}</dd>
              <dt>Status</dt>
              <dd>
                {CAMPAIGN_STATUS[campaign.status] ?? campaign.status}
                {campaign.stopReason !== null && ` · ${REASONS[campaign.stopReason] ?? campaign.stopReason}`}
              </dd>
              <dt>Beendet</dt>
              <dd>{formatDateTime(campaign.finishedAt)}</dd>
              <dt>Hash des Texts</dt>
              <dd>
                <code>{campaign.bodyHash.slice(0, 16)}…</code>
              </dd>
            </dl>
            {campaign.status !== "done" && (
              <div className="action-row">
                <button type="button" className="button primary" disabled={busy} onClick={() => void sendRest()}>
                  {busy ? "Wird gesendet …" : "Rest senden"}
                </button>
              </div>
            )}
            <p className="muted">Der Text selbst wird nach dem Versand nicht aufbewahrt. Adressen werden nie angezeigt.</p>
          </section>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Status</th>
                  <th>Grund</th>
                  <th>Gesendet</th>
                </tr>
              </thead>
              <tbody>
                {campaign.recipients.map((r, index) => (
                  <tr key={`${r.username ?? "deleted"}-${index}`}>
                    <td>{r.username !== null ? `@${r.username}` : <span className="muted">Gelöschtes Konto</span>}</td>
                    <td>{RECIPIENT_STATUS[r.status] ?? r.status}</td>
                    <td>{r.error !== null ? (REASONS[r.error] ?? r.error) : ""}</td>
                    <td>{formatDateTime(r.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
