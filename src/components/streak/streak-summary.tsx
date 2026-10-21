import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { FlameIcon } from "@/components/streak/flame-icon";
import { fontSize, radius, spacing } from "@/constants/theme";
import { flameTier } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";

type StreakSummaryProps = {
  current: number;
  longest: number;
  trainedToday: boolean;
};

function dayLabel(count: number): string {
  return count === 1 ? "Tag" : "Tage";
}

function hint(current: number, trainedToday: boolean): string {
  if (trainedToday) return "Heute erledigt. Stark! 💪";
  if (current > 0) return "Trainiere heute, um deinen Streak zu halten.";
  return "Mach ein Workout-Foto, um deinen Streak zu starten.";
}

export function StreakSummary({ current, longest, trainedToday }: StreakSummaryProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <View style={styles.current}>
        <View style={styles.flame}>
          {current > 0 ? (
            <FlameIcon tier={flameTier(current)} baseSize={56} />
          ) : (
            <Ionicons name="flame-outline" size={56} color={colors.textSecondary} />
          )}
        </View>
        <Text style={styles.currentValue} accessibilityLabel={`Aktueller Streak: ${current} ${dayLabel(current)}`}>
          {current}
        </Text>
        <Text style={styles.currentLabel}>{dayLabel(current)} Streak</Text>
        <Text style={styles.hint}>{hint(current, trainedToday)}</Text>
      </View>

      <View style={styles.longest}>
        <Ionicons name="trophy" size={22} color={colors.warning} />
        <Text style={styles.longestLabel}>Längster Streak</Text>
        <Text style={styles.longestValue}>
          {longest} {dayLabel(longest)}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      gap: spacing.md,
    },
    current: {
      alignItems: "center",
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    flame: {
      height: 90,
      justifyContent: "flex-end",
    },
    currentValue: {
      color: colors.text,
      fontSize: 64,
      fontWeight: "800",
      lineHeight: 72,
    },
    currentLabel: {
      color: colors.textSecondary,
      fontSize: fontSize.lg,
      fontWeight: "600",
    },
    hint: {
      marginTop: spacing.sm,
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: "center",
    },
    longest: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    longestLabel: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
    },
    longestValue: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
    },
  }),
);
