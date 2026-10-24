import type { AmbientProps } from "./types";

/** Diagonal stripes 32 units apart (vertically); moving them by 32 loops seamlessly. */
function Stripes({ x }: { x: number }) {
  const stripes: number[] = [];
  for (let y = -96; y < 1000; y += 32) stripes.push(y);
  return (
    <g>
      {stripes.map((y) => (
        <path key={y} className="amb-stripe" d={`M${x} ${y + 24}L${x + 24} ${y}L${x + 36} ${y}L${x} ${y + 36}Z`} />
      ))}
    </g>
  );
}

/**
 * Bereinigung: very muted warning stripes, slowly running, only at the left and right edge. In the
 * palette "Hauptfarbe" with a hint of red (token ambient-alert), in black and white neutral.
 */
export function Hazard({ active, reducedMotion }: AmbientProps) {
  const still = active && !reducedMotion ? undefined : "true";
  // Two narrow strips anchored to the window edges (they must never be cropped away).
  return (
    <>
      <svg data-still={still} className="amb-edge amb-edge-left" viewBox="0 0 36 900" preserveAspectRatio="xMinYMin slice">
        <g className="amb-hazard">
          <Stripes x={0} />
        </g>
      </svg>
      <svg data-still={still} className="amb-edge amb-edge-right" viewBox="0 0 36 900" preserveAspectRatio="xMaxYMin slice">
        <g className="amb-hazard">
          <Stripes x={0} />
        </g>
      </svg>
    </>
  );
}
