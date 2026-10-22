import type { SeriesPoint, StatsBucket } from "../lib/api";
import { bucketLabel } from "../lib/period";

const WIDTH = 560;
const HEIGHT = 160;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

const numberFormat = new Intl.NumberFormat("de-CH");

/** Rounded maximum for the y axis (1, 2, 5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((f) => f * power >= value) ?? 10;
  return step * power;
}

/** Line chart drawn as plain SVG (no library, no inline styles: colours come from CSS classes). */
export function LineChart({ title, points, bucket }: { title: string; points: SeriesPoint[]; bucket: StatsBucket }) {
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="muted numeric">{numberFormat.format(total)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}: ${numberFormat.format(total)} im Zeitraum`}>
        <line className="chart-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(max)} y2={y(max)} />
        <line className="chart-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(max / 2)} y2={y(max / 2)} />
        <line className="chart-axis" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} />
        <text className="chart-label" x={PAD.left - 6} y={y(max) + 4} textAnchor="end">
          {numberFormat.format(max)}
        </text>
        <text className="chart-label" x={PAD.left - 6} y={y(0) + 4} textAnchor="end">
          0
        </text>
        {first !== undefined && last !== undefined && (
          <>
            <text className="chart-label" x={x(0)} y={HEIGHT - 6} textAnchor="start">
              {bucketLabel(first.bucket, bucket)}
            </text>
            {points.length > 1 && (
              <text className="chart-label" x={x(points.length - 1)} y={HEIGHT - 6} textAnchor="end">
                {bucketLabel(last.bucket, bucket)}
              </text>
            )}
            <path className="chart-line" d={path} />
            {points.length <= 31 &&
              points.map((p, i) => (
                <circle key={p.bucket} className="chart-dot" cx={x(i)} cy={y(p.value)} r={2.5}>
                  <title>{`${bucketLabel(p.bucket, bucket)}: ${numberFormat.format(p.value)}`}</title>
                </circle>
              ))}
          </>
        )}
      </svg>
    </figure>
  );
}

export type BarRow = { label: string; value: number };

/** Horizontal bars with share in percent (SVG). */
export function BarChart({ rows }: { rows: BarRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowHeight = 26;
  const labelW = 130;
  const barW = WIDTH - labelW - 90;
  const height = rows.length * rowHeight + 4;
  return (
    <svg className="bars" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Nutzung nach Bereich">
      {rows.map((row, i) => {
        const share = total === 0 ? 0 : Math.round((row.value / total) * 100);
        const yTop = i * rowHeight + 4;
        return (
          <g key={row.label}>
            <text className="chart-label strong" x={0} y={yTop + 14}>
              {row.label}
            </text>
            <rect className="bar-track" x={labelW} y={yTop + 3} width={barW} height={14} rx={3} />
            <rect className="bar" x={labelW} y={yTop + 3} width={Math.max(row.value > 0 ? 2 : 0, (row.value / max) * barW)} height={14} rx={3} />
            <text className="chart-label" x={WIDTH} y={yTop + 14} textAnchor="end">
              {`${share} % · ${numberFormat.format(row.value)}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
