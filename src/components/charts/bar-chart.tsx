import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

type BarChartProps = {
  data: { key: string; label: string; value: number }[];
  /** Text above a bar, e.g. "3" or "1:20". */
  formatValue: (value: number) => string;
  /** Read by VoiceOver instead of the chart. */
  accessibilityLabel: string;
  height?: number;
};

const VALUE_SPACE = 16;

/** Calm bar chart: neutral bars on a baseline, the value above each bar that isn't zero. */
export function BarChart({ data, formatValue, accessibilityLabel, height = 140 }: BarChartProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const max = Math.max(0, ...data.map((d) => d.value));
  const slot = data.length > 0 ? width / data.length : 0;
  const barWidth = Math.max(2, Math.min(28, slot * 0.6));
  const plotHeight = height - VALUE_SPACE;
  // Every label when there is room, otherwise every second or third.
  const labelEvery = slot >= 34 ? 1 : slot >= 18 ? 2 : 3;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            {data.map((d, index) => {
              const barHeight = max > 0 ? Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (plotHeight - 2)) : 0;
              const x = index * slot + (slot - barWidth) / 2;
              const y = height - barHeight;
              return (
                <Rect key={d.key} x={x} y={y} width={barWidth} height={barHeight} rx={2} fill={colors.textSecondary} />
              );
            })}
            {data.map((d, index) =>
              d.value > 0 && slot >= 18 ? (
                <SvgText
                  key={`v-${d.key}`}
                  x={index * slot + slot / 2}
                  y={height - (max > 0 ? (d.value / max) * (plotHeight - 2) : 0) - 4}
                  fontSize={11}
                  fill={colors.textSecondary}
                  textAnchor="middle"
                >
                  {formatValue(d.value)}
                </SvgText>
              ) : null,
            )}
            <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={colors.border} strokeWidth={1} />
          </Svg>
        )}
      </View>
      <View style={styles.labels}>
        {data.map((d, index) => (
          <Text key={d.key} style={styles.label} numberOfLines={1}>
            {index % labelEvery === 0 ? d.label : ""}
          </Text>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    labels: {
      flexDirection: "row",
      marginTop: spacing.xs,
    },
    label: {
      ...typography.label,
      flex: 1,
      textAlign: "center",
      color: colors.textTertiary,
    },
  }),
);
