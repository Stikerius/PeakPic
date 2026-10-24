import { useState } from "react";

import { EasingEditor } from "./EasingEditor";
import { NumberField, SelectField } from "./fields";
import { mirrorTime, randomize, scaleTempo, setKeyframe, staggerTrack, trackLabel, updateTrack, type KeyRef } from "../../lib/animationEditor";
import {
  ANIMATION_LIMITS,
  COLOR_NAME_LABELS,
  FILL_VARIANT_LABELS,
  GLOBAL_KINDS,
  KIND_INTEGERS,
  KIND_NUMBERS,
  STAGGER_LABELS,
  TRACK_LABELS,
  VALUE_LABELS,
  VALUE_RANGES,
  type AnimationSpec,
  type ColorName,
  type FillVariant,
  type LogoSpec,
  type StaggerMode,
  type Target,
  type Track,
} from "../../lib/brand";

const NUMBER_LABELS: Record<string, string> = {
  width: "Breite",
  angle: "Neigung (Grad)",
  strength: "Stärke",
  scale: "Endgrösse",
  spacing: "Punktabstand",
  radius: "Punktradius",
  glowRadius: "Leuchtpunktradius",
  fade: "Randausblendung",
  count: "Anzahl",
  seed: "Seed",
  size: "Grösse",
  distance: "Flugweite",
  amount: "Schrumpfen um",
};
const ROLE_LABELS = { fill: "Fläche", cutout: "Aussparung", stroke: "Linie" } as const;

function targetValue(t: Target): string {
  return t.type === "all" ? "all" : t.type === "shape" ? `shape:${t.index}` : `role:${t.role}`;
}

function parseTarget(value: string): Target {
  if (value.startsWith("shape:")) return { type: "shape", index: Number(value.slice(6)) };
  if (value.startsWith("role:")) {
    const role = value.slice(5);
    if (role === "fill" || role === "cutout" || role === "stroke") return { type: "role", role };
  }
  return { type: "all" };
}

type PanelProps = {
  spec: AnimationSpec;
  logo: LogoSpec;
  trackIndex: number;
  selection: KeyRef[];
  onChange: (spec: AnimationSpec) => void;
  onHighlight: (shape: number | null) => void;
};

