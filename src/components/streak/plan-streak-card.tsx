import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import type { TrainingPlan } from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";

type PlanStreakCardProps = {
  plan: TrainingPlan;
  streak: number;
  nextIndex: number;
};

/** The plan streak, kept apart from the normal streak (no flame: it's a different count). */
export function PlanStreakCard({ plan, streak, nextIndex }: PlanStreakCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const next = plan.days[nextIndex];
  const days = streak === 1 ? "Tag" : "Tage";
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Plan-Streak: ${streak} ${days}${next !== undefined ? `. Als Nächstes: ${next.title}` : ""}`}
    >
      <View style={styles.icon}>
        <Ionicons name="list-outline" size={22} color={colors.textSecondary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>Plan-Streak · {plan.name}</Text>
        {next !== undefined && (
          <Text style={styles.next} numberOfLines={1}>
            Als Nächstes: {next.title} (Einheit {nextIndex + 1} von {plan.days.length})
          </Text>
        )}
      </View>
      <Text style={styles.value}>
        {streak} <Text style={styles.unit}>{days}</Text>
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
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
