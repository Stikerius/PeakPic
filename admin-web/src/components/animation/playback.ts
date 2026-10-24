import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { Clock } from "../BrandLogo";

export type PlaybackStore = Clock & { set: (position: number) => void };

/** The playhead: a position 0..1 with listeners (no React render per frame). */
export function createPlaybackStore(): PlaybackStore {
  let position = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => position,
    set: (next) => {
      position = Math.min(1, Math.max(0, next));
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Position within the loop range: wraps around inside [start, end). */
export function wrap(position: number, start: number, end: number): number {
  const span = end - start;
  if (span <= 0) return start;
  if (position >= start && position < end) return position;
  return start + ((((position - start) % span) + span) % span);
}

export type Playback = {
  store: PlaybackStore;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  /** Loop range (shares of the loop) or null for the whole loop. */
  range: [number, number] | null;
  setRange: (range: [number, number] | null) => void;
  /** Frames per second of the preview, measured. */
  fps: number;
  /** One frame (1/60 s) forward or back. */
  step: (frames: number) => void;
};

/**
 * Runs the playhead with requestAnimationFrame: tempo 0.25 to 2, a loop range, paused while the
 * tab is hidden; measures the frame rate.
 */
export function usePlayback(duration: number, autoplay: boolean): Playback {
  const store = useMemo(() => createPlaybackStore(), []);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(1);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    let frames = 0;
    let since: number | null = null;
    const [start, end] = range ?? [0, 1];
    const tick = (now: number) => {
      if (last !== null && !document.hidden) {
        const advance = ((now - last) / 1000) * (speed / duration);
        const next = store.get() + advance;
        store.set(range === null && next >= 1 ? next - 1 : wrap(next, start, end));
      }
      last = now;
      frames += 1;
      since ??= now;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, range, duration, store]);

  return {
    store,
    playing,
    setPlaying,
    speed,
    setSpeed,
    range,
    setRange,
    fps: playing ? fps : 0,
    step: (n) => {
      setPlaying(false);
      store.set(store.get() + n / (60 * duration));
    },
  };
}

/** The playhead position for components that show it (re-render only those). */
export function usePosition(store: Clock): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
