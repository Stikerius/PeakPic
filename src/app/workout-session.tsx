import { useKeepAwake } from "expo-keep-awake";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ExerciseCard } from "@/components/training/exercise-card";
import { Button } from "@/components/ui/button";
import { spacing, typography } from "@/constants/theme";
import { randomUuid } from "@/lib/ids";
import { moveItem } from "@/lib/planDraft";
import { fetchExerciseNames } from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { updateTrainingDraft, useTrainingDraft } from "@/lib/trainingDraft";
import { useRestTimerSettings } from "@/lib/trainingSettings";
import { useTrackScreen } from "@/lib/usage";
import {
  WORKOUT_RULES,
  activeMs,
  completeSet,
  finishDraft,
  formatDuration,
  isPaused,
  newExercise,
  pauseDraft,
  restRemaining,
  resumeDraft,
  summarize,
} from "@/lib/workout";

/** The running training. Every change is stored on the device at once (lib/trainingDraft). */
export default function WorkoutSessionScreen() {
  useTrackScreen("screen_workout_session");
  // The screen stays on while training.
  useKeepAwake("workout-session");
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const draft = useTrainingDraft();
  const restSettings = useRestTimerSettings();
  const [now, setNow] = useState(() => Date.now());
  const [knownNames, setKnownNames] = useState<string[]>([]);

  // Only re-renders; all times come from timestamps.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchExerciseNames()
      .then(setKnownNames)
      .catch(() => undefined);
  }, []);

  if (draft === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }
  if (draft === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Kein Training aktiv.</Text>
        <Button label="Zurück" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const paused = isPaused(draft);
  const rest = restRemaining(draft.rest, now);
  const summary = summarize(draft, now);

  function confirmFinish() {
    if (summary.sets === 0) {
      Alert.alert("Noch keine Sätze", "Tippe bei einem Satz auf den Kreis, sobald du ihn erledigt hast.");
      return;
    }
    updateTrainingDraft((d) => finishDraft(d, Date.now()));
    router.replace("/workout-finish");
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen
        options={{
          title: draft.planDayTitle ?? "Freies Training",
          // Closing keeps the training on the device; it continues from the Training tab.
          headerLeft: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={spacing.sm} style={styles.close}>
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.topBar}>
        <View>
          <Text style={styles.time} accessibilityRole="timer" accessibilityLabel={`Trainingszeit ${formatDuration(activeMs(draft, now))}`}>
            {formatDuration(activeMs(draft, now))}
          </Text>
          <Text style={styles.muted}>
            {paused ? "Pausiert" : `${summary.sets} ${summary.sets === 1 ? "Satz" : "Sätze"} erledigt`}
          </Text>
        </View>
        <View style={styles.topActions}>
          <Button
            label={paused ? "Fortsetzen" : "Pause"}
            icon={paused ? "play" : "pause"}
            variant="secondary"
            size="sm"
            onPress={() => updateTrainingDraft((d) => (isPaused(d) ? resumeDraft(d, Date.now()) : pauseDraft(d, Date.now())))}
          />
          <Button label="Beenden" size="sm" onPress={confirmFinish} />
        </View>
      </View>
      {draft.rest !== null && (
        <View style={styles.rest}>
          <Text style={styles.restText}>{rest > 0 ? `Pause ${formatDuration(rest * 1000)}` : "Pause vorbei"}</Text>
          <View style={styles.restActions}>
            {rest > 0 && (
              <Button
                label="+30 s"
                variant="ghost"
                size="sm"
                onPress={() => updateTrainingDraft((d) => (d.rest !== null ? { ...d, rest: { ...d.rest, seconds: d.rest.seconds + 30 } } : d))}
              />
            )}
            <Button
              label={rest > 0 ? "Überspringen" : "Schliessen"}
              variant="ghost"
              size="sm"
              onPress={() => updateTrainingDraft((d) => ({ ...d, rest: null }))}
            />
          </View>
        </View>
      )}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {draft.exercises.map((exercise, index) => (
          <ExerciseCard
            key={exercise.key}
            exercise={exercise}
            index={index}
            count={draft.exercises.length}
            now={now}
            knownNames={knownNames}
            onChange={(next) =>
              updateTrainingDraft((d) => ({
                ...d,
                updatedAt: Date.now(),
                exercises: d.exercises.map((e) => (e.key === next.key ? next : e)),
              }))
            }
            onCompleteSet={(setKey) =>
              updateTrainingDraft((d) => {
                const at = Date.now();
                const done = completeSet(d, exercise.key, setKey, at);
                return restSettings.enabled ? { ...done, rest: { startedAt: at, seconds: restSettings.seconds } } : done;
              })
            }
            onMove={(by) => updateTrainingDraft((d) => ({ ...d, exercises: moveItem(d.exercises, index, by) }))}
            onRemove={() => {
              const remove = () => updateTrainingDraft((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== exercise.key) }));
              if (!exercise.sets.some((s) => s.done)) {
                remove();
                return;
              }
              Alert.alert("Übung entfernen?", "Die erledigten Sätze dieser Übung gehen verloren.", [
                { text: "Abbrechen", style: "cancel" },
                { text: "Entfernen", style: "destructive", onPress: remove },
              ]);
            }}
          />
        ))}
        <View style={styles.padded}>
          <Button
            label="Übung hinzufügen"
            icon="add"
            variant="secondary"
            onPress={() => updateTrainingDraft((d) => ({ ...d, exercises: [...d.exercises, newExercise(randomUuid(), "", randomUuid)] }))}
            disabled={draft.exercises.length >= WORKOUT_RULES.maxExercises}
          />
          <Text style={styles.muted}>
            Pausentimer nach jedem Satz: {restSettings.enabled ? `${restSettings.seconds} s` : "aus"} (Einstellungen → Training).
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      gap: spacing.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      backgroundColor: colors.surface,
    },
    time: {
      ...typography.title,
      ...typography.numeric,
      color: colors.text,
    },
    topActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    rest: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surfaceRaised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    restText: {
      ...typography.bodyStrong,
      ...typography.numeric,
      color: colors.text,
    },
    restActions: {
      flexDirection: "row",
    },
    content: {
      gap: spacing.md,
      paddingTop: spacing.md,
    },
    padded: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    muted: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    close: {
      minHeight: 44,
      justifyContent: "center",
    },
    closeText: {
      ...typography.body,
      color: colors.text,
    },
  }),
);

