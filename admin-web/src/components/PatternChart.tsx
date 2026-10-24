import { useId } from "react";

/** Patterns laid over chart colours, so series never differ by colour alone. */
const PATTERNS: readonly (readonly string[])[] = [
  [],
  ["M0 8L8 0"],
  ["M0 4H8"],
  ["M4 0V8"],
  ["M0 0L8 8", "M0 8L8 0"],
  ["M2 2h.01", "M6 6h.01"],
  ["M0 8L8 0", "M-2 2L2 -2", "M6 10L10 6"],
  ["M0 2H8", "M0 6H8"],
];

export type ChartValue = { label: string; value: number };

/**
 * Horizontal bars in the chart tokens (--chart-1 … --chart-8) with a pattern per series and the
 * value written next to each bar; a table with the same numbers is available on request. Own SVG,
 * no library.
 */
export function PatternChart({ values, title, showTable = false }: { values: readonly ChartValue[]; title: string; showTable?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const max = Math.max(1, ...values.map((v) => v.value));
  const row = 28;
  const height = values.length * row + 4;
  return (
    <figure className="pattern-chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 320 ${height}`} role="img" aria-label={`${title}: ${values.map((v) => `${v.label} ${v.value}`).join(", ")}`}>
        <defs>
          {PATTERNS.map((paths, i) => (
            <pattern key={i} id={`${id}-p${i}`} patternUnits="userSpaceOnUse" width="8" height="8">
              {paths.map((d) => (
                <path key={d} d={d} className="pattern-stroke" />
              ))}
            </pattern>
          ))}
        </defs>
        {values.map((v, i) => {
          const width = Math.max(2, (v.value / max) * 190);
          const y = i * row + 4;
          return (
            <g key={v.label}>
              <text className="chart-label" x="0" y={y + 15}>
                {v.label}
              </text>
              <rect className={`chart-fill-${(i % 8) + 1}`} x="96" y={y} width={width} height="20" rx="3" />
              <rect x="96" y={y} width={width} height="20" rx="3" fill={`url(#${id}-p${i % PATTERNS.length})`} />
              <text className="chart-label strong" x={100 + width} y={y + 15}>
                {v.value}
              </text>
            </g>
          );
        })}
      </svg>
      {showTable && (
        <table className="table compact">
          <thead>
            <tr>
              <th>Wert</th>
              <th className="numeric">Anzahl</th>
            </tr>
          </thead>
          <tbody>
            {values.map((v) => (
              <tr key={v.label}>
                <td>{v.label}</td>
                <td className="numeric">{v.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
