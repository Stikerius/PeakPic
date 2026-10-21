import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { radius, spacing, typography } from "@/constants/theme";
import type { TrainingPlan } from "@/lib/planRepo";
import { makeStyles } from "@/lib/theme";

type PlanChoiceProps = {
  plan: TrainingPlan;
  /** The unit due next; pre-selected when switching to "Ja". */
  nextIndex: number;
  /** Selected unit id, or null for "not part of the plan". */
  value: string | null;
  onChange: (planDayId: string | null) => void;
  disabled?: boolean;
};

const YES_NO = [
  { value: "no", label: "Nein" },
  { value: "yes", label: "Ja" },
] as const;

/** "Gehört zu deinem Plan?" with the plan's units as chips. Only shown to people with a plan. */
export function PlanChoice({ plan, nextIndex, value, onChange, disabled = false }: PlanChoiceProps) {
  const styles = useStyles();
  const nextId = plan.days[nextIndex]?.id ?? plan.days[0]?.id ?? null;
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.question}>Gehört zu deinem Plan?</Text>
        <View style={styles.toggle}>
          <SegmentedControl
            value={value === null ? "no" : "yes"}
            options={[...YES_NO]}
            onChange={(choice) => onChange(choice === "yes" ? nextId : null)}
            disabled={disabled}
            accessibilityLabel="Gehört zu deinem Plan?"
          />
        </View>
      </View>
      {value !== null && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityRole="radiogroup"
          accessibilityLabel="Einheit"
        >
          {plan.days.map((day, index) => {
            const selected = day.id === value;
            return (
              <Pressable
                key={day.id}
                onPress={() => onChange(day.id)}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                accessibilityLabel={`${day.title}, Einheit ${index + 1} von ${plan.days.length}${index === nextIndex ? ", als Nächstes dran" : ""}`}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                  {index + 1} · {day.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      gap: spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    question: {
      ...typography.body,
      flex: 1,
      color: colors.text,
    },
    toggle: {
      width: 132,
    },
    chips: {
      gap: spacing.sm,
    },
    chip: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    chipText: {
      ...typography.caption,
      fontWeight: "500",
      color: colors.textSecondary,
    },
    chipTextSelected: {
      color: colors.text,
      fontWeight: "600",
    },
  }),
);
