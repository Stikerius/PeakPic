import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import type { TrainingPlan } from "@/lib/planRepo";
import type { DayKey } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";

type PlanStreakCardProps = {
  plan: TrainingPlan;
  streak: number;
  /** The plan day due next (cycle index). */
  nextIndex: number;
  /** Already trained today: the next day is for later. */
  trainedToday: boolean;
  /** The planned rest day that can be confirmed now (today or yesterday), if any. */
  restDue: DayKey | null;
  today: DayKey;
  busy?: boolean;
  onConfirmRest: (day: DayKey) => void;
};

/** "Heute dran: Tag X (Titel)" from the active plan, and the plan streak (no flame: a different count). */
export function PlanStreakCard({ plan, streak, nextIndex, trainedToday, restDue, today, busy = false, onConfirmRest }: PlanStreakCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const next = plan.days[nextIndex];
  const days = streak === 1 ? "Tag" : "Tage";
  const lead = trainedToday ? "Als Nächstes" : "Heute dran";
  const dueText =
    next === undefined
      ? null
      : `${lead}: Tag ${nextIndex + 1} von ${plan.days.length} (${next.type === "rest" ? "Ruhetag" : next.title})`;
  const restLabel = restDue === today ? "Ruhetag bestätigen" : "Ruhetag für gestern bestätigen";

  return (
    <View style={styles.card}>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`Plan-Streak ${plan.name}: ${streak} ${days}${dueText !== null ? `. ${dueText}` : ""}`}
      >
        <View style={styles.icon}>
          <Ionicons name={next?.type === "rest" ? "moon-outline" : "list-outline"} size={22} color={colors.textSecondary} />
        </View>
        <View style={styles.text}>
          <Text style={styles.label}>Plan-Streak · {plan.name}</Text>
          {dueText !== null && (
            <Text style={styles.next} numberOfLines={2}>
              {dueText}
            </Text>
          )}
        </View>
        <Text style={styles.value}>
          {streak} <Text style={styles.unit}>{days}</Text>
        </Text>
      </View>
      {restDue !== null && (
        <Button label={restLabel} variant="secondary" size="sm" icon="moon-outline" onPress={() => onConfirmRest(restDue)} loading={busy} />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      gap: spacing.ms,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
    },
    icon: {
      width: 24,
      alignItems: "center",
    },
    text: {
      flex: 1,
      gap: 2,
    },
    label: {
      ...typography.body,
      fontWeight: "600",
      color: colors.text,
    },
    next: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    value: {
      ...typography.heading,
      ...typography.numeric,
      color: colors.text,
    },
    unit: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
