import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FlameIcon } from "@/components/streak/flame-icon";
import { fontSize, radius, spacing } from "@/constants/theme";
import { flameTier, monthGrid, parseDayKey, type DayKey } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";

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
  /** Days that count through a workout link to someone else's post (small link mark). */
  sharedDays?: ReadonlySet<DayKey>;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Called when a training day is tapped. */
  onSelectDay: (day: DayKey) => void;
};

export function MonthCalendar({
  year,
  month,
  today,
  runLengths,
  sharedDays,
  canGoNext,
  onPrev,
  onNext,
  onSelectDay,
}: MonthCalendarProps) {
  const { colors } = useTheme();
  const styles = useStyles();
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
            const shared = sharedDays?.has(day) === true;
            const label = `${parseDayKey(day).day}. ${monthName}${run !== undefined ? ", trainiert" : ""}${shared ? ", verlinktes Workout" : ""}${isToday ? ", heute" : ""}`;
            const content = (
              <>
                <Text style={[styles.dayNumber, isFuture && styles.future]}>
                  {parseDayKey(day).day}
                </Text>
                {run !== undefined && <FlameIcon tier={flameTier(run)} baseSize={16} />}
                {shared && (
                  <View style={styles.sharedMark}>
                    <Ionicons name="link" size={9} color={colors.onAccent} />
                  </View>
                )}
              </>
            );
            if (run === undefined) {
              return (
                <View
                  key={day}
                  style={[styles.cell, isToday && styles.today]}
                  accessible
                  accessibilityLabel={label}
                >
                  {content}
                </View>
              );
            }
            return (
              <Pressable
                key={day}
                onPress={() => onSelectDay(day)}
                style={({ pressed }) => [
                  styles.cell,
                  styles.trainedCell,
                  isToday && styles.today,
                  pressed && styles.pressedCell,
                ]}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint="Zeigt die Fotos dieses Tages"
              >
                {content}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
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
      backgroundColor: colors.surfaceRaised,
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
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    row: {
      flexDirection: "row",
    },
    weekday: {
      flex: 1,
      textAlign: "center",
      color: colors.textSecondary,
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
    trainedCell: {
      backgroundColor: colors.surfaceRaised,
    },
    pressedCell: {
      opacity: 0.6,
    },
    sharedMark: {
      position: "absolute",
      top: 2,
      right: 2,
      width: 13,
      height: 13,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    today: {
      borderColor: colors.accent,
    },
    dayNumber: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: "500",
    },
    future: {
      color: colors.textSecondary,
      opacity: 0.5,
    },
  }),
);
