import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/**
 * Mitteilungen: a dashed flight path and a small paper plane that crosses it once every few seconds.
 * The path is the same curve the keyframes in styles.css follow (quadratic, sampled every 20 %).
 */
export function Flight({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <path className="amb-dashed" d="M-60 780Q700 80 1500 420" />
      <g className="amb-plane">
        <path className="amb-plane-shape" d="M-16 -8L18 0L-16 8L-10 0Z" />
      </g>
    </svg>
  );
}
