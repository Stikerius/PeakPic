import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { PlanDeviationPrompt } from "@/components/plans/plan-deviation-prompt";
import { MonthCalendar } from "@/components/streak/month-calendar";
import { PlanStreakCard } from "@/components/streak/plan-streak-card";
import { RestDaysCard } from "@/components/streak/rest-days-card";
import { StreakSummary } from "@/components/streak/streak-summary";
import { fontSize, spacing } from "@/constants/theme";
import { usePlanAndRest } from "@/hooks/use-plan-and-rest";
import { useRestDayActions } from "@/hooks/use-rest-day-actions";
import { useWorkoutDays } from "@/hooks/use-workout-days";
import { describeError } from "@/lib/errors";
import { confirmPlannedRestDay, planEntries } from "@/lib/planRepo";
import { plannedRestDueFromRound, roundNext } from "@/lib/planRoundState";
import {
  addDays,
  addMonths,
  computeStreakStatsFromDays,
  currentPlanStreak,
  parseDayKey,
  restEntryIds,
  runLengthByDay,
  toDayKey,
} from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import { track, useTrackScreen } from "@/lib/usage";

export default function HomeScreen() {
  useTrackScreen("screen_home");
  const { colors } = useTheme();
  const styles = useStyles();
  const { days, sharedDays, restDays, loading, error, reload } = useWorkoutDays();
  const { plan, proofs, rest, round, reload: reloadPlanAndRest } = usePlanAndRest();

  const today = toDayKey(new Date());
  const { year: currentYear, month: currentMonth } = parseDayKey(today);
  const [confirmingRest, setConfirmingRest] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState({
    year: currentYear,
    month: currentMonth,
  });

  const stats = computeStreakStatsFromDays(days, today, restDays);
  const restDaySet = new Set(restDays);
  const runLengths = runLengthByDay(stats.trainingDays, restDaySet);
  const entries = plan !== null ? planEntries(plan) : [];
  const planDayIds = entries.map((e) => e.id);
  const restIds = restEntryIds(entries);
  // An active plan with rest days plans them itself; the weekly budget is not used then.
  const planHasRest = restIds.size > 0;
  const planStreak =
    plan !== null
      ? currentPlanStreak({ planDayIds, proofs, trainingDays: stats.trainingDays, restDays: restDaySet, today, restIds })
      : 0;
  // "Als Nächstes" and the due rest day come from the round the server keeps.
  const restDue = planHasRest ? plannedRestDueFromRound(round.round, entries, today, stats.trainingDays, restDaySet) : null;
  const reloadAll = () => {
    reload();
    reloadPlanAndRest();
  };
  const restActions = useRestDayActions(rest, stats.trainingDays, today, reloadAll);
  const recentDays = [addDays(today, -1), today];
  // Tappable in the calendar: with the budget yesterday / today without training; with a plan
  // with rest days the due rest day and confirmed planned rest days (to take one back).
  const restActionDays = new Set(
    planHasRest
      ? recentDays.filter((day) => day === restDue?.day || rest.planned.includes(day))
      : rest.budget !== null && rest.budget.restsPerWeek > 0
        ? recentDays.filter((day) => !stats.trainingDays.has(day))
        : [],
  );

  function confirmRest(day: string) {
    Alert.alert(
      day === today ? "Ruhetag für heute bestätigen?" : "Ruhetag für gestern bestätigen?",
      "Laut deinem Plan ist Ruhetag. Dein Streak läuft weiter, ohne dass der Tag als Training zählt.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Bestätigen",
          onPress: () => {
            setConfirmingRest(true);
            confirmPlannedRestDay(day)
              .then(() => {
                track("planned_rest_confirmed");
                reloadAll();
              })
              .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error)))
              .finally(() => setConfirmingRest(false));
          },
        },
      ],
    );
  }

  function selectActionDay(day: string) {
    if (planHasRest && day === restDue?.day && !rest.planned.includes(day)) confirmRest(day);
    else restActions.requestToggle(day);
  }
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
      <PlanDeviationPrompt plan={plan} round={round} onChanged={reloadAll} />
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <StreakSummary
        current={stats.current}
        longest={stats.longest}
        trainedToday={stats.trainingDays.has(today)}
      />
      {plan !== null && (
        <PlanStreakCard
          plan={plan}
          streak={planStreak}
          nextIndex={roundNext(round.round, entries).nextIndex}
          trainedToday={stats.trainingDays.has(today)}
          restDue={restDue?.day ?? null}
          today={today}
          busy={confirmingRest}
          onConfirmRest={confirmRest}
        />
      )}
      {!planHasRest && (
        <RestDaysCard rest={rest} trainingDays={stats.trainingDays} today={today} onChanged={reloadAll} />
      )}
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
        onSelectActionDay={selectActionDay}
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
