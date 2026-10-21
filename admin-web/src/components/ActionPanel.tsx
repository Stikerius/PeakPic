import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

export type PanelAction = {
  key: string;
  label: string;
  danger?: boolean;
  /** Ask again before running (ban, restore, quarantine). */
  confirm?: string;
  /** Needs an end date for a suspension. */
  needsUntil?: boolean;
  /** Needs the message to the user (warning). */
  needsUserMessage?: boolean;
  /** Hide the "message to the user" field for this action. */
  noUserMessage?: boolean;
  run: (input: { reason: string; userMessage: string; untilIso: string | null }) => Promise<unknown>;
};

type ActionPanelProps = {
  actions: PanelAction[];
  /** Longest allowed suspension in days (moderators: 7; null = no limit). The database checks it too. */
  maxDays: number | null;
  onDone: () => void;
};

const MIN_REASON = 10;
const DAY_MS = 24 * 3600 * 1000;

/** Current time; only called from event handlers and the initial state. */
function nowMs(): number {
  return Date.now();
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Reason (required), optional message to the user and the available actions. */
export function ActionPanel({ actions, maxDays, onDone }: ActionPanelProps) {
  const [reason, setReason] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [until, setUntil] = useState(() => toLocalInput(new Date(nowMs() + DAY_MS)));
  const [pending, setPending] = useState<PanelAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= MIN_REASON;

  function validate(action: PanelAction): string | null {
    if (!reasonOk) return `Begründung: mindestens ${MIN_REASON} Zeichen.`;
    if (action.needsUserMessage === true && userMessage.trim() === "") return "Bitte eine Nachricht an den Nutzer eingeben.";
    if (action.needsUntil === true) {
      const date = new Date(until);
      const now = nowMs();
      if (Number.isNaN(date.getTime()) || date.getTime() <= now) return "Das Enddatum muss in der Zukunft liegen.";
      if (maxDays !== null && date.getTime() > now + maxDays * DAY_MS) return `Moderatoren dürfen höchstens ${maxDays} Tage sperren.`;
    }
    return null;
  }

  async function execute(action: PanelAction) {
    setBusy(true);
    setError(null);
    try {
      await action.run({
        reason: reason.trim(),
        userMessage: action.noUserMessage === true ? "" : userMessage.trim(),
        untilIso: action.needsUntil === true ? new Date(until).toISOString() : null,
      });
      setDone(`${action.label}: erledigt.`);
      setReason("");
      setUserMessage("");
      onDone();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function start(action: PanelAction) {
    setDone(null);
    const problem = validate(action);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    if (action.confirm !== undefined) setPending(action);
    else void execute(action);
  }

  const showUntil = actions.some((a) => a.needsUntil === true);

  return (
    <section className="panel" aria-label="Aktionen">
      <h3>Aktion</h3>
      <label className="field">
        <span>Begründung (Pflicht, intern, mindestens {MIN_REASON} Zeichen)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} />
      </label>
      <label className="field">
        <span>Nachricht an den Nutzer (optional, für ihn sichtbar)</span>
        <textarea value={userMessage} onChange={(e) => setUserMessage(e.target.value)} maxLength={1000} rows={2} />
      </label>
      {showUntil && (
        <label className="field inline">
          <span>Sperre bis</span>
          <input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      <div className="action-row">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={action.danger === true ? "button danger" : "button"}
            disabled={busy}
            onClick={() => start(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {error !== null && <p className="error" role="alert">{error}</p>}
      {done !== null && <p className="success" role="status">{done}</p>}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.label ?? ""}
        confirmLabel={pending?.label ?? "Bestätigen"}
        danger
        busy={busy}
        onConfirm={() => {
          if (pending !== null) void execute(pending);
        }}
        onCancel={() => setPending(null)}
      >
        <p>{pending?.confirm}</p>
        <p className="muted">Begründung: {reason.trim()}</p>
      </ConfirmDialog>
    </section>
  );
}
