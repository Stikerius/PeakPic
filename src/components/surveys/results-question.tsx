import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

import type { SnapshotQuestion } from "../../../shared/surveys";
import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { makeStyles, useTheme } from "@/lib/theme";

const BAR_HEIGHT = 12;

/** "42 %" with at most one decimal (Swiss style like the dashboard: 12.5 %). */
export function percentText(percent: number): string {
  return `${Math.round(percent * 10) / 10} %`;
}

/** What VoiceOver reads for the bars, and the table as text. */
export function chartDescription(question: SnapshotQuestion): string {
  return question.options.map((o) => `${o.label}: ${percentText(o.percent)}, ${o.count}`).join("; ");
}

/**
 * One question of a published summary: bars from the snapshot (never computed live), mean,
 * median and NPS when the summary has them, chosen quotes. "Als Tabelle" shows the same numbers
 * as a table.
 */
export function ResultsQuestion({ question, index }: { question: SnapshotQuestion; index: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [table, setTable] = useState(false);
  const figures = [
    question.mean !== null ? `Mittelwert ${Math.round(question.mean * 10) / 10}` : null,
    question.median !== null ? `Median ${question.median}` : null,
    question.nps !== null ? `NPS ${Math.round(question.nps)}` : null,
  ].filter((x): x is string => x !== null);

  return (
    <View style={styles.block}>
      <Text style={styles.prompt} accessibilityRole="header">
        {index + 1}. {question.prompt}
      </Text>
      <Text style={styles.meta}>{question.answered} Antworten</Text>

      {question.options.length > 0 && !table && (
        <View accessible accessibilityLabel={chartDescription(question)} style={styles.bars}>
          {question.options.map((o, i) => (
            <View key={i} style={styles.barRow}>
              <View style={styles.barLabels}>
                <Text style={styles.label} numberOfLines={2}>
                  {o.label}
                </Text>
                <Text style={styles.value}>{percentText(o.percent)}</Text>
              </View>
              <Svg width="100%" height={BAR_HEIGHT}>
                <Rect x={0} y={0} width="100%" height={BAR_HEIGHT} rx={radius.sm / 2} fill={colors.surfaceRaised} />
                <Rect x={0} y={0} width={`${Math.max(0, Math.min(100, o.percent))}%`} height={BAR_HEIGHT} rx={radius.sm / 2} fill={colors.accent} />
              </Svg>
            </View>
          ))}
        </View>
      )}

      {question.options.length > 0 && table && (
        <View style={styles.table} accessibilityRole="list">
          <View style={styles.tableRow}>
            <Text style={[styles.cell, styles.cellLabel, styles.head]}>Antwort</Text>
            <Text style={[styles.cell, styles.head]}>Anzahl</Text>
            <Text style={[styles.cell, styles.head]}>Anteil</Text>
          </View>
          {question.options.map((o, i) => (
            <View key={i} style={styles.tableRow} accessible accessibilityLabel={`${o.label}: ${o.count}, ${percentText(o.percent)}`}>
              <Text style={[styles.cell, styles.cellLabel]}>{o.label}</Text>
              <Text style={[styles.cell, styles.number]}>{o.count}</Text>
              <Text style={[styles.cell, styles.number]}>{percentText(o.percent)}</Text>
            </View>
          ))}
        </View>
      )}

      {question.options.length > 0 && (
        <Button label={table ? "Als Diagramm" : "Als Tabelle"} variant="ghost" size="sm" onPress={() => setTable(!table)} />
      )}

      {figures.length > 0 && <Text style={styles.meta}>{figures.join(" · ")}</Text>}

      {question.quotes.length > 0 && (
        <View style={styles.quotes}>
          {question.quotes.map((q, i) => (
            <Text key={i} style={styles.quote}>
              „{q}“
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    block: {
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    prompt: {
      ...typography.bodyStrong,
      color: colors.text,
    },
    meta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    bars: {
      gap: spacing.ms,
    },
    barRow: {
      gap: spacing.xs,
    },
    barLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    label: {
      ...typography.body,
      color: colors.text,
      flex: 1,
    },
    value: {
      ...typography.body,
      ...typography.numeric,
      color: colors.text,
    },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.sm,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    cell: {
      ...typography.caption,
      color: colors.text,
      padding: spacing.sm,
      width: 72,
      textAlign: "right",
    },
    cellLabel: {
      flex: 1,
      width: undefined,
      textAlign: "left",
    },
    head: {
      fontWeight: "600",
      color: colors.textSecondary,
    },
    number: {
      ...typography.numeric,
    },
    quotes: {
      gap: spacing.xs,
    },
    quote: {
      ...typography.body,
      color: colors.textSecondary,
      fontStyle: "italic",
    },
  }),
);
