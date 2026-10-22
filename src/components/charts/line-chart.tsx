import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";

import { spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type LineChartProps = {
  points: { key: string; value: number }[];
  formatValue: (value: number) => string;
  /** Labels under the first and the last point. */
  firstLabel: string;
  lastLabel: string;
  accessibilityLabel: string;
  height?: number;
};

const PAD = 6;

/** Calm line chart of one series: a thin line with dots, the lowest and highest value at the side. */
export function LineChart({ points, formatValue, firstLabel, lastLabel, accessibilityLabel, height = 160 }: LineChartProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - PAD * 2) / (points.length - 1) : 0;
  const xy = points.map((p, index) => ({
    key: p.key,
    x: points.length > 1 ? PAD + index * step : width / 2,
    y: max === min ? height / 2 : PAD + (1 - (p.value - min) / span) * (height - PAD * 2),
  }));

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={styles.row}>
        <View style={styles.axis}>
          <Text style={styles.axisText}>{formatValue(max)}</Text>
          {max !== min && <Text style={styles.axisText}>{formatValue(min)}</Text>}
        </View>
        <View style={[styles.plot, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && (
            <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
              <Line x1={0} x2={width} y1={PAD} y2={PAD} stroke={colors.divider} strokeWidth={1} />
              <Line x1={0} x2={width} y1={height - PAD} y2={height - PAD} stroke={colors.divider} strokeWidth={1} />
              {xy.length > 1 && (
                <Polyline
                  points={xy.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={colors.text}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {xy.map((p) => (
                <Circle key={p.key} cx={p.x} cy={p.y} r={xy.length > 30 ? 2 : 3} fill={colors.text} />
              ))}
            </Svg>
          )}
        </View>
      </View>
      <View style={styles.labels}>
        <Text style={styles.axisText}>{firstLabel}</Text>
        {points.length > 1 && <Text style={styles.axisText}>{lastLabel}</Text>}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    axis: {
      justifyContent: "space-between",
      alignItems: "flex-end",
      minWidth: 40,
    },
    axisText: {
      ...typography.label,
      ...typography.numeric,
      color: colors.textTertiary,
    },
    plot: {
      flex: 1,
    },
    labels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: spacing.xs,
      paddingLeft: 40 + spacing.sm,
    },
  }),
);