/** Settings of the selected track and keyframe(s), the tools and the shape list. */
export function TrackPanel({ spec, logo, trackIndex, selection, onChange, onHighlight }: PanelProps) {
  const track = spec.tracks[trackIndex];
  const [seed, setSeed] = useState(1);
  const [strength, setStrength] = useState(0.1);
  const [tempo, setTempo] = useState("1.5");
  if (track === undefined) return null;
  const global = GLOBAL_KINDS.includes(track.kind);
  const set = (change: Partial<Track>) => onChange(updateTrack(spec, trackIndex, change));
  const mine = selection.filter((r) => r.track === trackIndex);
  const single = mine.length === 1 ? mine[0] : undefined;
  const keyframe = single !== undefined ? track.keyframes[single.key] : undefined;
  const numbers = Object.entries(KIND_NUMBERS[track.kind] as Record<string, readonly [number, number]>);

  return (
    <div className="track-panel">
      <h3>{trackLabel(track, trackIndex)}</h3>
      <label className="choice">
        <input type="checkbox" checked={track.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Aktiv (aus = stumm)
      </label>
      <SelectField
        label="Ziel"
        value={targetValue(track.target)}
        disabled={global}
        options={[
          ["all", "Alle Formen"],
          ...(["fill", "cutout", "stroke"] as const).map((r) => [`role:${r}`, `Alle ${ROLE_LABELS[r]}n`] as const),
          ...logo.shapes.map((s, i) => [`shape:${i}`, `Form ${i + 1} (${ROLE_LABELS[s.role]})`] as const),
        ]}
        onChange={(value) => set({ target: parseTarget(value) })}
      />
      {global && <p className="muted">{TRACK_LABELS[track.kind]} wirkt immer auf das ganze Bild.</p>}
      <SelectField<StaggerMode>
        label="Staffelung"
        value={track.stagger.mode}
        disabled={global}
        options={Object.entries(STAGGER_LABELS) as [StaggerMode, string][]}
        onChange={(mode) => onChange(staggerTrack(spec, trackIndex, { ...track.stagger, mode }))}
      />
      {track.stagger.mode !== "none" && (
        <>
          <NumberField
            label="Versatz (Anteil des Durchlaufs)"
            value={track.stagger.amount}
            range={ANIMATION_LIMITS.staggerAmount}
            step={0.01}
            onChange={(amount) => onChange(staggerTrack(spec, trackIndex, { ...track.stagger, amount }))}
          />
          {track.stagger.mode === "random" && (
            <NumberField label="Seed" value={track.stagger.seed} range={ANIMATION_LIMITS.seed} step={1} integer onChange={(s) => onChange(staggerTrack(spec, trackIndex, { ...track.stagger, seed: s }))} />
          )}
        </>
      )}
      <NumberField label="Wiederholung im Durchlauf" value={track.repeat} range={ANIMATION_LIMITS.repeat} step={1} integer onChange={(repeat) => set({ repeat })} />

      {track.kind === "fill" && (
        <SelectField<FillVariant> label="Füll-Art" value={track.variant} options={Object.entries(FILL_VARIANT_LABELS) as [FillVariant, string][]} onChange={(variant) => set({ variant })} />
      )}
      {track.kind === "dots" && (
        <SelectField<"glow" | "gradient">
          label="Punktraster"
          value={track.variant}
          options={[
            ["glow", "Leuchten"],
            ["gradient", "Verlauf"],
          ]}
          onChange={(variant) => set({ variant })}
        />
      )}
      {track.kind === "float" && (
        <SelectField<"x" | "y"> label="Richtung" value={track.axis} options={[["x", "Waagrecht"], ["y", "Senkrecht"]]} onChange={(axis) => set({ axis })} />
      )}
      {track.kind === "exit" && (
        <>
          <SelectField<"fade" | "shrink"> label="Art" value={track.variant} options={[["fade", "Ausblenden"], ["shrink", "Schrumpfen"]]} onChange={(variant) => set({ variant })} />
          <SelectField<"all" | "outline" | "fill">
            label="Ebene"
            value={track.layer}
            options={[
              ["all", "Ganzes Logo"],
              ["outline", "Nur Linie"],
              ["fill", "Nur Füllung"],
            ]}
            onChange={(layer) => set({ layer })}
          />
        </>
      )}
      {track.kind === "color" && (
        <>
          <SelectField<ColorName> label="Von" value={track.from} options={Object.entries(COLOR_NAME_LABELS) as [ColorName, string][]} onChange={(from) => set({ from })} />
          <SelectField<ColorName> label="Nach" value={track.to} options={Object.entries(COLOR_NAME_LABELS) as [ColorName, string][]} onChange={(to) => set({ to })} />
        </>
      )}
      {numbers.map(([key, range]) => (
        <NumberField
          key={key}
          label={NUMBER_LABELS[key] ?? key}
          value={(track as unknown as Record<string, number>)[key] ?? range[0]}
          range={range}
          step={KIND_INTEGERS.includes(key) ? 1 : (range[1] - range[0]) / 100}
          integer={KIND_INTEGERS.includes(key)}
          onChange={(n) => set({ [key]: n } as Partial<Track>)}
        />
      ))}
      {track.kind === "wave" && <EasingEditor label="Wachsen der Welle" value={track.grow} onChange={(grow) => set({ grow })} />}

      <h4>Keyframe</h4>
      {mine.length === 0 && <p className="muted">Keinen ausgewählt. In der Spur anklicken, mit Enter beim Abspielkopf anlegen oder doppelklicken.</p>}
      {mine.length > 1 && (
        <>
          <p>{mine.length} Keyframes ausgewählt.</p>
          <EasingEditor
            label="Easing für alle ausgewählten"
            value={track.keyframes[mine[0]?.key ?? 0]?.ease ?? { type: "preset", name: "linear" }}
            onChange={(ease) => onChange(mine.reduce((s, r) => setKeyframe(s, r, { ease }), spec))}
          />
        </>
      )}
      {single !== undefined && keyframe !== undefined && (
        <>
          <NumberField label="Zeit" unit="Anteil des Durchlaufs" value={keyframe.t} range={[0, 1]} step={0.001} onChange={(t) => onChange(setKeyframe(spec, single, { t }))} />
          <NumberField label={VALUE_LABELS[track.kind]} value={keyframe.v} range={VALUE_RANGES[track.kind]} step={(VALUE_RANGES[track.kind][1] - VALUE_RANGES[track.kind][0]) / 200} onChange={(v) => onChange(setKeyframe(spec, single, { v }))} />
          <EasingEditor
            label={single.key < track.keyframes.length - 1 ? "Easing bis zum nächsten Keyframe" : "Easing (wirkt erst mit einem weiteren Keyframe)"}
            value={keyframe.ease}
            onChange={(ease) => onChange(setKeyframe(spec, single, { ease }))}
          />
        </>
      )}

      <h4>Werkzeuge</h4>
      <div className="tool-grid">
        <div className="tool">
          <NumberField label="Zufall: Stärke" value={strength} range={[0.01, 0.3]} step={0.01} onChange={setStrength} />
          <NumberField label="Zufall: Seed" value={seed} range={ANIMATION_LIMITS.seed} step={1} integer onChange={setSeed} />
          <button type="button" className="button small" onClick={() => onChange(randomize(spec, trackIndex, seed, strength))}>
            Zufall auf diese Spur
          </button>
        </div>
        <div className="tool">
          <button type="button" className="button small" onClick={() => onChange(mirrorTime(spec, trackIndex))}>
            Zeit spiegeln
          </button>
          <SelectField
            label="Tempo skalieren"
            value={tempo}
            options={[
              ["0.5", "× 0,5 (schneller)"],
              ["0.75", "× 0,75"],
              ["1.25", "× 1,25"],
              ["1.5", "× 1,5"],
              ["2", "× 2 (langsamer)"],
            ]}
            onChange={setTempo}
          />
          <div className="action-row">
            <button type="button" className="button small" onClick={() => onChange(scaleTempo(spec, trackIndex, Number(tempo)))}>
              Diese Spur
            </button>
            <button type="button" className="button small" onClick={() => onChange(scaleTempo(spec, null, Number(tempo)))}>
              Alle Spuren
            </button>
          </div>
        </div>
      </div>

      <h4>Formen</h4>
      <ul className="shape-list">
        {logo.shapes.map((shape, i) => {
          const active = track.target.type === "shape" && track.target.index === i;
          return (
            <li key={i}>
              <button
                type="button"
                className={active ? "shape-button active" : "shape-button"}
                aria-pressed={active}
                disabled={global}
                onMouseEnter={() => onHighlight(i)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(i)}
                onBlur={() => onHighlight(null)}
                onClick={() => set({ target: { type: "shape", index: i } })}
              >
                Form {i + 1}: {ROLE_LABELS[shape.role]} ({shape.type})
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted">Darüberfahren oder fokussieren zeigt die Form gestrichelt in der Vorschau; Klicken macht sie zum Ziel dieser Spur.</p>
    </div>
  );
}
