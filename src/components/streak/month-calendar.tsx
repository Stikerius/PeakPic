import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FlameIcon } from "@/components/streak/flame-icon";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { flameTier, monthGrid, parseDayKey, type DayKey } from "@/lib/streak";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
] as const;

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

type MonthCalendarProps = {
  year: number;
  /** 1-12 */
  month: number;
  today: DayKey;
  /** Streak length ending on each training day; absent = no training. */
  runLengths: ReadonlyMap<DayKey, number>;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export function MonthCalendar({
  year,
  month,
  today,
  runLengths,
  canGoNext,
  onPrev,
  onNext,
}: MonthCalendarProps) {
  const weeks = monthGrid(year, month);
  const monthName = MONTH_NAMES[month - 1] ?? "";
  const trainedThisMonth = weeks
    .flat()
    .filter((day) => day !== null && runLengths.has(day)).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vorheriger Monat"
          onPress={onPrev}
          hitSlop={spacing.sm}
          style={styles.navButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.titleBox}>
          <Text style={styles.title}>
            {monthName} {year}
          </Text>
          <Text style={styles.subtitle}>
            {trainedThisMonth} {trainedThisMonth === 1 ? "Trainingstag" : "Trainingstage"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Nächster Monat"
          accessibilityState={{ disabled: !canGoNext }}
          onPress={onNext}
          disabled={!canGoNext}
          hitSlop={spacing.sm}
          style={[styles.navButton, !canGoNext && styles.disabled]}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.row}>
        {WEEKDAYS.map((weekday) => (
          <Text key={weekday} style={styles.weekday}>
            {weekday}
          </Text>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.row}>
          {week.map((day, dayIndex) => {
            if (day === null) return <View key={dayIndex} style={styles.cell} />;
            const run = runLengths.get(day);
            const isToday = day === today;
            const isFuture = day > today;
            return (
              <View
                key={day}
                style={[styles.cell, isToday && styles.today]}
                accessible
                accessibilityLabel={`${parseDayKey(day).day}. ${monthName}${run !== undefined ? ", trainiert" : ""}${isToday ? ", heute" : ""}`}
              >
                <Text style={[styles.dayNumber, isFuture && styles.future]}>
                  {parseDayKey(day).day}
                </Text>
                {run !== undefined && <FlameIcon tier={flameTier(run)} baseSize={16} />}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  disabled: {
    opacity: 0.3,
  },
  titleBox: {
    flex: 1,
    alignItems: "center",
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  row: {
    flexDirection: "row",
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: "600",
    paddingVertical: spacing.xs,
  },
  cell: {
    flex: 1,
    aspectRatio: 0.8,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  today: {
    borderColor: colors.primary,
  },
  dayNumber: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "500",
  },
  future: {
    color: colors.textMuted,
    opacity: 0.5,
  },
});
