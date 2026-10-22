import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { radius, spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { setPendingWorkoutLink } from "@/lib/pendingWorkoutLink";
import { VISIBILITY_LABELS } from "@/lib/planRepo";
import { toDayKey } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import { clearTrainingDraft, updateTrainingDraft, useTrainingDraft } from "@/lib/trainingDraft";
import { countCountingWorkouts, getDefaultActivityVisibility, saveWorkout, type SaveWorkoutResult } from "@/lib/trainingRepo";
import { track, useTrackScreen } from "@/lib/usage";
import {
  finishDraft,
  formatDuration,
  reasonText,
  reopenDraft,
  streakVerdict,
  summarize,
  toWorkoutPayload,
  workoutDay,
  type ActivityVisibility,
} from "@/lib/workout";

const VISIBILITY_OPTIONS: { value: ActivityVisibility; label: string }[] = (["private", "followers", "public"] as const).map(
  (value) => ({ value, label: VISIBILITY_LABELS[value] }),
);

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** End of a training: summary, title, note, who sees it; then optionally photos. */
export default function WorkoutFinishScreen() {
  useTrackScreen("screen_workout_finish");
  const { colors } = useTheme();
  const styles = useStyles();
  const draft = useTrainingDraft();
  const [defaultVisibility, setDefaultVisibility] = useState<ActivityVisibility>("private");
  const [countingThatDay, setCountingThatDay] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => toDayKey(new Date()));
  const [saved, setSaved] = useState<(SaveWorkoutResult & { planDayId: string | null }) | null>(null);

  useEffect(() => {
    getDefaultActivityVisibility()
      .then(setDefaultVisibility)
      .catch(() => undefined);
  }, []);

  // Coming here directly (e.g. "Beenden" of an old draft): the end is now.
  useEffect(() => {
    if (draft !== null && draft !== undefined && draft.endedAt === null) {
      updateTrainingDraft((d) => finishDraft(d, Date.now()));
    }
  }, [draft]);

  const startedAt = draft?.startedAt ?? null;
  useEffect(() => {
    if (startedAt === null) return;
    countCountingWorkouts(workoutDay(startedAt))
      .then(setCountingThatDay)
      .catch(() => undefined);
  }, [startedAt]);

  if (saved !== null) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.doneIcon}>
          <Ionicons name={saved.countsForStreak ? "flame" : "checkmark-circle-outline"} size={44} color={saved.countsForStreak ? colors.accent : colors.textSecondary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Training gespeichert
        </Text>
        <Text style={styles.text}>
          {saved.countsForStreak ? "Es zählt für deinen Streak." : saved.reason !== null ? reasonText(saved.reason) : "Es zählt nicht für deinen Streak."}
        </Text>
        <Text style={styles.muted}>
          Du kannst optional Fotos dazu posten, wie bei einem normalen Beitrag.
          {saved.countsForStreak ? "" : " Fotos zu diesem Training zählen ebenfalls nicht für den Streak."}
        </Text>
        <View style={styles.actions}>
          <Button
            label="Fotos hinzufügen"
            icon="camera-outline"
            variant="secondary"
            onPress={() => {
              setPendingWorkoutLink({
                workoutId: saved.id,
                planDayId: saved.planDayId,
                shareWithPost: false,
                countsForStreak: saved.countsForStreak,
                createdAt: Date.now(),
              });
              track("workout_photo_added");
              router.dismissAll();
              router.navigate("/camera");
            }}
          />
          <Button label="Fertig" onPress={() => router.back()} />
        </View>
      </ScrollView>
    );
  }

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

  const current = draft;
  // endedAt is set by the effect above; until then the last change is close enough.
  const now = current.endedAt ?? current.updatedAt;
  const summary = summarize(current, now);
  const day = workoutDay(current.startedAt);
  const verdict = streakVerdict({
    activeSeconds: summary.activeSeconds,
    sets: summary.sets,
    workoutDay: day,
    today,
    countingThatDay,
  });
  const details = current.details ?? { title: "", note: "", visibility: null };
  const visibility = details.visibility ?? defaultVisibility;

  function setDetails(change: Partial<typeof details>) {
    updateTrainingDraft((d) => ({ ...d, details: { ...details, ...change } }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveWorkout(
        toWorkoutPayload(current, Date.now(), { title: details.title, note: details.note, visibility, shareWithPost: false }),
      );
      const planDayId = current.planDayId;
      // Only now: the training is on the server.
      await clearTrainingDraft();
      setSaved({ ...result, planDayId });
    } catch (saveError) {
      setError(`Speichern fehlgeschlagen. ${describeError(saveError)} Dein Training bleibt auf dem Gerät gespeichert.`);
    } finally {
      setSaving(false);
    }
  }

  function confirmDiscard() {
    Alert.alert("Training verwerfen?", "Alle erfassten Sätze dieses Trainings gehen verloren.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Verwerfen",
        style: "destructive",
        onPress: () => {
          track("workout_discarded");
          void clearTrainingDraft().then(() => router.back());
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.stats}>
          <Stat label="Dauer" value={formatDuration(summary.totalSeconds * 1000)} />
          <Stat label="Aktiv" value={formatDuration(summary.activeSeconds * 1000)} />
          <Stat label="Übungen" value={String(summary.exercises)} />
          <Stat label="Sätze" value={String(summary.sets)} />
          {summary.volumeKg !== null && <Stat label="Volumen" value={`${Math.round(summary.volumeKg).toLocaleString("de-CH")} kg`} />}
        </View>
        <Text style={verdict.counts ? styles.text : styles.muted}>
          {verdict.counts ? "Zählt für deinen Streak." : verdict.reason !== null ? reasonText(verdict.reason) : ""}
        </Text>

        <TextField
          label="Titel (optional)"
          value={details.title}
          onChangeText={(title) => setDetails({ title })}
          placeholder={current.planDayTitle ?? "Freies Training"}
          maxLength={60}
        />
        <TextField label="Notiz (optional)" value={details.note} onChangeText={(note) => setDetails({ note })} maxLength={1000} multiline />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Wer sieht diese Aktivität</Text>
          <SegmentedControl
            value={visibility}
            options={VISIBILITY_OPTIONS}
            onChange={(value) => setDetails({ visibility: value })}
            accessibilityLabel="Wer sieht diese Aktivität"
          />
          <Text style={styles.muted}>„Alle“ gilt nur bei öffentlichem Profil. Der Trainingstag erscheint im Kalender wie bei einem Foto.</Text>
        </View>

        {error !== null && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Button label="Speichern" onPress={() => void save()} loading={saving} />
          <Button
            label="Weiter trainieren"
            variant="secondary"
            onPress={() => {
              updateTrainingDraft((d) => reopenDraft(d, Date.now()));
              router.replace("/workout-session");
            }}
            disabled={saving}
          />
          <Button label="Verwerfen" variant="ghost" destructive onPress={confirmDiscard} disabled={saving} />
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
    content: {
      gap: spacing.md,
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    stats: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    stat: {
      minWidth: 96,
      flexGrow: 1,
      padding: spacing.ms,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    statValue: {
      ...typography.heading,
      ...typography.numeric,
      color: colors.text,
    },
    statLabel: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    doneIcon: {
      alignSelf: "center",
      paddingTop: spacing.lg,
    },
    title: {
      ...typography.title,
      color: colors.text,
      textAlign: "center",
    },
    text: {
      ...typography.body,
      color: colors.text,
    },
    muted: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    field: {
      gap: spacing.sm,
    },
    fieldLabel: {
      ...typography.label,
      color: colors.textSecondary,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
    actions: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
  }),
);
