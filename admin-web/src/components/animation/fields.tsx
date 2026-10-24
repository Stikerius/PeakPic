import { useId } from "react";

/** "0.35" (Swiss format like the rest of the dashboard, at most `digits` places). */
export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("de-CH", { maximumFractionDigits: digits }).format(value);
}

/**
 * A number with a fixed range: slider plus number field (both with the same label). Values
 * outside the range are clamped.
 */
export function NumberField({
  label,
  value,
  range,
  step,
  onChange,
  disabled = false,
  integer = false,
  unit,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  integer?: boolean;
  unit?: string;
}) {
  const id = useId();
  const [min, max] = range;
  const set = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    const clamped = Math.min(max, Math.max(min, raw));
    onChange(integer ? Math.round(clamped) : Math.round(clamped * 10000) / 10000);
  };
  return (
    <div className="number-field">
      <label htmlFor={id}>
        {label}
        {unit !== undefined ? ` (${unit})` : ""}
        <span className="muted">
          {" "}
          {formatNumber(min)} bis {formatNumber(max)}
        </span>
      </label>
      <div className="number-field-inputs">
        <input type="range" aria-label={`${label}, Regler`} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => set(Number(e.target.value))} />
        <input id={id} type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => set(Number(e.target.value))} />
      </div>
    </div>
  );
}

/** A labelled select over fixed options. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
