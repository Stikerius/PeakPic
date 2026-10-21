import { useEffect, useRef, type ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Native modal dialog (focus trap and Escape handled by the browser). */
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h2>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button type="button" className={danger ? "button danger" : "button primary"} onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? "Bitte warten …" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
