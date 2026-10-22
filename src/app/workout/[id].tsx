import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useReport, withReportSheet } from "@/components/moderation/report-provider";
import { VISIBILITY_ICONS } from "@/components/training/activity-row";
import { ErrorState } from "@/components/ui/empty-state";
import { radius, spacing, typography } from "@/constants/theme";
import { useActivityActions } from "@/hooks/use-activity-actions";
import { showActionSheet } from "@/lib/actionSheet";
import { fetchPost } from "@/lib/feedRepo";
import { formatDate } from "@/lib/format";
import { formatTime, formatWeight } from "@/lib/planDraft";
import { VISIBILITY_LABELS } from "@/lib/planRepo";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";
import { fetchEarlierWorkouts, fetchWorkoutReport, type WorkoutReport } from "@/lib/trainingRepo";
import { useTrackScreen } from "@/lib/usage";
import { formatDuration, reasonText } from "@/lib/workout";
import {
  compareToPrevious,
  exerciseDurationSeconds,
  findPreviousSets,
  reportVolume,
  setCount,
  trendText,
  type ReportExercise,
} from "@/lib/workoutReport";

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** "Trainingsbericht": one recorded training with all sets (only if the database lets me see it). */
function WorkoutReportScreen() {
  useTrackScreen("screen_workout_report");
  const { colors } = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const myId = useSession().session?.user.id ?? null;
  const { openReport } = useReport();
  const [report, setReport] = useState<WorkoutReport | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [earlier, setEarlier] = useState<{ exercises: ReportExercise[] }[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const actions = useActivityActions(
    () => setVersion((v) => v + 1),
    () => router.back(),
  );

  useEffect(() => {
    let active = true;
    fetchWorkoutReport(id)
      .then(async (result) => {
        if (!active) return;
        setFailed(false);
        setReport(result);
        if (result === null) return;
        const [previous, post] = await Promise.all([
          fetchEarlierWorkouts(result.userId, result.startedAt).catch(() => []),
          result.postId !== null ? fetchPost(result.postId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        setEarlier(previous);
        setPhotos(post?.photoUrls ?? []);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [id, version]);

  if (report === undefined) {
    return (
      <View style={styles.centered}>
        {failed ? <ErrorState onRetry={() => setVersion((v) => v + 1)} /> : <ActivityIndicator color={colors.textSecondary} />}
      </View>
    );
  }
  if (report === null) {
    return (
      <View style={styles.centered}>
        <ErrorState message="Diese Aktivität gibt es nicht mehr, oder du kannst sie nicht sehen." />
      </View>
    );
  }

  const current = report;
  const isMine = current.userId === myId;
  const totalSeconds = Math.max(0, Math.round((Date.parse(current.endedAt) - Date.parse(current.startedAt)) / 1000));
  const volume = reportVolume(current.exercises);

  function openMenu() {
    if (isMine) {
      actions.openMenu(current);
      return;
    }
    showActionSheet(current.title, [
      { label: "Aktivität melden", destructive: true, onPress: () => openReport({ targetType: "workout", targetId: current.id }) },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Trainingsbericht",
          headerRight: () => (
            <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="Aktionen" hitSlop={spacing.sm} style={styles.headerButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {current.title}
          </Text>
          <Text style={styles.muted}>
            {formatDate(current.startedAt)}
            {current.planDayTitle !== null && current.title !== current.planDayTitle ? ` · ${current.planDayTitle}` : ""}
          </Text>
          {isMine && (
            <View style={styles.metaRow}>
              <Ionicons name={VISIBILITY_ICONS[current.visibility]} size={16} color={colors.textSecondary} />
              <Text style={styles.muted}>{VISIBILITY_LABELS[current.visibility]}</Text>
              <Text style={styles.muted}>
                · {current.countsForStreak ? "Zählt für den Streak" : current.reason !== null ? reasonText(current.reason) : "Zählt nicht"}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.stats}>
          <Stat label="Gesamtdauer" value={formatDuration(totalSeconds * 1000)} />
          <Stat label="Aktive Zeit" value={formatDuration(current.activeSeconds * 1000)} />
          <Stat label="Übungen" value={String(current.exercises.length)} />
          <Stat label="Sätze" value={String(setCount(current.exercises))} />
          {volume !== null && <Stat label="Volumen" value={`${Math.round(volume).toLocaleString("de-CH")} kg`} />}
        </View>

        {current.note !== null && <Text style={styles.note}>{current.note}</Text>}

        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {photos.map((url) => (
              <Image key={url} source={{ uri: url }} style={styles.photo} contentFit="cover" accessibilityLabel="Foto zum Training" />
            ))}
          </ScrollView>
        )}

        {current.exercises.map((exercise, index) => {
          const duration = exerciseDurationSeconds(exercise.sets);
          const comparison = trendText(compareToPrevious(exercise.sets, findPreviousSets(exercise.name, earlier)));
          const hasWeight = exercise.sets.some((s) => s.weightKg !== null);
          const hasTime = exercise.sets.some((s) => s.seconds !== null);
          return (
            <View key={`${exercise.name}-${index}`} style={styles.exercise}>
              <View style={styles.exerciseHeader}>
                <Text style={styles.exerciseName}>{exercise.name}</Text>
                {duration > 0 && <Text style={styles.muted}>{formatDuration(duration * 1000)}</Text>}
              </View>
              {comparison !== null && <Text style={styles.trend}>{comparison}</Text>}
              <View style={styles.tableRow}>
                <Text style={[styles.cell, styles.cellIndex, styles.head]}>Satz</Text>
                <Text style={[styles.cell, styles.head]}>Wdh.</Text>
                {hasWeight && <Text style={[styles.cell, styles.head]}>kg</Text>}
                {hasTime && <Text style={[styles.cell, styles.head]}>Zeit</Text>}
              </View>
              {exercise.sets.map((set, setIndex) => (
                <View key={setIndex} style={styles.tableRow}>
                  <Text style={[styles.cell, styles.cellIndex]}>{setIndex + 1}</Text>
                  <Text style={styles.cell}>{set.reps ?? "–"}</Text>
                  {hasWeight && <Text style={styles.cell}>{set.weightKg !== null ? formatWeight(set.weightKg) : "–"}</Text>}
                  {hasTime && <Text style={styles.cell}>{set.seconds !== null ? formatTime(set.seconds) : "–"}</Text>}
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </>
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
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    content: {
      gap: spacing.md,
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    headerButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    header: {
      gap: spacing.xs,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    muted: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: spacing.xs,
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
    note: {
      ...typography.body,
      color: colors.text,
    },
    photos: {
      gap: spacing.sm,
    },
    photo: {
      width: 160,
      height: 200,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    exercise: {
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    exerciseHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    exerciseName: {
      ...typography.bodyStrong,
      color: colors.text,
      flexShrink: 1,
    },
    trend: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    cell: {
      ...typography.body,
      ...typography.numeric,
      flex: 1,
      color: colors.text,
    },
    cellIndex: {
      flex: 0,
      width: 48,
      color: colors.textSecondary,
    },
    head: {
      ...typography.label,
      color: colors.textSecondary,
    },
  }),
);

export default withReportSheet(WorkoutReportScreen);
