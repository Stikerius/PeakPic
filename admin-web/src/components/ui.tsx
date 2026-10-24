import { useId, type ReactNode } from "react";

/** A small set of options as a radio group that looks like a segmented control. */
export function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  small = false,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  small?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={small ? "segmented-choice small" : "segmented-choice"}>
      <legend>{label}</legend>
      <div className="segmented-options">
        {options.map(([option, text]) => (
          <label key={option} className={option === value ? "segment active" : "segment"}>
            <input type="radio" name={name} value={option} checked={option === value} onChange={() => onChange(option)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Placeholder lines while something loads (instead of a spinner). */
export function Skeleton({ lines = 3, label = "Lädt …" }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton-block" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

/** A clear empty state: what is missing and what to do. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children !== undefined && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/**
 * Head of every page: optional link back, the title, a short lead and actions on the right. The
 * lead sits on the page background, so it is plain text without decoration.
 */
export function PageHeader({
  title,
  back,
  actions,
  children,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {back !== undefined && (
          <a className="back-link" href={back.href}>
            ← {back.label}
          </a>
        )}
        <h1>{title}</h1>
        {children !== undefined && <div className="page-lead muted">{children}</div>}
      </div>
      {actions !== undefined && <div className="page-actions">{actions}</div>}
    </header>
  );
}
