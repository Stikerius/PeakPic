import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/** Text lines of a page; the block is 168 units high and repeats, so moving by 168 loops. */
const WIDTHS: readonly number[] = [180, 210, 150, 196, 120, 204, 170];

function Sheet({ x }: { x: number }) {
  const rows: { y: number; w: number }[] = [];
  for (let block = 0; block < 7; block += 1) {
    WIDTHS.forEach((w, i) => rows.push({ y: block * 168 + i * 24, w }));
  }
  return (
    <g>
      {rows.map(({ y, w }) => (
        <rect key={y} className="amb-bar" x={x} y={y} width={w} height="3" rx="1.5" />
      ))}
    </g>
  );
}

/** Rechtstexte: quietly wandering lines of text, like paper. */
export function Paper({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <g className="amb-scroll amb-scroll-slow">
        <Sheet x={36} />
        <g className="amb-secondary">
          <Sheet x={1210} />
        </g>
      </g>
    </svg>
  );
}
