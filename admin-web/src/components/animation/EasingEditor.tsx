import { useRef } from "react";

import { NumberField, SelectField, formatNumber } from "./fields";
import { EASING_LIMITS, EASING_PRESET_CURVES, applyEasing, type EasingPreset, type EasingSpec } from "../../lib/brand";

export const EASING_PRESET_LABELS: Record<EasingPreset, string> = {
  linear: "Linear",
  smooth: "Weich",
  snappy: "Knackig",
  easeIn: "Ein",
  easeOut: "Aus",
  easeInOut: "Ein und Aus",
  easeInStrong: "Ein (stark)",
  easeOutStrong: "Aus (stark)",
  easeInOutStrong: "Ein und Aus (stark)",
};

const TYPE_LABELS: readonly (readonly [EasingSpec["type"], string])[] = [
  ["preset", "Auswahl"],
  ["bezier", "Eigene Kurve"],
  ["spring", "Feder"],
  ["bounce", "Abpraller"],
  ["hold", "Halten, dann springen"],
];

/** Short text of an easing ("Ein und Aus", "Eigene Kurve 0,42 0 0,58 1", …). */
export function easingText(e: EasingSpec): string {
  const rev = e.reverse === true ? ", umgekehrt" : "";
  switch (e.type) {
    case "preset":
      return EASING_PRESET_LABELS[e.name] + rev;
    case "bezier":
      return `Eigene Kurve ${[e.x1, e.y1, e.x2, e.y2].map((n) => formatNumber(n)).join(" ")}${rev}`;
    case "spring":
      return `Feder (Dämpfung ${formatNumber(e.damping)}, ${formatNumber(e.frequency)} Schwünge)${rev}`;
    case "bounce":
      return `Abpraller (${e.bounces}×)${rev}`;
    case "hold":
      return `Halten${rev}`;
  }
}

/** Switch the type, keeping the look as far as possible (a preset becomes its bezier, …). */
function convert(e: EasingSpec, type: EasingSpec["type"]): EasingSpec {
  const reverse = e.reverse === true ? { reverse: true } : {};
  switch (type) {
    case "preset":
      return { type, name: "easeInOut", ...reverse };
    case "bezier": {
      const [x1, y1, x2, y2] = e.type === "preset" && e.name !== "linear" ? EASING_PRESET_CURVES[e.name] : e.type === "bezier" ? [e.x1, e.y1, e.x2, e.y2] : [0.42, 0, 0.58, 1];
      return { type, x1, y1, x2, y2, ...reverse };
    }
    case "spring":
      return { type, damping: 0.5, frequency: 2, ...reverse };
    case "bounce":
      return { type, bounces: 3, damping: 0.5, ...reverse };
    case "hold":
      return { type, ...reverse };
  }
}

const SIZE = 160;
const PAD = 20;
const Y_MIN = -0.5;
const Y_MAX = 1.5;
const toX = (x: number) => PAD + x * (SIZE - 2 * PAD);
const toY = (y: number) => PAD + ((Y_MAX - Math.min(Y_MAX, Math.max(Y_MIN, y))) / (Y_MAX - Y_MIN)) * (SIZE - 2 * PAD);

/** The curve as an SVG path (sampled), for every easing type. */
function curvePath(e: EasingSpec): string {
  const points = Array.from({ length: 81 }, (_, i) => {
    const s = i / 80;
    return `${i === 0 ? "M" : "L"}${toX(s).toFixed(2)} ${toY(applyEasing(e, s)).toFixed(2)}`;
  });
  return points.join(" ");
}

/**
 * One easing: choice of type, the named curves, an own cubic-bezier with two handles (drag with
 * the mouse or move with the arrow keys, Shift for bigger steps), spring and bounce with their
 * fixed ranges, "hold", and "umgekehrt". Shows the curve.
 */
