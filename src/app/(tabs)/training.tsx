import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { SectionFooter, SectionHeader } from "@/components/ui/section-header";
import { radius, spacing, typography } from "@/constants/theme";
import { formatDate } from "@/lib/format";
import { randomUuid } from "@/lib/ids";
import { fetchMyPlan, fetchPlanProofs, planEntries, type TrainingPlan } from "@/lib/planRepo";
import { nextPlanDayIndex, nextTrainingIndex } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import { clearTrainingDraft, setTrainingDraft, useTrainingDraft } from "@/lib/trainingDraft";
import { fetchMyWorkouts, type WorkoutListItem } from "@/lib/trainingRepo";
import { track, useTrackScreen } from "@/lib/usage";
import { activeMs, exercisesFromPlan, formatDuration, isStale, newDraft, newExercise, reasonText } from "@/lib/workout";

/** Starts a training: a day of the active plan (with its exercises) or a free training. */
function startTraining(plan: TrainingPlan | null, dayId: string | null) {
  const day = plan?.days.find((d) => d.id === dayId) ?? null;
  const now = Date.now();
  const exercises =
    day !== null && day.exercises.length > 0
      ? exercisesFromPlan(
          day.exercises.map((e) => ({
            id: e.id,
            name: e.name,
            sets: e.sets,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
            targetSeconds: e.targetSeconds,
            targetWeightKg: e.targetWeightKg,
          })),
          randomUuid,
        )
      : [newExercise(randomUuid(), "", randomUuid)];
  setTrainingDraft(
    newDraft({
      clientId: randomUuid(),
      now,
      planId: day !== null ? (plan?.id ?? null) : null,
      planDayId: day?.id ?? null,
      planDayTitle: day?.title ?? null,
      exercises,
    }),
  );
  track("workout_started");
  router.push("/workout-session");
}

