import { useId } from "react";

import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/** Logos and Design: a calm dot raster without motion, so the previews stay in focus. */
export function Dots({ active, reducedMotion }: AmbientProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={`${id}-dots`} patternUnits="userSpaceOnUse" width="24" height="24">
          <circle className="amb-dot" cx="12" cy="12" r="1.2" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="1440" height="900" fill={`url(#${id}-dots)`} />
    </svg>
  );
}
