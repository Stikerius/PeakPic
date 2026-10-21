import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import type { TrainingPlan } from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";

type PlanSummaryProps = {
  plan: TrainingPlan;
  /** Index of the unit that is due next; highlighted (own profile only). */
  nextIndex?: number | null;
};

/** The training plan in the profile: one line, expands to the units in cycle order. */
export function PlanSummary({ plan, nextIndex = null }: PlanSummaryProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const next = nextIndex !== null ? plan.days[nextIndex] : undefined;
  const count = plan.days.length;

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    setOpen((value) => !value);
  }

  return (
    <View style={styles.container}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Trainingsplan ${plan.name}, ${count} Einheiten${next !== undefined ? `, als Nächstes ${next.title}` : ""}`}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons name="list-outline" size={20} color={colors.textSecondary} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {plan.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {count === 1 ? "1 Einheit" : `${count} Einheiten`} im Zyklus
            {next !== undefined ? ` · Als Nächstes: ${next.title}` : ""}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textTertiary} />
      </Pressable>
      {open && (
        <View style={styles.days}>
          {plan.days.map((day, index) => {
            const isNext = index === nextIndex;
            return (
              <View key={day.id} style={[styles.day, isNext && styles.dayNext]}>
                <Text style={[styles.position, isNext && styles.positionNext]}>{index + 1}</Text>
                <View style={styles.dayText}>
                  <Text style={styles.dayTitle}>
                    {day.title}
                    {isNext && <Text style={styles.nextLabel}> · Als Nächstes</Text>}
                  </Text>
                  {day.notes !== null && <Text style={styles.notes}>{day.notes}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    header: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pressed: {
      backgroundColor: colors.surfaceRaised,
    },
    headerText: {
      flex: 1,
    },
    title: {
      ...typography.body,
      fontWeight: "600",
      color: colors.text,
    },
    subtitle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    days: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      paddingVertical: spacing.xs,
    },
    day: {
      flexDirection: "row",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    dayNext: {
      backgroundColor: colors.accentSoft,
    },
    position: {
      ...typography.caption,
      ...typography.numeric,
      width: 20,
      textAlign: "right",
      color: colors.textTertiary,
    },
    positionNext: {
      color: colors.accent,
      fontWeight: "600",
    },
    dayText: {
      flex: 1,
      gap: 2,
    },
    dayTitle: {
      ...typography.body,
      color: colors.text,
    },
    nextLabel: {
      ...typography.caption,
      color: colors.accent,
    },
    notes: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
