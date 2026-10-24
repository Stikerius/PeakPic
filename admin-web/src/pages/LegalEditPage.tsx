import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownPreview } from "../components/MarkdownPreview";
import {
  deleteLegalDraft,
  fetchAffectedCount,
  fetchLegalDocumentBody,
  fetchLegalList,
  publishLegalDocument,
  saveLegalDraft,
  type LegalDraft,
} from "../lib/api";
import { diffLines, type DiffLine } from "../lib/diff";
import { href, navigate } from "../lib/router";
import { LEGAL_LABELS } from "./LegalPage";
import { PageHeader, Skeleton } from "../components/ui";

type View = "edit" | "preview" | "diff";

/** Draft editor (Markdown, preview, diff to the previous version) and publishing. Admins only. */
export function LegalEditPage({ id }: { id: string }) {
  const [draft, setDraft] = useState<LegalDraft | null>(null);
  const [status, setStatus] = useState<string>("draft");
  const [version, setVersion] = useState(0);
  const [previousBody, setPreviousBody] = useState<string | null>(null);
  const [view, setView] = useState<View>("edit");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [affected, setAffected] = useState<number | null>(null);

  const load = useCallback(() => {
    fetchLegalDocumentBody(id)
      .then(async (result) => {
        setError(null);
        setDraft(result.draft);
        setStatus(result.status);
        setVersion(result.version);
        const list = await fetchLegalList();
        const previous = list
          .filter((row) => row.docType === result.draft.docType && row.status !== "draft" && row.version < result.version)
          .sort((a, b) => b.version - a.version)[0];
        setPreviousBody(previous !== undefined ? (await fetchLegalDocumentBody(previous.id)).draft.bodyMd : null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, [id]);

  useEffect(load, [load]);

  if (error !== null && draft === null) return <p className="error">{error}</p>;
  if (draft === null) return <Skeleton lines={8} label="Rechtstext lädt" />;

  const editable = status === "draft";
  const current = draft;
  const diff: DiffLine[] = previousBody !== null ? diffLines(previousBody, current.bodyMd) : [];

  function update(change: Partial<LegalDraft>) {
    setDraft({ ...current, ...change });
    setMessage(null);
  }

  function validate(): string | null {
    if (current.title.trim() === "") return "Titel fehlt.";
    if (current.bodyMd.trim() === "") return "Text fehlt.";
    if (!Number.isInteger(current.graceDays) || current.graceDays < 0 || current.graceDays > 60) return "Frist: 0 bis 60 Tage.";
    return null;
  }

  async function save(): Promise<boolean> {
    const problem = validate();
    if (problem !== null) {
      setError(problem);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      await saveLegalDraft(current);
      setMessage("Entwurf gespeichert.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function openPublish() {
    if (!(await save())) return;
    setReason("");
    setAffected(null);
    setPublishOpen(true);
    fetchAffectedCount()
      .then(setAffected)
      .catch(() => setAffected(null));
  }

  async function publish() {
    if (reason.trim().length < 10) {
      setError("Begründung: mindestens 10 Zeichen.");
      return;
    }
    setSaving(true);
    try {
      const notified = await publishLegalDocument(current.id ?? id, reason.trim());
      setPublishOpen(false);
      setMessage(`Veröffentlicht. ${notified} Konten wurden in der App benachrichtigt.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (reason.trim().length < 10) {
      setError("Begründung: mindestens 10 Zeichen.");
      return;
    }
    setSaving(true);
    try {
      await deleteLegalDraft(current.id ?? id, reason.trim());
      navigate({ page: "legal" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: href({ page: "legal" }), label: "Rechtstexte" }}
        title={
          <>
            {LEGAL_LABELS[current.docType]} · Version {version}{" "}
            <span className="pill">{status === "draft" ? "Entwurf" : status === "published" ? "Veröffentlicht" : "Archiviert"}</span>
          </>
        }
      />
      {!editable && <p className="muted">Veröffentlichte Versionen lassen sich nicht ändern. Für Korrekturen einen neuen Entwurf anlegen.</p>}
      <div className="detail-grid">
        <div>
          <div className="action-row tabs">
            {(["edit", "preview", "diff"] as View[]).map((option) => (
              <button
                key={option}
                type="button"
                className={view === option ? "button small primary" : "button small"}
                onClick={() => setView(option)}
              >
                {option === "edit" ? (editable ? "Bearbeiten" : "Text") : option === "preview" ? "Vorschau" : "Änderungen zur Vorversion"}
              </button>
            ))}
          </div>
          <section className="panel">
            {view === "edit" && (
              <textarea
                className="editor"
                value={current.bodyMd}
                onChange={(e) => update({ bodyMd: e.target.value })}
                readOnly={!editable}
                rows={30}
                maxLength={200000}
                spellCheck
                aria-label="Text (Markdown)"
              />
            )}
            {view === "preview" && <MarkdownPreview source={current.bodyMd} />}
            {view === "diff" &&
              (previousBody === null ? (
                <p className="muted">Keine Vorversion.</p>
              ) : (
                <pre className="diff">
                  {diff.map((line, index) => (
                    <div key={index} className={`diff-${line.kind}`}>
                      {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
                      {line.text}
                    </div>
                  ))}
                </pre>
              ))}
          </section>
        </div>
        <div>
          <section className="panel">
            <label className="field">
              <span>Titel</span>
              <input value={current.title} onChange={(e) => update({ title: e.target.value })} readOnly={!editable} maxLength={120} />
            </label>
            <label className="field">
              <span>Was hat sich geändert (für Nutzer, kurz)</span>
              <textarea
                value={current.changeSummary}
                onChange={(e) => update({ changeSummary: e.target.value })}
                readOnly={!editable}
                rows={4}
                maxLength={2000}
              />
            </label>
            <label className="field">
              <span>Art der Bestätigung</span>
              <select
                value={current.confirmationType}
                onChange={(e) => update({ confirmationType: e.target.value === "accept" ? "accept" : "acknowledge" })}
                disabled={!editable}
              >
                <option value="accept">Akzeptieren (Nutzungsbedingungen)</option>
                <option value="acknowledge">Zur Kenntnis nehmen (Datenschutz, Richtlinien)</option>
              </select>
            </label>
            <label className="field inline">
              <input
                type="checkbox"
                checked={current.requiresConfirmation}
                onChange={(e) => update({ requiresConfirmation: e.target.checked })}
                disabled={!editable}
              />
              <span>Bestätigung verlangen</span>
            </label>
            <label className="field inline">
              <input type="checkbox" checked={current.blocking} onChange={(e) => update({ blocking: e.target.checked })} disabled={!editable} />
              <span>Blockierend (kein „Später“)</span>
            </label>
            <label className="field inline">
              <span>Frist bis zur ersten Erinnerung (Tage)</span>
              <input
                type="number"
                min={0}
                max={60}
                value={current.graceDays}
                onChange={(e) => update({ graceDays: Number(e.target.value) })}
                readOnly={!editable}
              />
            </label>
            {error !== null && <p className="error" role="alert">{error}</p>}
            {message !== null && <p className="success" role="status">{message}</p>}
            {editable && (
              <div className="action-row">
                <button type="button" className="button" disabled={saving} onClick={() => void save()}>
                  Entwurf speichern
                </button>
                <button type="button" className="button primary" disabled={saving} onClick={() => void openPublish()}>
                  Veröffentlichen …
                </button>
                <button
                  type="button"
                  className="button danger"
                  disabled={saving}
                  onClick={() => {
                    setReason("");
                    setDeleteOpen(true);
                  }}
                >
                  Entwurf löschen
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={publishOpen}
        title={`${LEGAL_LABELS[current.docType]} Version ${version} veröffentlichen`}
        confirmLabel="Veröffentlichen"
        busy={saving}
        onConfirm={() => void publish()}
        onCancel={() => setPublishOpen(false)}
      >
        <p>
          Betroffene aktive Konten: <strong>{affected ?? "…"}</strong>. Neue Registrierungen verlangen diese Version sofort.
        </p>
        <p>
          Bestätigung verlangen: <strong>{current.requiresConfirmation ? "ja" : "nein"}</strong> · Blockierend:{" "}
          <strong>{current.blocking ? "ja (kein „Später“)" : "nein"}</strong> · Art:{" "}
          <strong>{current.confirmationType === "accept" ? "Akzeptieren" : "Zur Kenntnis nehmen"}</strong>
        </p>
        <p>Gelten diese Einstellungen so? Danach ist die Version unveränderlich, und alle betroffenen Konten werden in der App benachrichtigt.</p>
        <label className="field">
          <span>Begründung (mindestens 10 Zeichen)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={deleteOpen}
        title="Entwurf löschen"
        confirmLabel="Löschen"
        danger
        busy={saving}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      >
        <label className="field">
          <span>Begründung (mindestens 10 Zeichen)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      </ConfirmDialog>
    </>
  );
}
