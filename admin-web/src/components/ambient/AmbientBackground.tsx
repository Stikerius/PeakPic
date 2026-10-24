import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";

import { Contours } from "./Contours";
import { Dots } from "./Dots";
import { Flight } from "./Flight";
import { Hazard } from "./Hazard";
import { Ledger } from "./Ledger";
import { Network } from "./Network";
import { Paper } from "./Paper";
import { Radar } from "./Radar";
import { Streams } from "./Streams";
import type { AmbientProps } from "./types";
import { useReducedMotion } from "../BrandLogo";
import { WATCH_FRAMES, ambientFor, ambientState, tooSlow, type AmbientVariant } from "../../lib/ambient";
import { useAppearance } from "../../lib/appearanceContext";
import type { Route } from "../../lib/router";

const VARIANTS: Record<Exclude<AmbientVariant, "still">, ComponentType<AmbientProps>> = {
  contours: Contours,
  radar: Radar,
  network: Network,
  streams: Streams,
  ledger: Ledger,
  paper: Paper,
  flight: Flight,
  hazard: Hazard,
  dots: Dots,
};

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * One fixed layer behind the content with the page's background animation. Never interactive
 * (aria-hidden, no focus, no pointer events), at most 0.18 opacity, paused while the tab is hidden,
 * a still image with "reduce motion" or "Ruhig", nothing with "Aus". If the first frames are slow,
 * it drops to the simpler level (fewer layers).
 */
export function AmbientBackground({ route }: { route: Route }) {
  const { appearance, mode } = useAppearance();
  const reducedMotion = useReducedMotion();
  const hidden = useSyncExternalStore(subscribeVisibility, () => document.hidden, () => false);
  const variant = ambientFor(route);
  const [slow, setSlow] = useState(false);
  const state = ambientState({ setting: appearance.ambient, variant, reducedMotion, hidden, slow });

  // Frame watch: one window of frames while moving; afterwards no more work per frame.
  useEffect(() => {
    if (!state.moving || slow) return;
    const times: number[] = [];
    let last: number | null = null;
    let raf = requestAnimationFrame(function tick(now) {
      if (last !== null) times.push(now - last);
      last = now;
      if (times.length >= WATCH_FRAMES) {
        if (tooSlow(times)) setSlow(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [state.moving, slow, variant]);

  if (!state.render || variant === "still") return null;
  const Variant = VARIANTS[variant];
  return (
    <div className="ambient" data-variant={variant} data-moving={state.moving ? "true" : "false"} data-level={state.level} aria-hidden="true">
      <Variant active={state.moving} mode={mode} palette={appearance.palette} reducedMotion={reducedMotion} />
    </div>
  );
}
