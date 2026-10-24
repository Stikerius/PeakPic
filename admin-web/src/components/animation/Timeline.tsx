import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { formatNumber } from "./fields";
import type { PlaybackStore } from "./playback";
import { addKeyframe, moveKeyframes, setKeyframe, snapTime, trackLabel, type KeyRef } from "../../lib/animationEditor";
import { TRACK_LABELS, VALUE_RANGES, keyframeValue, type AnimationSpec, type Track } from "../../lib/brand";

export type TimelineProps = {
  spec: AnimationSpec;
  selectedTrack: number;
  selection: KeyRef[];
  onSelectTrack: (index: number) => void;
  onSelect: (refs: KeyRef[]) => void;
  /** `commit` false while dragging (no history step yet). */
  onChange: (spec: AnimationSpec, commit: boolean) => void;
  store: PlaybackStore;
  onScrub: () => void;
  range: [number, number] | null;
  zoom: number;
  grid: number;
  duration: number;
  solo: number | null;
  onSolo: (index: number | null) => void;
  onToggleMute: (index: number) => void;
  onMove: (index: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
};

const percent = (t: number) => `${(t * 100).toFixed(3)}%`;

/** The value curve of a track as a path in a 1000 x 100 box (for the lane's background). */
function valuePath(track: Track): string {
  const [min, max] = VALUE_RANGES[track.kind];
  const points = Array.from({ length: 101 }, (_, i) => {
    const v = keyframeValue(track.keyframes, i / 100);
    const y = 90 - ((v - min) / (max - min)) * 80;
    return `${i === 0 ? "M" : "L"}${i * 10} ${y.toFixed(1)}`;
  });
  return points.join(" ");
}

/** Text of the selection in a track, for screen readers and the status line. */
function selectionText(spec: AnimationSpec, selection: KeyRef[], track: number): string {
  const refs = selection.filter((r) => r.track === track);
  const t = spec.tracks[track];
  if (t === undefined) return "";
  const count = `${t.keyframes.length} Keyframes`;
  if (refs.length === 0) return `${count}, keiner ausgewählt`;
  if (refs.length > 1) return `${count}, ${refs.length} ausgewählt`;
  const ref = refs[0];
  const k = ref !== undefined ? t.keyframes[ref.key] : undefined;
  if (ref === undefined || k === undefined) return count;
  return `${count}, ausgewählt: Keyframe ${ref.key + 1} bei ${formatNumber(k.t * 100, 1)} %, Wert ${formatNumber(k.v, 3)}`;
}

function Playhead({ store }: { store: PlaybackStore }) {
  const line = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const update = () => line.current?.setAttribute("x", percent(store.get()));
    update();
    return store.subscribe(update);
  }, [store]);
  return (
    <svg ref={line} className="timeline-playhead" x="0%" y="0" overflow="visible">
      <line x1="0" y1="0" x2="0" y2="100%" />
    </svg>
  );
}

/**
 * Tracks with their keyframes on a time ruler. Mouse: drag keyframes (Shift adds to the
 * selection), double-click a lane to add one, drag on the ruler to scrub. Keyboard (each lane is
 * one tab stop): arrows left/right move the selected keyframes (Shift: 10 times), up/down change
 * the value, Alt+arrows or [ ] pick the previous/next keyframe, Enter adds one at the playhead,
 * Delete removes, Ctrl+C/V copy and paste.
 */
