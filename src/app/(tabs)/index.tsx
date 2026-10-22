import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { MonthCalendar } from "@/components/streak/month-calendar";
import { PlanStreakCard } from "@/components/streak/plan-streak-card";
import { RestDaysCard } from "@/components/streak/rest-days-card";
import { StreakSummary } from "@/components/streak/streak-summary";
import { fontSize, spacing } from "@/constants/theme";
import { usePlanAndRest } from "@/hooks/use-plan-and-rest";
import { useRestDayActions } from "@/hooks/use-rest-day-actions";
import { useWorkoutDays } from "@/hooks/use-workout-days";
import {
  addDays,
  addMonths,
  computeStreakStatsFromDays,
  currentPlanStreak,
  nextPlanDayIndex,
  parseDayKey,
  runLengthByDay,
  toDayKey,
} from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import { useTrackScreen } from "@/lib/usage";

export default function HomeScreen() {
  useTrackScreen("screen_home");
  const { colors } = useTheme();
  const styles = useStyles();
  const { days, sharedDays, restDays, loading, error, reload } = useWorkoutDays();
  const { plan, proofs, rest, reload: reloadPlanAndRest } = usePlanAndRest();

  const today = toDayKey(new Date());
  const { year: currentYear, month: currentMonth } = parseDayKey(today);
  const [visibleMonth, setVisibleMonth] = useState({
    year: currentYear,
    month: currentMonth,
  });

  const stats = computeStreakStatsFromDays(days, today, restDays);
  const restDaySet = new Set(restDays);
  const runLengths = runLengthByDay(stats.trainingDays, restDaySet);
  const planDayIds = plan?.days.map((d) => d.id) ?? [];
  const planStreak =
    plan !== null
      ? currentPlanStreak({ planDayIds, proofs, trainingDays: stats.trainingDays, restDays: restDaySet, today })
      : 0;
  const reloadAll = () => {
    reload();
    reloadPlanAndRest();
  };
  const restActions = useRestDayActions(rest, stats.trainingDays, today, reloadAll);
  // Only people with a rest day budget can tap yesterday / today in the calendar.
  const restActionDays = new Set(
    rest.budget !== null && rest.budget.restsPerWeek > 0
      ? [addDays(today, -1), today].filter((day) => !stats.trainingDays.has(day))
      : [],
  );
  const canGoNext =
    visibleMonth.year * 12 + visibleMonth.month < currentYear * 12 + currentMonth;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
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
      {plan !== null && (
        <PlanStreakCard plan={plan} streak={planStreak} nextIndex={nextPlanDayIndex(planDayIds, proofs)} />
      )}
      <RestDaysCard
        rest={rest}
        trainingDays={stats.trainingDays}
        today={today}
        onChanged={reloadAll}
      />
      <MonthCalendar
        year={visibleMonth.year}
        month={visibleMonth.month}
        today={today}
        runLengths={runLengths}
        sharedDays={sharedDays}
        restDays={restDaySet}
        canGoNext={canGoNext}
        onPrev={() => setVisibleMonth((m) => addMonths(m.year, m.month, -1))}
        onNext={() => setVisibleMonth((m) => addMonths(m.year, m.month, 1))}
        onSelectDay={(day) => router.push({ pathname: "/day/[date]", params: { date: day } })}
        actionDays={restActionDays}
        onSelectActionDay={restActions.requestToggle}
      />
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
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
  }),
);