/** "Training": start (plan day or free), the running training, and the history. Entirely optional. */
export default function TrainingScreen() {
  useTrackScreen("screen_training");
  const { colors } = useTheme();
  const styles = useStyles();
  const draft = useTrainingDraft();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkoutListItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    let active = true;
    Promise.all([fetchMyPlan(), fetchPlanProofs()])
      .then(([myPlan, proofs]) => {
        if (!active) return;
        setPlan(myPlan);
        if (myPlan !== null) {
          const entries = planEntries(myPlan);
          const next = nextTrainingIndex(entries, nextPlanDayIndex(entries.map((e) => e.id), proofs));
          setSelectedDay(myPlan.days[next]?.id ?? null);
        }
      })
      .catch(() => undefined);
    fetchMyWorkouts()
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch(() => {
        if (active) setHistory([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  // The running time on the card (computed from timestamps; the interval only re-renders).
  useEffect(() => {
    if (draft === null || draft === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [draft]);

  function confirmDiscard() {
    Alert.alert("Training verwerfen?", "Alle erfassten Sätze dieses Trainings gehen verloren.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Verwerfen",
        style: "destructive",
        onPress: () => {
          track("workout_discarded");
          void clearTrainingDraft();
        },
      },
    ]);
  }

  const trainingDays = plan?.days.filter((d) => d.type === "training") ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {draft === undefined ? (
        <ActivityIndicator color={colors.textSecondary} />
      ) : draft !== null ? (
        <View style={styles.running}>
          <View style={styles.runningRow}>
            <Ionicons name="timer-outline" size={22} color={colors.text} />
            <View style={styles.flex}>
              <Text style={styles.runningTitle}>{draft.planDayTitle ?? "Freies Training"}</Text>
              <Text style={styles.runningTime}>
                {draft.endedAt !== null ? "Beendet, noch nicht gespeichert" : `Läuft seit ${formatDuration(activeMs(draft, now))}`}
              </Text>
            </View>
          </View>
          {isStale(draft, now) && (
            <Text style={styles.hint}>Dieses Training wurde vor über 12 Stunden gestartet. Beende oder verwirf es.</Text>
          )}
          <Button
            label={draft.endedAt !== null ? "Speichern abschliessen" : "Training fortsetzen"}
            onPress={() => router.push(draft.endedAt !== null ? "/workout-finish" : "/workout-session")}
          />
          {isStale(draft, now) && draft.endedAt === null && (
            <Button label="Beenden" variant="secondary" onPress={() => router.push("/workout-finish")} />
          )}
          <Button label="Verwerfen" variant="ghost" destructive onPress={confirmDiscard} />
        </View>
      ) : (
        <>
          <SectionHeader title="Training starten" />
          {trainingDays.length > 0 && plan !== null && (
            <View style={styles.group}>
              {trainingDays.map((day, index) => {
                const selected = day.id === selectedDay;
                const position = plan.days.findIndex((d) => d.id === day.id);
                return (
                  <View key={day.id}>
                    {index > 0 && <Divider />}
                    <Pressable
                      onPress={() => setSelectedDay(day.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`Tag ${position + 1}: ${day.title}, ${day.exercises.length} Übungen`}
                      style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}
                    >
                      <Ionicons
                        name={selected ? "radio-button-on" : "radio-button-off"}
                        size={22}
                        color={selected ? colors.accent : colors.textSecondary}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.dayTitle}>
                          Tag {position + 1} · {day.title}
                        </Text>
                        <Text style={styles.daySubtitle}>
                          {day.exercises.length === 0
                            ? "Keine Übungen geplant"
                            : day.exercises.map((e) => e.name).slice(0, 4).join(", ")}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
          {trainingDays.length > 0 && <SectionFooter>{`Vorgewählt ist der nächste Tag aus „${plan?.name ?? ""}“.`}</SectionFooter>}
          <View style={styles.actions}>
            {trainingDays.length > 0 && (
              <Button label="Training starten" icon="play" onPress={() => startTraining(plan, selectedDay)} disabled={selectedDay === null} />
            )}
            <Button
              label="Freies Training"
              variant={trainingDays.length > 0 ? "secondary" : "primary"}
              onPress={() => startTraining(null, null)}
            />
          </View>
        </>
      )}

      <SectionHeader title="Verlauf" />
      {history === null ? (
        <ActivityIndicator color={colors.textSecondary} />
      ) : history.length === 0 ? (
        <Text style={styles.empty}>Noch keine Trainings aufgezeichnet.</Text>
      ) : (
        <View style={styles.group}>
          {history.map((item, index) => (
            <View key={item.id}>
              {index > 0 && <Divider />}
              <View style={styles.historyRow}>
                <View style={styles.flex}>
                  <Text style={styles.dayTitle}>{item.title}</Text>
                  <Text style={styles.daySubtitle}>
                    {formatDate(item.startedAt)} · {formatDuration(item.activeSeconds * 1000)}
                  </Text>
                  {!item.countsForStreak && item.reason !== null && <Text style={styles.reason}>{reasonText(item.reason)}</Text>}
                </View>
                <Ionicons
                  name={item.countsForStreak ? "flame" : "flame-outline"}
                  size={20}
                  color={item.countsForStreak ? colors.accent : colors.textTertiary}
                  accessibilityLabel={item.countsForStreak ? "Zählt für den Streak" : "Zählt nicht für den Streak"}
                />
              </View>
            </View>
          ))}
        </View>
      )}
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
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    flex: {
      flex: 1,
    },
    running: {
      gap: spacing.ms,
      margin: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    runningRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
    },
    runningTitle: {
      ...typography.bodyStrong,
      color: colors.text,
    },
    runningTime: {
      ...typography.caption,
      ...typography.numeric,
      color: colors.textSecondary,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    group: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    dayRow: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pressed: {
      backgroundColor: colors.surfaceRaised,
    },
    dayTitle: {
      ...typography.body,
      color: colors.text,
    },
    daySubtitle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    reason: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    actions: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
    },
    empty: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
    },
  }),
);
