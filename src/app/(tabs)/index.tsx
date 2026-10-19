import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { MonthCalendar } from "@/components/streak/month-calendar";
import { StreakSummary } from "@/components/streak/streak-summary";
import { colors, fontSize, spacing } from "@/constants/theme";
import { useWorkouts } from "@/hooks/use-workouts";
import {
  addMonths,
  computeStreakStats,
  parseDayKey,
  runLengthByDay,
  toDayKey,
} from "@/lib/streak";

export default function HomeScreen() {
  const { workouts, loading, error } = useWorkouts();

  const now = new Date();
  const today = toDayKey(now);
  const { year: currentYear, month: currentMonth } = parseDayKey(today);
  const [visibleMonth, setVisibleMonth] = useState({
    year: currentYear,
    month: currentMonth,
  });

  const stats = computeStreakStats(
    workouts.map((w) => w.createdAt),
    now,
  );
  const runLengths = runLengthByDay(stats.trainingDays);
  const canGoNext =
    visibleMonth.year * 12 + visibleMonth.month < currentYear * 12 + currentMonth;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <StreakSummary
        current={stats.current}
        longest={stats.longest}
        trainedToday={stats.trainingDays.has(today)}
      />
      <MonthCalendar
        year={visibleMonth.year}
        month={visibleMonth.month}
        today={today}
        runLengths={runLengths}
        canGoNext={canGoNext}
        onPrev={() => setVisibleMonth((m) => addMonths(m.year, m.month, -1))}
        onNext={() => setVisibleMonth((m) => addMonths(m.year, m.month, 1))}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