export function Timeline(props: TimelineProps) {
  const { spec, selectedTrack, selection, onSelectTrack, onSelect, onChange, store, onScrub, range, zoom, grid, duration, solo } = props;
  const ruler = useRef<SVGSVGElement>(null);
  const width = `${zoom * 100}%`;
  const step = grid > 0 ? grid : 0.01;

  // The ruler's value for screen readers follows the playhead without rendering the timeline.
  useEffect(() => {
    const update = () => {
      const p = store.get();
      ruler.current?.setAttribute("aria-valuenow", String(Math.round(p * 100)));
      ruler.current?.setAttribute("aria-valuetext", `${formatNumber(p * duration, 2)} Sekunden, ${formatNumber(p * 100, 1)} %`);
    };
    update();
    return store.subscribe(update);
  }, [store, duration]);

  function scrubFrom(event: PointerEvent<SVGSVGElement>) {
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    onScrub();
    const at = (x: number) => {
      const box = el.getBoundingClientRect();
      store.set((x - box.left) / box.width);
    };
    at(event.clientX);
    const move = (e: globalThis.PointerEvent) => at(e.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function rulerKeys(event: KeyboardEvent) {
    const frame = 1 / (60 * duration);
    const moves: Record<string, number> = { ArrowLeft: -frame, ArrowRight: frame, PageDown: -0.1, PageUp: 0.1 };
    let next: number | null = null;
    if (event.key in moves) next = store.get() + (moves[event.key] ?? 0) * (event.shiftKey ? 10 : 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = 1;
    if (next === null) return;
    event.preventDefault();
    onScrub();
    store.set(next);
  }

  function dragKeyframe(track: number, key: number, lane: SVGSVGElement) {
    return (event: PointerEvent<SVGElement>) => {
      event.stopPropagation();
      onSelectTrack(track);
      const isSelected = selection.some((r) => r.track === track && r.key === key);
      const refs = event.shiftKey
        ? isSelected
          ? selection.filter((r) => !(r.track === track && r.key === key))
          : [...selection, { track, key }]
        : isSelected
          ? selection
          : [{ track, key }];
      onSelect(refs);
      if (event.shiftKey) return;
      const base = spec;
      const startX = event.clientX;
      let last: AnimationSpec | null = null;
      lane.setPointerCapture(event.pointerId);
      const move = (e: globalThis.PointerEvent) => {
        const box = lane.getBoundingClientRect();
        const moved = moveKeyframes(base, refs, (e.clientX - startX) / box.width, grid);
        last = moved.spec;
        onChange(moved.spec, false);
        onSelect(moved.refs);
      };
      const up = () => {
        lane.removeEventListener("pointermove", move);
        lane.removeEventListener("pointerup", up);
        if (last !== null) onChange(last, true);
      };
      lane.addEventListener("pointermove", move);
      lane.addEventListener("pointerup", up);
    };
  }

  function laneKeys(track: number) {
    return (event: KeyboardEvent) => {
      const t = spec.tracks[track];
      if (t === undefined) return;
      const mine = selection.filter((r) => r.track === track);
      const big = event.shiftKey ? 10 : 1;
      const pickNext = (dir: number) => {
        const current = mine[mine.length - 1]?.key ?? (dir > 0 ? -1 : t.keyframes.length);
        const next = Math.min(t.keyframes.length - 1, Math.max(0, current + dir));
        onSelect([{ track, key: next }]);
      };
      if ((event.altKey && event.key === "ArrowLeft") || event.key === "[") {
        event.preventDefault();
        pickNext(-1);
      } else if ((event.altKey && event.key === "ArrowRight") || event.key === "]") {
        event.preventDefault();
        pickNext(1);
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && mine.length > 0) {
        event.preventDefault();
        const moved = moveKeyframes(spec, mine, (event.key === "ArrowLeft" ? -step : step) * big, grid);
        onChange(moved.spec, true);
        onSelect(moved.refs);
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && mine.length > 0) {
        event.preventDefault();
        const [min, max] = VALUE_RANGES[t.kind];
        const delta = ((max - min) / 100) * big * (event.key === "ArrowUp" ? 1 : -1);
        let next = spec;
        for (const r of mine) next = setKeyframe(next, r, { v: (t.keyframes[r.key]?.v ?? 0) + delta });
        onChange(next, true);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const added = addKeyframe(spec, track, snapTime(store.get(), grid));
        if (added !== null) {
          onChange(added.spec, true);
          onSelect([added.ref]);
        }
      }
    };
  }

  return (
    <div className="timeline">
      <div className="timeline-heads">
        <div className="timeline-head ruler-head">Zeit</div>
        {spec.tracks.map((track, i) => (
          <div key={i} className={i === selectedTrack ? "timeline-head selected" : "timeline-head"}>
            <button type="button" className="track-name" aria-pressed={i === selectedTrack} onClick={() => onSelectTrack(i)} title={trackLabel(track, i)}>
              <span className="numeric">{i + 1}</span> {TRACK_LABELS[track.kind]}
              {!track.enabled && <span className="pill">stumm</span>}
              {solo === i && <span className="pill">solo</span>}
            </button>
            <span className="track-tools">
              <button type="button" className="icon-button" aria-pressed={solo === i} aria-label={`Solo ${trackLabel(track, i)}`} onClick={() => props.onSolo(solo === i ? null : i)}>
                S
              </button>
              <button type="button" className="icon-button" aria-pressed={!track.enabled} aria-label={`Stumm ${trackLabel(track, i)}`} onClick={() => props.onToggleMute(i)}>
                M
              </button>
              <button type="button" className="icon-button" aria-label={`Spur ${i + 1} nach oben`} disabled={i === 0} onClick={() => props.onMove(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="icon-button" aria-label={`Spur ${i + 1} nach unten`} disabled={i === spec.tracks.length - 1} onClick={() => props.onMove(i, i + 1)}>
                ↓
              </button>
              <button type="button" className="icon-button" aria-label={`Spur ${i + 1} duplizieren`} onClick={() => props.onDuplicate(i)}>
                ⧉
              </button>
              <button type="button" className="icon-button" aria-label={`Spur ${i + 1} löschen`} disabled={spec.tracks.length <= 1} onClick={() => props.onDelete(i)}>
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="timeline-scroll">
        <svg
          ref={ruler}
          className="timeline-ruler"
          width={width}
          height="32"
          role="slider"
          tabIndex={0}
          aria-label="Abspielkopf"
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={scrubFrom}
          onKeyDown={rulerKeys}
        >
          {range !== null && <rect className="timeline-range" x={percent(range[0])} y="0" width={percent(range[1] - range[0])} height="32" />}
          {Array.from({ length: 21 }, (_, i) => (
            <g key={i}>
              <line className={i % 2 === 0 ? "tick major" : "tick"} x1={percent(i / 20)} x2={percent(i / 20)} y1={i % 2 === 0 ? 14 : 22} y2="32" />
              {i % 2 === 0 && (
                <text className="tick-label" x={percent(i / 20)} y="11">
                  {formatNumber((i / 20) * duration, 1)} s
                </text>
              )}
            </g>
          ))}
          {grid > 0 &&
            Array.from({ length: Math.round(1 / grid) + 1 }, (_, i) => <line key={`g${i}`} className="tick grid" x1={percent(i * grid)} x2={percent(i * grid)} y1="28" y2="32" />)}
          <Playhead store={store} />
        </svg>
        {spec.tracks.map((track, ti) => (
          <Lane
            key={ti}
            track={track}
            index={ti}
            width={width}
            selected={ti === selectedTrack}
            selection={selection}
            label={`${trackLabel(track, ti)}. ${selectionText(spec, selection, ti)}`}
            grid={grid}
            store={store}
            onFocus={() => onSelectTrack(ti)}
            onKeyDown={laneKeys(ti)}
            dragKeyframe={(key, lane) => dragKeyframe(ti, key, lane)}
            onAdd={(t) => {
              const added = addKeyframe(spec, ti, snapTime(t, grid));
              if (added !== null) {
                onChange(added.spec, true);
                onSelect([added.ref]);
              }
            }}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {selectionText(spec, selection, selectedTrack)}
      </p>
    </div>
  );
}

function Lane({
  track,
  index,
  width,
  selected,
  selection,
  label,
  grid,
  store,
  onFocus,
  onKeyDown,
  dragKeyframe,
  onAdd,
}: {
  track: Track;
  index: number;
  width: string;
  selected: boolean;
  selection: KeyRef[];
  label: string;
  grid: number;
  store: PlaybackStore;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  dragKeyframe: (key: number, lane: SVGSVGElement) => (event: PointerEvent<SVGElement>) => void;
  onAdd: (t: number) => void;
}) {
  const lane = useRef<SVGSVGElement>(null);
  const curve = useMemo(() => valuePath(track), [track]);
  return (
    <div className={selected ? "timeline-lane selected" : "timeline-lane"} tabIndex={0} role="group" aria-label={label} onFocus={onFocus} onKeyDown={onKeyDown}>
      <svg
        ref={lane}
        width={width}
        height="36"
        className={track.enabled ? "lane-svg" : "lane-svg muted-lane"}
        onDoubleClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onAdd((e.clientX - box.left) / box.width);
        }}
      >
        {grid > 0 &&
          Array.from({ length: Math.round(1 / grid) + 1 }, (_, i) => <line key={i} className="lane-grid" x1={percent(i * grid)} x2={percent(i * grid)} y1="0" y2="36" />)}
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="36">
          <path className="lane-curve" d={curve} vectorEffect="non-scaling-stroke" />
        </svg>
        {track.keyframes.map((k, ki) => {
          const isSel = selection.some((r) => r.track === index && r.key === ki);
          return (
            <svg key={ki} x={percent(k.t)} y="18" overflow="visible">
              <path
                className={isSel ? "keyframe selected" : "keyframe"}
                d={isSel ? "M0 -9 L9 0 L0 9 L-9 0Z" : "M0 -7 L7 0 L0 7 L-7 0Z"}
                onPointerDown={(e) => {
                  if (lane.current !== null) dragKeyframe(ki, lane.current)(e);
                }}
              >
                <title>{`Keyframe ${ki + 1}: ${formatNumber(k.t * 100, 1)} %, Wert ${formatNumber(k.v, 3)}`}</title>
              </path>
            </svg>
          );
        })}
        <Playhead store={store} />
      </svg>
    </div>
  );
}
