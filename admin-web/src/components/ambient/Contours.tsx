import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/** Übersicht: very slowly drifting contour lines and soft pulse rings from the bottom edge. */
export function Contours({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <g className="amb-drift amb-drift-a">
        <path d="M-80 720C160 640 320 760 520 700S860 560 1080 640 1400 780 1560 700" />
        <path d="M-80 770C180 700 340 820 540 760S880 620 1100 700 1420 840 1560 760" />
        <path d="M-80 820C200 760 360 880 560 820S900 680 1120 760 1440 900 1560 820" />
      </g>
      <g className="amb-drift amb-drift-b amb-secondary">
        <path d="M-80 140C200 220 380 90 600 160S960 260 1180 180 1420 90 1560 150" />
        <path d="M-80 90C220 170 400 40 620 110S980 210 1200 130 1440 40 1560 100" />
      </g>
      <g className="amb-pulses">
        <circle className="amb-pulse" cx="720" cy="960" r="140" />
        <circle className="amb-pulse amb-pulse-2" cx="720" cy="960" r="140" />
        <circle className="amb-pulse amb-pulse-3 amb-secondary" cx="720" cy="960" r="140" />
      </g>
    </svg>
  );
}
