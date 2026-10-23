import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import {
  cancelResetJob,
  confirmResetJob,
  createResetJob,
  exportResetJob,
  fetchResetCandidates,
  previewResetJob,
  setResetTargets,
  updateResetJob,
  verifyTotpAgain,
  type ResetJob,
  type ResetJobDraft,
  type ResetSettings,
} from "../lib/api";
import { downloadJson, fileStamp } from "../lib/download";
import { ACCOUNT_STATUS_LABELS, formatDateTime, label } from "../lib/format";
import {
  blockerFor,
  CATEGORIES,
  categoryLabel,
  categoryTotal,
  COUNT_LABELS,
  countsTotal,
  DEFAULT_MESSAGE,
  DEFAULT_SUBJECT,
  FLAG_LABELS,
  isFlagged,
  MAX_TARGETS,
  MESSAGE_MAX,
  nextStep,
  PHRASE,
  previousStep,
  pruneSelection,
  REASON_MAX,
  renderMessage,
  selectAllExceptProtected,
  selectability,
  stepForJob,
  SUBJECT_MAX,
  sumCounts,
  toggleSelection,
  WIZARD_STEPS,
  type Candidate,
  type Counts,
  type ResetMode,
  type WizardStep,
} from "../lib/reset";

type PreviewRow = { key: string; username: string; displayName: string; flagged: boolean; counts: Counts };
type Preview = { totals: Counts; files: number; rows: PreviewRow[]; raw: unknown };

type Dialog =
  | { kind: "flag-one"; candidate: Candidate }
  | { kind: "select-all"; count: number; flaggedIncluded: boolean }
  | { kind: "discard" }
  | { kind: "confirm" };

type ListFilter = "all" | "unflagged" | "flagged" | "selected";