export function EasingEditor({ label, value, onChange }: { label: string; value: EasingSpec; onChange: (next: EasingSpec) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [bx, by] = EASING_LIMITS.bezierY;

  function moveHandle(handle: 1 | 2, x: number, y: number) {
    if (value.type !== "bezier") return;
    const cx = Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;
    const cy = Math.round(Math.min(by, Math.max(bx, y)) * 100) / 100;
    onChange(handle === 1 ? { ...value, x1: cx, y1: cy } : { ...value, x2: cx, y2: cy });
  }

  function dragFrom(handle: 1 | 2) {
    return (event: React.PointerEvent<SVGCircleElement>) => {
      const el = svg.current;
      if (el === null) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => {
        const box = el.getBoundingClientRect();
        const sx = ((e.clientX - box.left) / box.width) * SIZE;
        const sy = ((e.clientY - box.top) / box.height) * SIZE;
        moveHandle(handle, (sx - PAD) / (SIZE - 2 * PAD), Y_MAX - ((sy - PAD) / (SIZE - 2 * PAD)) * (Y_MAX - Y_MIN));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  function keyFor(handle: 1 | 2) {
    return (event: React.KeyboardEvent) => {
      if (value.type !== "bezier") return;
      const step = event.shiftKey ? 0.1 : 0.01;
      const [x, y] = handle === 1 ? [value.x1, value.y1] : [value.x2, value.y2];
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const d = moves[event.key];
      if (d === undefined) return;
      event.preventDefault();
      moveHandle(handle, x + d[0], y + d[1]);
    };
  }

  return (
    <fieldset className="easing-editor">
      <legend>{label}</legend>
      <div className="easing-editor-row">
        <svg ref={svg} className="easing-graph" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Kurve: ${easingText(value)}`}>
          <rect className="easing-frame" x={PAD} y={toY(1)} width={SIZE - 2 * PAD} height={toY(0) - toY(1)} />
          <path className="easing-curve" d={curvePath(value)} />
          {value.type === "bezier" && (
            <>
              <line className="easing-arm" x1={toX(0)} y1={toY(0)} x2={toX(value.x1)} y2={toY(value.y1)} />
              <line className="easing-arm" x1={toX(1)} y1={toY(1)} x2={toX(value.x2)} y2={toY(value.y2)} />
              {([1, 2] as const).map((h) => {
                const [x, y] = h === 1 ? [value.x1, value.y1] : [value.x2, value.y2];
                return (
                  <circle
                    key={h}
                    className="easing-handle"
                    cx={toX(x)}
                    cy={toY(y)}
                    r={7}
                    tabIndex={0}
                    role="slider"
                    aria-label={`Ziehpunkt ${h}`}
                    aria-valuetext={`x ${formatNumber(x)}, y ${formatNumber(y)}`}
                    aria-valuenow={x}
                    aria-valuemin={0}
                    aria-valuemax={1}
                    onPointerDown={dragFrom(h)}
                    onKeyDown={keyFor(h)}
                  />
                );
              })}
            </>
          )}
        </svg>
        <div className="easing-fields">
          <SelectField label="Art" value={value.type} options={TYPE_LABELS} onChange={(type) => onChange(convert(value, type))} />
          {value.type === "preset" && (
            <SelectField<EasingPreset>
              label="Kurve"
              value={value.name}
              options={Object.entries(EASING_PRESET_LABELS) as [EasingPreset, string][]}
              onChange={(name) => onChange({ ...value, name })}
            />
          )}
          {value.type === "bezier" && (
            <div className="bezier-fields">
              {(["x1", "y1", "x2", "y2"] as const).map((k) => (
                <label key={k} className="field">
                  <span>{k}</span>
                  <input
                    type="number"
                    step={0.01}
                    min={k.startsWith("x") ? 0 : bx}
                    max={k.startsWith("x") ? 1 : by}
                    value={value[k]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      if (k === "x1" || k === "y1") moveHandle(1, k === "x1" ? n : value.x1, k === "y1" ? n : value.y1);
                      else moveHandle(2, k === "x2" ? n : value.x2, k === "y2" ? n : value.y2);
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          {value.type === "spring" && (
            <>
              <NumberField label="Dämpfung" value={value.damping} range={EASING_LIMITS.springDamping} step={0.05} onChange={(damping) => onChange({ ...value, damping })} />
              <NumberField label="Schwünge" value={value.frequency} range={EASING_LIMITS.springFrequency} step={0.5} onChange={(frequency) => onChange({ ...value, frequency })} />
            </>
          )}
          {value.type === "bounce" && (
            <>
              <NumberField label="Anzahl Abpraller" value={value.bounces} range={EASING_LIMITS.bounceCount} step={1} integer onChange={(bounces) => onChange({ ...value, bounces })} />
              <NumberField label="Höhe je Abpraller" value={value.damping} range={EASING_LIMITS.bounceDamping} step={0.05} onChange={(damping) => onChange({ ...value, damping })} />
            </>
          )}
          <label className="choice">
            <input
              type="checkbox"
              checked={value.reverse === true}
              onChange={(e) => {
                const next: EasingSpec = { ...value };
                if (e.target.checked) next.reverse = true;
                else delete next.reverse;
                onChange(next);
              }}
            />
            Umgekehrt (in der Zeit gespiegelt)
          </label>
        </div>
      </div>
    </fieldset>
  );
}
