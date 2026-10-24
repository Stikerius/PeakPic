import { useEffect, useRef, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  /** Buttons at the bottom. */
  actions: ReactNode;
  onClose: () => void;
  wide?: boolean;
};

/** Native modal dialog for larger content (focus trap and Escape handled by the browser). */
export function Modal({ open, title, children, actions, onClose, wide = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{title}</h2>
      <div className="dialog-body">{open && children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}
