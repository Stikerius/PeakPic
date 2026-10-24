import { useMemo, useState, type KeyboardEvent } from "react";

import { NumberField, SelectField, formatNumber } from "./fields";
import { usePlayback, usePosition, type PlaybackStore } from "./playback";
import { Timeline } from "./Timeline";
import { TrackPanel } from "./TrackPanel";
import { BrandLogo, useReducedMotion } from "../BrandLogo";
import {
  addTrack,
  copyKeyframes,
  costRating,
  deleteKeyframes,
  deleteTrack,
  duplicateTrack,
  moveTrack,
  pasteKeyframes,
  soloSpec,
  updateTrack,
  type Clipboard,
  type KeyRef,
} from "../../lib/animationEditor";
import {
  ANIMATION_LIMITS,
  BRAND_PALETTE_LABELS,
  COST_LIMITS,
  TRACK_KINDS,
  TRACK_LABELS,
  type AnimationSpec,
  type BrandMode,
  type BrandPaletteName,
  type LogoSpec,
  type TrackKind,
} from "../../lib/brand";

type WorkbenchProps = {
  logo: LogoSpec;
  spec: AnimationSpec;
  /** `commit` false: a step of a drag (shown, no history entry yet). */
  onChange: (spec: AnimationSpec, commit?: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const ZOOMS = [
  ["1", "1×"],
  ["2", "2×"],
  ["4", "4×"],
  ["8", "8×"],
] as const;
const GRIDS = [
  ["0", "Aus"],
  ["0.1", "1/10"],
  ["0.05", "1/20"],
  ["0.025", "1/40"],
  ["0.01", "1/100"],
] as const;
const SPEEDS = [
  ["0.25", "0,25×"],
  ["0.5", "0,5×"],
  ["1", "1×"],
  ["1.5", "1,5×"],
  ["2", "2×"],
] as const;

function TimeReadout({ store, duration }: { store: PlaybackStore; duration: number }) {
  const position = usePosition(store);
  return (
    <span className="numeric time-readout">
      {formatNumber(position * duration, 2)} s von {formatNumber(duration, 2)} s ({formatNumber(position * 100, 1)} %)
    </span>
  );
}

/**
 * The timeline editor: preview with playback (tempo, loop range, frame by frame), A-B comparison,
 * light/dark, palette, still image and "reduce motion" preview, frame rate and cost; tracks and
 * keyframes; properties and tools. Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo, Ctrl+C / Ctrl+V
 * copy and paste keyframes, Delete removes the selected ones.
 */
export function AnimationWorkbench({ logo, spec, onChange, onUndo, onRedo, canUndo, canRedo }: WorkbenchProps) {
  const reducedMotion = useReducedMotion();
  const playback = usePlayback(spec.duration, !reducedMotion);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [selection, setSelection] = useState<KeyRef[]>([]);
  const [zoom, setZoom] = useState<string>("1");
  const [grid, setGrid] = useState<string>("0.025");
  const [solo, setSolo] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [mode, setMode] = useState<BrandMode>("dark");
  const [palette, setPalette] = useState<BrandPaletteName>("color");
  const [still, setStill] = useState(false);
  const [reducedPreview, setReducedPreview] = useState(false);
  const [variantA, setVariantA] = useState<AnimationSpec | null>(null);
  const [compare, setCompare] = useState(false);
  const [newKind, setNewKind] = useState<TrackKind>("rotate");
  const [notice, setNotice] = useState<string | null>(null);

  const track = Math.min(selectedTrack, spec.tracks.length - 1);
  const preview = useMemo(() => soloSpec(spec, solo), [spec, solo]);
  const previewA = useMemo(() => (variantA === null ? null : soloSpec(variantA, null)), [variantA]);
  const cost = costRating(spec, logo.shapes.length);
  const range = playback.range;

  function change(next: AnimationSpec, commit = true) {
    onChange(next, commit);
  }

  function keys(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea") !== null) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) onRedo();
      else onUndo();
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      onRedo();
    } else if (mod && event.key.toLowerCase() === "c") {
      const clip = copyKeyframes(spec, selection);
      if (clip !== null) {
        event.preventDefault();
        setClipboard(clip);
        setNotice(`${clip.items.length} Keyframe(s) kopiert.`);
      }
    } else if (mod && event.key.toLowerCase() === "v" && clipboard !== null) {
      event.preventDefault();
      change(pasteKeyframes(spec, clipboard, track, playback.store.get()));
      setNotice("Eingefügt beim Abspielkopf.");
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection.length > 0) {
      event.preventDefault();
      change(deleteKeyframes(spec, selection));
      setSelection([]);
    } else if (event.key === " " && target.closest("button") === null) {
      event.preventDefault();
      playback.setPlaying(!playback.playing);
    }
  }

  const logoProps = { spec: logo, palette, mode, size: 260, background: true, clock: playback.store, still: still || reducedPreview, highlight } as const;

  return (
    <div className="workbench" onKeyDown={keys}>
      <div className="workbench-top">
        <div className="workbench-preview">
          <div className={compare && previewA !== null ? "ab-previews" : "ab-previews single"}>
            {compare && previewA !== null && (
              <figure>
                <BrandLogo {...logoProps} animation={previewA} />
                <figcaption>A (gemerkt)</figcaption>
              </figure>
            )}
            <figure>
              <BrandLogo {...logoProps} animation={preview} />
              <figcaption>{compare && previewA !== null ? "B (aktuell)" : "Vorschau"}</figcaption>
            </figure>
          </div>
          <div className="transport" role="group" aria-label="Wiedergabe">
            <button type="button" className="button small" onClick={() => playback.step(-1)} aria-label="Ein Bild zurück">
              ◀︎ Bild
            </button>
            <button type="button" className="button small primary" onClick={() => playback.setPlaying(!playback.playing)}>
              {playback.playing ? "Pause" : "Abspielen"}
            </button>
            <button type="button" className="button small" onClick={() => playback.step(1)} aria-label="Ein Bild vor">
              Bild ▶︎
            </button>
            <TimeReadout store={playback.store} duration={spec.duration} />
          </div>
          <div className="transport">
            <SelectField label="Tempo" value={String(playback.speed) as (typeof SPEEDS)[number][0]} options={SPEEDS} onChange={(v) => playback.setSpeed(Number(v))} />
            <label className="choice">
              <input type="checkbox" checked={range !== null} onChange={(e) => playback.setRange(e.target.checked ? [0.2, 0.6] : null)} />
              Bereich als Schleife
            </label>
            {range !== null && (
              <>
                <NumberField label="Von" value={range[0]} range={[0, 0.99]} step={0.01} onChange={(a) => playback.setRange([a, Math.max(a + 0.01, range[1])])} />
                <NumberField label="Bis" value={range[1]} range={[0.01, 1]} step={0.01} onChange={(b) => playback.setRange([Math.min(range[0], b - 0.01), b])} />
              </>
            )}
          </div>
          <div className="transport">
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
            <label className="choice">
              <input type="checkbox" checked={reducedPreview} onChange={(e) => setReducedPreview(e.target.checked)} />
              „Bewegung reduzieren“ (zeigt, was die App dann zeigt)
            </label>
          </div>
          <div className="transport">
            <button
              type="button"
              className="button small"
              onClick={() => {
                setVariantA(spec);
                setNotice("Aktueller Stand als A gemerkt. Weiter bearbeiten ist B.");
              }}
            >
              Als A merken
            </button>
            <label className="choice">
              <input type="checkbox" checked={compare} disabled={variantA === null} onChange={(e) => setCompare(e.target.checked)} />
              A-B-Vergleich
            </label>
            {variantA !== null && (
              <button type="button" className="button small" onClick={() => change(variantA)}>
                A übernehmen
              </button>
            )}
          </div>
          <p className="muted stats">
            <span className="numeric">{playback.fps > 0 ? `${playback.fps} Bilder/s` : "Pausiert"}</span> ·{" "}
            <span className={cost.level === "ok" ? "numeric" : "numeric cost-warn"}>
              Aufwand {Math.round(cost.cost)} (Warnung ab {COST_LIMITS.soft}, Grenze {COST_LIMITS.hard})
            </span>
            {cost.level === "warn" && " · Hoch: Schwächere Geräte zeigen weniger Funken und Wellen."}
            {cost.level === "over" && " · Zu hoch: So lässt es sich nicht speichern."}
          </p>
        </div>
        <div className="workbench-settings">
          <NumberField label="Dauer des Durchlaufs" unit="Sekunden" value={spec.duration} range={ANIMATION_LIMITS.duration} step={0.5} onChange={(duration) => change({ ...spec, duration })} />
          <NumberField label="Linienstärke" value={spec.strokeWidth} range={ANIMATION_LIMITS.strokeWidth} step={0.1} onChange={(strokeWidth) => change({ ...spec, strokeWidth })} />
          <div className="action-row">
            <button type="button" className="button small" disabled={!canUndo} onClick={onUndo}>
              Rückgängig
            </button>
            <button type="button" className="button small" disabled={!canRedo} onClick={onRedo}>
              Wiederholen
            </button>
            <button
              type="button"
              className="button small"
              disabled={selection.length === 0}
              onClick={() => {
                setClipboard(copyKeyframes(spec, selection));
                setNotice("Kopiert.");
              }}
            >
              Keyframes kopieren
            </button>
            <button type="button" className="button small" disabled={clipboard === null} onClick={() => change(pasteKeyframes(spec, clipboard ?? { items: [] }, track, playback.store.get()))}>
              Beim Abspielkopf einfügen
            </button>
          </div>
          <div className="action-row">
            <SelectField<TrackKind> label="Neue Spur" value={newKind} options={TRACK_KINDS.map((k) => [k, TRACK_LABELS[k]] as const)} onChange={setNewKind} />
            <button
              type="button"
              className="button small"
              disabled={spec.tracks.length >= ANIMATION_LIMITS.tracks}
              onClick={() => {
                const next = addTrack(spec, newKind);
                if (next === null) setNotice(newKind === "dots" ? "Es gibt schon ein Punktraster." : "Höchstens 16 Spuren.");
                else {
                  change(next);
                  setSelectedTrack(next.tracks.length - 1);
                  setSelection([]);
                }
              }}
            >
              Spur hinzufügen
            </button>
          </div>
          <div className="action-row">
            <SelectField label="Zoom" value={zoom as (typeof ZOOMS)[number][0]} options={ZOOMS} onChange={setZoom} />
            <SelectField label="Raster (Einrasten)" value={grid as (typeof GRIDS)[number][0]} options={GRIDS} onChange={setGrid} />
          </div>
          {notice !== null && (
            <p className="muted" role="status">
              {notice}
            </p>
          )}
          <p className="muted">
            Tastatur: Tab wechselt die Spur; ←/→ verschiebt ausgewählte Keyframes (Umschalt: 10-fach), ↑/↓ ändert den Wert, Alt+←/→ oder [ ] wählt den
            vorigen/nächsten, Enter legt einen beim Abspielkopf an, Entf löscht, Strg+C/V kopiert und fügt ein, Strg+Z/Y macht rückgängig und wiederholt,
            Leertaste spielt ab oder pausiert. Im Lineal: ←/→ ein Bild, Bild↑/↓ 10 %.
          </p>
        </div>
      </div>

      <div className="workbench-main">
        <Timeline
          spec={spec}
          selectedTrack={track}
          selection={selection}
          onSelectTrack={(i) => {
            setSelectedTrack(i);
            setSelection((cur) => cur.filter((r) => r.track === i));
          }}
          onSelect={setSelection}
          onChange={change}
          store={playback.store}
          onScrub={() => playback.setPlaying(false)}
          range={range}
          zoom={Number(zoom)}
          grid={Number(grid)}
          duration={spec.duration}
          solo={solo}
          onSolo={setSolo}
          onToggleMute={(i) => change(updateTrack(spec, i, { enabled: !(spec.tracks[i]?.enabled ?? true) }))}
          onMove={(i, to) => {
            change(moveTrack(spec, i, to));
            setSelectedTrack(to);
            setSelection([]);
            setSolo(null);
          }}
          onDuplicate={(i) => {
            const next = duplicateTrack(spec, i);
            if (next === null) setNotice("Diese Spur lässt sich nicht duplizieren (höchstens 16 Spuren, ein Punktraster).");
            else change(next);
          }}
          onDelete={(i) => {
            change(deleteTrack(spec, i));
            setSelectedTrack(Math.max(0, i - 1));
            setSelection([]);
            setSolo(null);
          }}
        />
        <TrackPanel spec={spec} logo={logo} trackIndex={track} selection={selection} onChange={(next) => change(next)} onHighlight={setHighlight} />
      </div>
    </div>
  );
}