function LockIcon() {
  return (
    <svg className="lock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The steps of the wizard, numbered, with the current one marked. */
export function Stepper({ current }: { current: WizardStep }) {
  const index = WIZARD_STEPS.findIndex((s) => s.step === current);
  return (
    <ol className="stepper" aria-label="Schritte">
      {WIZARD_STEPS.map((s, i) => (
        <li key={s.step} className={i === index ? "current" : i < index ? "done" : undefined} aria-current={i === index ? "step" : undefined}>
          <span className="numeric">{i + 1}</span> {s.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Steps 1-5 of a reset job: scope, people, dry run, reason and mail text, backup and
 * confirmation. The job is saved as a draft from the dry run on; until it is confirmed every
 * step can go back. Nothing is deleted here.
 */
export function ResetWizard({
  settings,
  job,
  onConfirmed,
  onCancelled,
}: {
  settings: ResetSettings;
  job: ResetJob | null;
  onConfirmed: (jobId: string) => void;
  onCancelled: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(job?.id ?? null);
  const [step, setStep] = useState<WizardStep>(() =>
    job === null ? "scope" : stepForJob(job.status, job.previewedAt !== null && job.previewedAt >= job.updatedAt),
  );
  const [mode, setMode] = useState<ResetMode | null>(job?.mode ?? null);
  const [categories, setCategories] = useState<string[]>(job?.mode === "categories" ? job.categories : []);
  const [includeFlagged, setIncludeFlagged] = useState(job?.includeFlagged ?? false);
  const [picked, setSelected] = useState<ReadonlySet<string>>(
    () => new Set((job?.targets ?? []).flatMap((t) => (t.userId === null ? [] : [t.userId]))),
  );
  const [known, setKnown] = useState<ReadonlyMap<string, Candidate>>(new Map());
  // A choice made invalid later (other mode) is dropped from what counts.
  const selected = useMemo(
    () => (mode === null ? picked : pruneSelection(picked, known, mode, includeFlagged)),
    [picked, known, mode, includeFlagged],
  );
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [preview, setPreview] = useState<Preview | null>(() =>
    job !== null && job.previewedAt !== null && job.previewedAt >= job.updatedAt
      ? {
          totals: job.previewTotals,
          files: job.previewFiles,
          rows: job.targets.map((t) => ({
            key: t.targetId,
            username: t.username ?? "",
            displayName: t.displayName ?? "",
            flagged: t.flagged,
            counts: t.counts,
          })),
          raw: { job_id: job.id, totals: job.previewTotals, files: job.previewFiles, targets: job.targets },
        }
      : null,
  );
  const [reason, setReason] = useState(job?.reason ?? "");
  const [subject, setSubject] = useState(job?.subject || DEFAULT_SUBJECT);
  const [message, setMessage] = useState(job?.userMessage || DEFAULT_MESSAGE);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [exported, setExported] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: ResetJobDraft = {
    mode: mode ?? "categories",
    categories,
    reason: reason.trim(),
    subject: subject.trim(),
    userMessage: message.trim(),
  };
  const input = {
    mode,
    categories,
    allowFull: settings.allowFullReset,
    selectedCount: selected.size,
    previewFresh: preview !== null,
    reason,
    subject,
    message,
    backupConfirmed,
    phrase,
    totpCode,
  };
  const blocker = blockerFor(step, input);

  // People: loaded on the people step (and once for an existing draft, to know who is flagged).
  function search(text: string) {
    fetchResetCandidates(text)
      .then((list) => {
        setCandidates(list);
        setKnown((current) => new Map([...current, ...list.map((c) => [c.userId, c] as const)]));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }

  useEffect(() => {
    if (step === "users" && candidates === null) search("");
  }, [step, candidates]);


  async function task(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  /** Saves the draft (scope, people), runs the dry run and shows it. */
  function runPreview() {
    void task(async () => {
      let id = jobId;
      if (id === null) {
        id = await createResetJob(draft);
        setJobId(id);
      } else {
        await updateResetJob(id, draft);
      }
      await setResetTargets(id, [...selected], includeFlagged);
      const result = await previewResetJob(id);
      setPreview({
        totals: result.totals,
        files: result.files,
        rows: result.targets.map((t) => ({ key: t.targetId, username: t.username, displayName: t.displayName, flagged: t.flagged, counts: t.counts })),
        raw: result.raw,
      });
      setStep("preview");
    });
  }

  function goNext() {
    if (blocker !== null) return;
    if (step === "users") {
      runPreview();
      return;
    }
    if (step === "message" && jobId !== null) {
      // Same scope: the dry run stays valid.
      void task(async () => {
        await updateResetJob(jobId, draft);
        setStep("confirm");
      });
      return;
    }
    const next = nextStep(step);
    if (next !== null) setStep(next);
  }

  function goBack() {
    const previous = previousStep(step, jobId === null ? null : "draft");
    if (previous !== null) setStep(previous);
  }

  function changeScope(update: () => void) {
    update();
    setPreview(null);
  }

  function exportBackup() {
    if (jobId === null) return;
    void task(async () => {
      await updateResetJob(jobId, draft);
      const data = await exportResetJob(jobId);
      downloadJson(`peakpic-sicherung-${fileStamp()}.json`, data);
      setExported(true);
    });
  }

  function confirmJob() {
    if (jobId === null) return;
    void task(async () => {
      await verifyTotpAgain(totpCode);
      await confirmResetJob(jobId, phrase);
      setDialog(null);
      onConfirmed(jobId);
    });
  }

  function discard() {
    void task(async () => {
      if (jobId !== null) await cancelResetJob(jobId);
      setDialog(null);
      onCancelled();
    });
  }

  function tick(candidate: Candidate) {
    if (mode === null) return;
    const state = selectability(candidate, mode, includeFlagged);
    if (state.kind === "needs-flag-confirmation" && !selected.has(candidate.userId)) {
      setDialog({ kind: "flag-one", candidate });
      return;
    }
    setSelected((current) => toggleSelection(current, candidate, mode, includeFlagged));
    setPreview(null);
  }

  const visible = useMemo(() => {
    const list = candidates ?? [];
    switch (filter) {
      case "unflagged":
        return list.filter((c) => !isFlagged(c));
      case "flagged":
        return list.filter(isFlagged);
      case "selected":
        return [...selected].flatMap((id) => {
          const c = known.get(id);
          return c === undefined ? [] : [c];
        });
      case "all":
        return list;
    }
  }, [candidates, filter, selected, known]);

  const selectedFlagged = [...selected].filter((id) => {
    const c = known.get(id);
    return c !== undefined && isFlagged(c);
  }).length;
  const categoriesShown = mode === "full" ? CATEGORIES.map((c) => c.key) : categories;
  const mailText = renderMessage(message, { categories, reason, mode: mode ?? "categories" });

  return (
    <div className="wizard">
      <Stepper current={step} />

      {step === "scope" && (
        <section className="panel">
          <h3>1. Umfang</h3>
          <label className="choice">
            <input
              type="radio"
              name="mode"
              checked={mode === "categories"}
              onChange={() => changeScope(() => setMode("categories"))}
            />
            <span>
              <strong>Nur Daten löschen</strong>
              <span className="muted"> Konten bleiben, ausgewählte Kategorien werden geleert.</span>
            </span>
          </label>
          {mode === "categories" && (
            <fieldset className="checklist">
              <legend className="muted">Kategorien</legend>
              {CATEGORIES.map((c) => (
                <label key={c.key} className="choice">
                  <input
                    type="checkbox"
                    checked={categories.includes(c.key)}
                    onChange={(e) =>
                      changeScope(() =>
                        setCategories((current) => (e.target.checked ? [...current, c.key] : current.filter((k) => k !== c.key))),
                      )
                    }
                  />
                  <span>
                    <strong>{c.label}</strong>
                    <span className="muted"> {c.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="choice">
            <input
              type="radio"
              name="mode"
              checked={mode === "full"}
              disabled={!settings.allowFullReset}
              onChange={() => changeScope(() => setMode("full"))}
            />
            <span>
              <strong>Konten komplett löschen</strong>
              <span className="muted">
                {settings.allowFullReset
                  ? " Konto, alle Daten und alle Dateien, endgültig. Wie „Konto löschen“."
                  : " Ausgeschaltet (allow_full_reset = false)."}
              </span>
            </span>
          </label>
        </section>
      )}

      {step === "users" && mode !== null && (
        <section className="panel">
          <h3>
            2. Nutzer
            <span className="pill numeric" aria-live="polite">
              {selected.size} ausgewählt
            </span>
          </h3>
          <div className="filters">
            <label className="grow">
              Suche (Username oder Anzeigename)
              <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={60} />
            </label>
            <button type="button" className="button" onClick={() => search(query)}>
              Suchen
            </button>
            <label>
              Anzeigen
              <select value={filter} onChange={(e) => setFilter(e.target.value as ListFilter)}>
                <option value="all">Alle</option>
                <option value="unflagged">Ohne markierte</option>
                <option value="flagged">Nur markierte</option>
                <option value="selected">Nur ausgewählte</option>
              </select>
            </label>
          </div>
          <div className="action-row">
            <button
              type="button"
              className="button"
              disabled={candidates === null}
              onClick={() => {
                const after = selectAllExceptProtected(selected, visible, mode, includeFlagged);
                setDialog({ kind: "select-all", count: after.size - selected.size, flaggedIncluded: includeFlagged });
              }}
            >
              Alle ausser geschützte auswählen
            </button>
            <button type="button" className="button" disabled={selected.size === 0} onClick={() => { setSelected(new Set()); setPreview(null); }}>
              Auswahl leeren
            </button>
          </div>
          {selectedFlagged > 0 && (
            <p className="notice">
              {selectedFlagged} markierte Konten ausgewählt. Gemeldete oder moderierte Inhalte bleiben als Beweis erhalten, alles andere der
              gewählten Kategorien wird gelöscht.
            </p>
          )}
          {candidates !== null && candidates.length >= MAX_TARGETS && (
            <p className="muted">Es werden höchstens {MAX_TARGETS} Konten angezeigt. Für weitere die Suche verwenden.</p>
          )}
          {candidates === null && <p className="muted">Wird geladen …</p>}
          {candidates !== null && (
            <table className="table compact">
              <thead>
                <tr>
                  <th aria-label="Auswahl" />
                  <th>Nutzer</th>
                  <th>Status</th>
                  <th>Seit</th>
                  <th>Hinweis</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const state = selectability(c, mode, includeFlagged);
                  const locked = state.kind === "locked";
                  return (
                    <tr key={c.userId} className={locked ? "locked" : selected.has(c.userId) ? "selected" : undefined}>
                      <td>
                        {locked ? (
                          <span title={state.reason}>
                            <LockIcon />
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`@${c.username} auswählen`}
                            checked={selected.has(c.userId)}
                            onChange={() => tick(c)}
                          />
                        )}
                      </td>
                      <td>
                        @{c.username} <span className="muted">{c.displayName}</span>
                      </td>
                      <td>{label(ACCOUNT_STATUS_LABELS, c.accountStatus)}</td>
                      <td>{formatDateTime(c.createdAt)}</td>
                      <td>
                        {locked && <span className="pill">{state.reason}</span>}
                        {!locked &&
                          c.flags.map((f) => (
                            <span key={f} className="pill warn">
                              {FLAG_LABELS[f] ?? f}
                            </span>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {step === "preview" && preview !== null && (
        <section className="panel">
          <h3>3. Vorschau (Trockenlauf)</h3>
          <p className="muted">
            Nichts wurde gelöscht. So viele Einträge würden entfernt
            {mode === "full" ? ", dazu jedes Konto selbst mit allen Dateien" : ""}. Inhalte, die die Moderation entfernt oder in Quarantäne
            gesetzt hat, bleiben.
          </p>
          <div className="table-scroll">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Nutzer</th>
                  {categoriesShown.map((c) => (
                    <th key={c} className="numeric">
                      {categoryLabel(c)}
                    </th>
                  ))}
                  <th className="numeric">Summe</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      @{row.username} {row.flagged && <span className="pill warn">markiert</span>}
                    </td>
                    {categoriesShown.map((c) => (
                      <td key={c} className="numeric">
                        {categoryTotal(row.counts, c)}
                      </td>
                    ))}
                    <td className="numeric">{countsTotal(row.counts)}</td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>Summe ({preview.rows.length} Personen)</td>
                  {categoriesShown.map((c) => (
                    <td key={c} className="numeric">
                      {categoryTotal(sumCounts(preview.rows.map((r) => r.counts)), c)}
                    </td>
                  ))}
                  <td className="numeric">{countsTotal(preview.totals)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">
            {mode === "full"
              ? "Dateien: alle Dateien der Konten im Storage werden gelöscht."
              : `Dateien im Storage, die mitgelöscht werden: ${preview.files} (nur Fotos, die sonst nichts mehr nutzt).`}
          </p>
          <details>
            <summary>Einzelheiten je Kategorie</summary>
            <ul className="plain-list">
              {Object.entries(preview.totals).map(([category, numbers]) => (
                <li key={category}>
                  <strong>{categoryLabel(category)}:</strong>{" "}
                  {Object.entries(numbers)
                    .map(([what, n]) => `${COUNT_LABELS[what] ?? what} ${n}`)
                    .join(" · ")}
                </li>
              ))}
            </ul>
          </details>
          <div className="action-row">
            <button type="button" className="button" disabled={busy} onClick={runPreview}>
              Trockenlauf wiederholen
            </button>
            <button type="button" className="button" onClick={() => downloadJson(`peakpic-vorschau-${fileStamp()}.json`, preview.raw)}>
              Vorschau als JSON herunterladen
            </button>
          </div>
        </section>
      )}
      {step === "preview" && preview === null && (
        <section className="panel">
          <h3>3. Vorschau (Trockenlauf)</h3>
          <p className="muted">Umfang oder Auswahl haben sich geändert.</p>
          <div className="action-row">
            <button type="button" className="button primary" disabled={busy} onClick={runPreview}>
              Trockenlauf ausführen
            </button>
          </div>
        </section>
      )}

      {step === "message" && (
        <section className="panel">
          <h3>4. Begründung und Benachrichtigung</h3>
          <label className="field">
            <span>Begründung (Pflicht, intern und in der E-Mail, {reason.trim().length}/{REASON_MAX})</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={2} />
          </label>
          <label className="field">
            <span>Betreff der E-Mail ({subject.length}/{SUBJECT_MAX})</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, " "))} maxLength={SUBJECT_MAX} />
          </label>
          <label className="field">
            <span>
              Text der E-Mail (Platzhalter <code>{"{{kategorien}}"}</code> und <code>{"{{begruendung}}"}</code>)
            </span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MESSAGE_MAX} rows={7} />
          </label>
          <h4>Vorschau der E-Mail</h4>
          <div className="mail-preview">
            <p>
              <strong>{subject}</strong>
            </p>
            <p className="user-text">{mailText}</p>
          </div>
          <p className="muted">
            Eine E-Mail bekommen nur Personen, bei denen tatsächlich etwas gelöscht wird. Die Mail ergänzt automatisch, was unverändert
            bleibt, und die Kontaktadresse. Keine Links.
          </p>
        </section>
      )}

      {step === "confirm" && (
        <section className="panel danger-zone">
          <h3>5. Sicherung und Bestätigung</h3>
          <p>
            {mode === "full"
              ? `${selected.size} Konten werden mit allen Daten und Dateien endgültig gelöscht.`
              : `Bei ${selected.size} Personen werden gelöscht: ${categories.map(categoryLabel).join(", ")}.`}{" "}
            Das lässt sich nicht rückgängig machen.
          </p>
          <div className="action-row">
            <button type="button" className="button" disabled={busy || jobId === null} onClick={exportBackup}>
              Sicherung als JSON herunterladen
            </button>
            {exported && <span className="success">Heruntergeladen.</span>}
          </div>
          <p className="muted">
            Die Sicherung enthält die betroffenen Tabellenzeilen, aber keine Dateien aus dem Storage, keine Chat-Texte und keine
            E-Mail-Adressen. Der Export wird im Audit-Log festgehalten. Ob und wie lange Supabase selbst Backups aufbewahrt, hängt vom Tarif
            ab; bitte im Supabase-Dashboard selbst prüfen.
          </p>
          <label className="choice">
            <input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} />
            <span>Ich habe eine Sicherung.</span>
          </label>
          <label className="field">
            <span>Zur Bestätigung „{PHRASE}“ eingeben</span>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">
            <span>Aktueller Zwei-Faktor-Code</span>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
            />
          </label>
        </section>
      )}

      {error !== null && dialog === null && <p className="error">{error}</p>}
      {blocker !== null && step !== "preview" && <p className="muted">{blocker}</p>}

      <div className="wizard-nav">
        <button type="button" className="button" disabled={busy || previousStep(step, jobId === null ? null : "draft") === null} onClick={goBack}>
          Zurück
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => setDialog({ kind: "discard" })}>
          {jobId === null ? "Abbrechen" : "Entwurf verwerfen"}
        </button>
        {step === "confirm" ? (
          <button type="button" className="button danger" disabled={busy || blocker !== null} onClick={() => setDialog({ kind: "confirm" })}>
            Auftrag bestätigen …
          </button>
        ) : (
          <button type="button" className="button primary" disabled={busy || blocker !== null} onClick={goNext}>
            {busy ? "Bitte warten …" : step === "users" ? "Trockenlauf ausführen" : "Weiter"}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={dialog !== null}
        title={
          dialog?.kind === "flag-one"
            ? `Markiertes Konto @${dialog.candidate.username} auswählen?`
            : dialog?.kind === "select-all"
              ? `${dialog.count} Personen auswählen?`
              : dialog?.kind === "discard"
                ? "Entwurf verwerfen?"
                : `Auftrag für ${selected.size} Personen bestätigen?`
        }
        confirmLabel={
          dialog?.kind === "flag-one"
            ? "Markierte Konten einbeziehen"
            : dialog?.kind === "select-all"
              ? "Auswählen"
              : dialog?.kind === "discard"
                ? "Verwerfen"
                : "Endgültig bestätigen"
        }
        danger={dialog?.kind === "flag-one" || dialog?.kind === "confirm"}
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog === null) return;
          if (dialog.kind === "discard") {
            discard();
            return;
          }
          if (mode === null) return;
          if (dialog.kind === "flag-one") {
            setIncludeFlagged(true);
            setSelected((current) => toggleSelection(current, dialog.candidate, mode, true));
            setPreview(null);
            setDialog(null);
          } else if (dialog.kind === "select-all") {
            setSelected((current) => selectAllExceptProtected(current, visible, mode, includeFlagged));
            setPreview(null);
            setDialog(null);
          } else {
            confirmJob();
          }
        }}
      >
        {dialog?.kind === "flag-one" && (
          <p>
            Dieses Konto ist markiert ({dialog.candidate.flags.map((f) => FLAG_LABELS[f] ?? f).join(", ")}). Ab jetzt sind markierte Konten
            in diesem Auftrag wählbar. Moderierte Inhalte bleiben als Beweis erhalten, alles andere der gewählten Kategorien wird gelöscht.
          </p>
        )}
        {dialog?.kind === "select-all" && (
          <p>
            {dialog.count} weitere Personen aus der angezeigten Liste werden ausgewählt
            {dialog.flaggedIncluded ? " (markierte eingeschlossen)" : ", markierte nicht"}. Geschützte Konten bleiben gesperrt.
          </p>
        )}
        {dialog?.kind === "discard" && <p>Der Auftrag wird abgebrochen. Gelöscht wird nichts.</p>}
        {dialog?.kind === "confirm" && (
          <p>
            {mode === "full" ? "Konten komplett löschen" : `Daten löschen: ${categories.map(categoryLabel).join(", ")}`}. Danach sind Umfang
            und Auswahl eingefroren; gestartet wird im nächsten Schritt.
          </p>
        )}
        {error !== null && <p className="error">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}
