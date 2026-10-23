import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { exerciseSummary } from "@/lib/planDraft";
import type { TrainingPlan } from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";

type PlanSummaryProps = {
  plan: TrainingPlan;
  /** Index of the unit that is due next; highlighted (own profile only). */
  nextIndex?: number | null;
  /** Someone else's plan: "Plan übernehmen" (only if the owner allows it). */
  onAdopt?: () => void;
  /** Someone else's plan: report it. */
  onReport?: () => void;
  busy?: boolean;
  /** My active plan: "Plan deaktivieren". */
  onDeactivate?: () => void;
  /** My active plan: "Aktueller Durchlauf". */
  onOpenRound?: () => void;
};

/** The training plan in the profile: one line, expands to the units in cycle order. */
export function PlanSummary({
  plan,
  nextIndex = null,
  onAdopt,
  onReport,
  busy = false,
  onDeactivate,
  onOpenRound,
}: PlanSummaryProps) {
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
        accessibilityLabel={`Trainingsplan ${plan.name}, ${count} Tage${next !== undefined ? `, als Nächstes ${next.type === "rest" ? "Ruhetag" : next.title}` : ""}`}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons name="list-outline" size={20} color={colors.textSecondary} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {plan.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {count === 1 ? "1 Tag" : `${count} Tage`} im Zyklus
            {next !== undefined ? ` · Als Nächstes: ${next.type === "rest" ? "Ruhetag" : next.title}` : ""}
          </Text>
          {plan.origin !== null && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {plan.origin}
            </Text>
          )}
          {plan.removed && <Text style={styles.removed}>Von der Moderation entfernt: nur für dich sichtbar</Text>}
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
                  <Text style={[styles.dayTitle, day.type === "rest" && styles.restTitle]}>
                    {day.type === "rest" && day.title !== "Ruhetag" ? `Ruhetag · ${day.title}` : day.title}
                    {isNext && <Text style={styles.nextLabel}> · Als Nächstes</Text>}
                  </Text>
                  {day.exercises.map((exercise) => (
                    <Text key={exercise.id} style={styles.exercise}>
                      {exercise.name} · {exerciseSummary(exercise)}
                    </Text>
                  ))}
                  {day.notes !== null && <Text style={styles.notes}>{day.notes}</Text>}
                </View>
              </View>
            );
          })}
          {(onAdopt !== undefined || onReport !== undefined || onDeactivate !== undefined || onOpenRound !== undefined) && (
            <View style={styles.actions}>
              {onOpenRound !== undefined && (
                <Button label="Aktueller Durchlauf" icon="list-outline" variant="secondary" size="sm" onPress={onOpenRound} />
              )}
              {onDeactivate !== undefined && (
                <Button label="Plan deaktivieren" icon="pause-outline" variant="ghost" size="sm" onPress={onDeactivate} />
              )}
              {onAdopt !== undefined && (
                <Button label="Plan übernehmen" icon="copy-outline" variant="secondary" size="sm" onPress={onAdopt} loading={busy} />
              )}
              {onReport !== undefined && <Button label="Plan melden" variant="ghost" size="sm" destructive onPress={onReport} />}
            </View>
          )}
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
    restTitle: {
      color: colors.textSecondary,
    },
    exercise: {
      ...typography.caption,
      ...typography.numeric,
      color: colors.text,
    },
    removed: {
      ...typography.caption,
      color: colors.danger,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
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
