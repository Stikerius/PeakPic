import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/** Warteschlange: a thin, slowly turning radar sector at the right edge with faint echoes. */
export function Radar({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMaxYMid slice">
      <g className="amb-radar">
        <circle cx="1440" cy="450" r="140" />
        <circle cx="1440" cy="450" r="280" />
        <circle cx="1440" cy="450" r="420" />
        <g className="amb-spin">
          <path className="amb-sector" d="M1440 450L1020 450A420 420 0 0 1 1076 240Z" />
        </g>
        <g className="amb-secondary">
          <circle className="amb-echo" cx="1180" cy="330" r="4" />
          <circle className="amb-echo amb-echo-2" cx="1260" cy="620" r="4" />
          <circle className="amb-echo amb-echo-3" cx="1110" cy="520" r="4" />
        </g>
      </g>
    </svg>
  );
}
