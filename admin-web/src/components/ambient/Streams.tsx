import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/** One wave period is 360 units; the path is twice the stage wide, so moving it by one period loops. */
function wave(y: number, amplitude: number): string {
  let d = `M-360 ${y}`;
  for (let x = -360; x < 1800; x += 360) d += ` q90 ${-amplitude} 180 0 t180 0`;
  return d;
}

/** Nutzung: fine wave lines moving slowly sideways, like data streams. */
export function Streams({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <g className="amb-flow">
        <path d={wave(780, 36)} />
        <path className="amb-secondary" d={wave(830, 22)} />
      </g>
      <g className="amb-flow amb-flow-slow">
        <path d={wave(860, 28)} />
        <path className="amb-secondary" d={wave(70, 18)} />
      </g>
    </svg>
  );
}
