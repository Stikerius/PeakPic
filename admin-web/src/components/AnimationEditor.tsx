import { useState } from "react";

import { BrandLogo } from "./BrandLogo";
import {
  BRAND_PALETTE_LABELS,
  PRESET_RANGES,
  STANDARD_PARAMS,
  type BrandMode,
  type BrandPaletteName,
  type EasingName,
  type ExitMode,
  type FillMode,
  type PresetParams,
} from "../lib/brand";

type NumberKey = keyof typeof PRESET_RANGES;

const NUMBERS: { key: NumberKey; label: string; step: number; switchedBy?: keyof PresetParams }[] = [
  { key: "duration", label: "Dauer des Durchlaufs (Sekunden)", step: 0.5 },
  { key: "drawPortion", label: "Zeichen-Anteil", step: 0.01, switchedBy: "drawLine" },
  { key: "strokeWidth", label: "Linienstärke", step: 0.1 },
  { key: "shineWidth", label: "Glanz-Breite", step: 1, switchedBy: "shine" },
  { key: "shineAngle", label: "Glanz-Neigung (Grad)", step: 1, switchedBy: "shine" },
  { key: "waveStrength", label: "Wellen-Stärke", step: 0.01, switchedBy: "wave" },
  { key: "waveScale", label: "Wellen-Endskalierung", step: 0.1, switchedBy: "wave" },
  { key: "dotSpacing", label: "Punktabstand", step: 1, switchedBy: "dots" },
  { key: "dotRadius", label: "Punktradius", step: 0.1, switchedBy: "dots" },
  { key: "dotGlowRadius", label: "Leuchtpunktradius", step: 0.1, switchedBy: "dots" },
  { key: "dotFade", label: "Randausblendung", step: 0.01, switchedBy: "dots" },
  { key: "breatheStrength", label: "Atem-Stärke (Prozent)", step: 0.1, switchedBy: "breathe" },
  { key: "hold", label: "Halten (Anteil des Durchlaufs)", step: 0.01 },
];

const SWITCHES: { key: "drawLine" | "fill" | "shine" | "wave" | "dots" | "breathe"; label: string }[] = [
  { key: "drawLine", label: "Linie zeichnen" },
  { key: "fill", label: "Füllen" },
  { key: "shine", label: "Glanz" },
  { key: "wave", label: "Welle" },
  { key: "dots", label: "Punktraster" },
  { key: "breathe", label: "Atmen" },
];

const FILL_MODES: [FillMode, string][] = [
  ["fade", "Einblenden"],
  ["wipeUp", "Wischen von unten"],
  ["wipeLeft", "Wischen von links"],
  ["bloom", "Aufblühen mit Skalierung"],
];
const EXITS: [ExitMode, string][] = [
  ["fade", "Ausblenden"],
  ["shrink", "Schrumpfen"],
  ["none", "Keines"],
];
const EASINGS: [EasingName, string][] = [
  ["smooth", "Weich"],
  ["snappy", "Knackig"],
  ["linear", "Linear"],
];

function clampTo(key: NumberKey, value: number): number {
  const [min, max] = PRESET_RANGES[key];
  return Math.min(max, Math.max(min, Math.round(value * 1000) / 1000));
}

/**
 * All parameters of an animation within their fixed ranges, with a live preview: restart,
 * timeline, light/dark, palette and the still image (what "reduce motion" shows).
 */
export function AnimationEditor({ spec, params, onChange }: { spec: unknown; params: PresetParams; onChange: (next: PresetParams) => void }) {
  const [mode, setMode] = useState<BrandMode>("dark");
  const [palette, setPalette] = useState<BrandPaletteName>("bw");
  const [restart, setRestart] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [still, setStill] = useState(false);

  const set = <K extends keyof PresetParams>(key: K, value: PresetParams[K]) => onChange({ ...params, [key]: value });

  return (
    <div className="animation-editor">
      <div className="animation-preview">
        <BrandLogo
          spec={spec}
          params={params}
          palette={palette}
          mode={mode}
          size={260}
          background
          playing={!still}
          progress={still ? null : scrub}
          restartKey={restart}
        />
        <label className="field">
          <span>Zeitleiste{scrub === null ? " (läuft)" : `: ${Math.round(scrub * 100)} %`}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={scrub ?? 0}
            disabled={still}
            onChange={(e) => setScrub(Number(e.target.value))}
            aria-label="Zeitpunkt im Durchlauf"
          />
        </label>
        <div className="action-row">
          <button
            type="button"
            className="button small"
            onClick={() => {
              setScrub(null);
              setRestart((v) => v + 1);
            }}
          >
            Neustart
          </button>
          <button type="button" className="button small" onClick={() => setMode(mode === "dark" ? "light" : "dark")}>
            {mode === "dark" ? "Hell zeigen" : "Dunkel zeigen"}
          </button>
          <button type="button" className="button small" onClick={() => setPalette(palette === "bw" ? "color" : "bw")}>
            {BRAND_PALETTE_LABELS[palette === "bw" ? "color" : "bw"]} zeigen
          </button>
          <label className="choice">
            <input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} />
            Standbild-Test
          </label>
        </div>
      </div>

      <div className="animation-controls">
        <fieldset className="checklist">
          {SWITCHES.map(({ key, label }) => (
            <label key={key} className="choice">
              <input type="checkbox" checked={params[key]} onChange={(e) => set(key, e.target.checked)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Füll-Art</span>
          <select value={params.fillMode} disabled={!params.fill} onChange={(e) => set("fillMode", e.target.value as FillMode)}>
            {FILL_MODES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ausblenden</span>
          <select value={params.exit} onChange={(e) => set("exit", e.target.value as ExitMode)}>
            {EXITS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Easing</span>
          <select value={params.easing} onChange={(e) => set("easing", e.target.value as EasingName)}>
            {EASINGS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {NUMBERS.map(({ key, label, step, switchedBy }) => {
          const [min, max] = PRESET_RANGES[key];
          const off = switchedBy !== undefined && params[switchedBy] === false;
          return (
            <label key={key} className="field">
              <span>
                {label}: <strong className="numeric">{params[key]}</strong> ({min} bis {max})
              </span>
              <input type="range" min={min} max={max} step={step} value={params[key]} disabled={off} onChange={(e) => set(key, clampTo(key, Number(e.target.value)))} />
            </label>
          );
        })}
        <div className="action-row">
          <button type="button" className="button small" onClick={() => onChange(STANDARD_PARAMS)}>
            Zurücksetzen (Standard)
          </button>
        </div>
      </div>
    </div>
  );
}
