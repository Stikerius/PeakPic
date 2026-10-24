import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/** One block of log lines, 96 units high; two blocks stacked loop seamlessly when moved by 96. */
const LINES: readonly number[] = [64, 40, 88, 52, 72, 36, 80, 58];

function Column({ x }: { x: number }) {
  const rows: { y: number; w: number }[] = [];
  for (let block = 0; block < 11; block += 1) {
    LINES.forEach((w, i) => rows.push({ y: block * 96 + i * 12, w }));
  }
  return (
    <g>
      {rows.map(({ y, w }) => (
        <rect key={y} className="amb-bar" x={x} y={y} width={w} height="2" rx="1" />
      ))}
    </g>
  );
}

/** Audit-Log: barely visible log lines running upwards in the margins, like a protocol. */
export function Ledger({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <g className="amb-scroll">
        <Column x={24} />
        <g className="amb-secondary">
          <Column x={1330} />
        </g>
      </g>
    </svg>
  );
}
