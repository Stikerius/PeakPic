import { STAGE_VIEWBOX, type AmbientProps } from "./types";

/**
 * Nutzer and Konto-Detail: a quiet net of drifting nodes with fine connections. Each cluster moves
 * as one group (transform only), so its lines never have to be recalculated.
 */
const CLUSTERS: readonly { cls: string; nodes: readonly [number, number][] }[] = [
  { cls: "amb-drift amb-drift-a", nodes: [[90, 140], [220, 90], [180, 250], [320, 200]] },
  { cls: "amb-drift amb-drift-b", nodes: [[1180, 120], [1310, 210], [1240, 320], [1380, 90]] },
  { cls: "amb-drift amb-drift-c amb-secondary", nodes: [[80, 700], [210, 780], [160, 620], [300, 840]] },
  { cls: "amb-drift amb-drift-a amb-secondary", nodes: [[1170, 760], [1300, 690], [1360, 830], [1220, 860]] },
];

export function Network({ active, reducedMotion }: AmbientProps) {
  return (
    <svg data-still={active && !reducedMotion ? undefined : "true"} viewBox={STAGE_VIEWBOX} preserveAspectRatio="xMidYMid slice">
      {CLUSTERS.map(({ cls, nodes }, c) => (
        <g key={c} className={cls}>
          {nodes.slice(1).map(([x, y], i) => {
            const [px, py] = nodes[i] ?? [x, y];
            return <line key={`l${i}`} x1={px} y1={py} x2={x} y2={y} />;
          })}
          {nodes.map(([x, y], i) => (
            <circle key={`n${i}`} className="amb-node" cx={x} cy={y} r="4" />
          ))}
        </g>
      ))}
    </svg>
  );
}
