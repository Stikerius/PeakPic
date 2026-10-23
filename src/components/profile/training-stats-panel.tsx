import { router } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { radius, spacing, typography } from "@/constants/theme";
import { showActionSheet } from "@/lib/actionSheet";
import { formatDate } from "@/lib/format";
import { formatTime, formatWeight } from "@/lib/planDraft";
import { makeStyles } from "@/lib/theme";
import {
  bucketize,
  bucketLabel,
  EXERCISE_METRIC_LABELS,
  exerciseMetrics,
  exerciseSeries,
  formatTotalTime,
  personalRecords,
  planDayShares,
  totals,
  type ExerciseMetric,
  type StatsRange,
  type TrainingStats,
} from "@/lib/trainingStats";
import { fetchTrainingStats } from "@/lib/trainingStatsRepo";
import { track } from "@/lib/usage";

const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: "weeks", label: "Wochen" },
  { value: "months", label: "Monate" },
  { value: "year", label: "Jahr" },
];

type ChartMetric = "workouts" | "time" | "volume";

function kg(value: number): string {
  return `${Math.round(value).toLocaleString("de-CH")} kg`;
}

function formatMetric(metric: ExerciseMetric, value: number): string {
  if (metric === "seconds") return formatTime(Math.round(value));
  if (metric === "reps") return String(value);
  if (metric === "volume") return kg(value);
  return `${formatWeight(value)} kg`;
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export type TrainingStatsState = ReturnType<typeof useTrainingStatsState>;

/**
 * State of the "Statistik" tab, kept by the profile so it survives switching tabs. Loads only
 * once `enabled` (the tab was opened), and again when the range changes.
 */
export function useTrainingStatsState(userId: string, enabled: boolean) {
  const [range, setRange] = useState<StatsRange>("weeks");
  // The loaded range is kept with the data, so a new range shows the skeleton without an extra state.
  const [loaded, setLoaded] = useState<{ range: StatsRange; stats: TrainingStats | null } | null>(null);
  const [failed, setFailed] = useState<StatsRange | null>(null);
  const [version, setVersion] = useState(0);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("workouts");
  const [exerciseKey, setExerciseKey] = useState<string | null>(null);
  const [chosenMetric, setChosenMetric] = useState<ExerciseMetric>("e1rm");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchTrainingStats(userId, range)
      .then((stats) => {
        if (!active) return;
        setFailed(null);
        setLoaded({ range, stats });
      })
      .catch(() => {
        if (active) setFailed(range);
      });
    return () => {
      active = false;
    };
  }, [userId, range, version, enabled]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return {
    range, setRange, loaded, failed, refresh, chartMetric, setChartMetric, exerciseKey, setExerciseKey,
    chosenMetric, setChosenMetric,
  };
}

/** "Statistik" tab: aggregated training numbers of a person, as far as the database lets me see them. */
export function TrainingStatsPanel({ state, isMe }: { state: TrainingStatsState; isMe: boolean }) {
  const styles = useStyles();
  const {
    range, setRange, loaded, failed, refresh, chartMetric, setChartMetric, exerciseKey, setExerciseKey,
    chosenMetric, setChosenMetric,
  } = state;

  const header = (
    <SegmentedControl
      value={range}
      options={RANGE_OPTIONS}
      accessibilityLabel="Zeitraum"
      onChange={(value) => {
        setRange(value);
        track("training_stats_range_changed");
      }}
    />
  );

  if (loaded === null || loaded.range !== range) {
    return (
      <View style={styles.content}>
        {header}
        {failed === range ? (
          <ErrorState onRetry={refresh} />
        ) : (
          <View style={styles.skeleton} accessibilityLabel="Statistik wird geladen">
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={160} radius={radius.md} />
          </View>
        )}
      </View>
    );
  }

  const stats = loaded.stats;
  if (stats === null) {
    return (
      <View style={styles.content}>
        <EmptyState icon="lock-closed-outline" title="Diese Statistik ist privat" />
      </View>
    );
  }

  const sum = totals(stats.days);
  const buckets = bucketize(stats.days, stats.from, stats.to, stats.bucket);
  const perLabel = stats.bucket === "week" ? "pro Woche" : "pro Monat";
  const hasVolume = sum.volumeKg !== null;
  const metric: ChartMetric = chartMetric === "volume" && !hasVolume ? "workouts" : chartMetric;
  const chartValue = (b: (typeof buckets)[number]) =>
    metric === "workouts" ? b.workouts : metric === "time" ? b.activeSeconds : (b.volumeKg ?? 0);
  const chartFormat = (value: number) =>
    metric === "workouts"
      ? String(value)
      : metric === "time"
        ? `${(Math.round(value / 360) / 10).toLocaleString("de-CH")} h`
        : `${(Math.round(value / 100) / 10).toLocaleString("de-CH")} t`;
  const shares = planDayShares(stats.planDays, stats.freeWorkouts);
  const exercise = stats.exercises.find((e) => e.key === exerciseKey) ?? stats.exercises[0] ?? null;
  const metrics = exercise !== null ? exerciseMetrics(exercise.points) : [];
  const exerciseMetric = metrics.includes(chosenMetric) ? chosenMetric : (metrics[0] ?? null);
  const series = exercise !== null && exerciseMetric !== null ? exerciseSeries(exercise.points, exerciseMetric) : [];
  const records = exercise !== null ? personalRecords(exercise.points) : null;

  const exerciseList = stats.exercises;
  function chooseExercise() {
    showActionSheet(
      "Übung wählen",
      exerciseList.map((e) => ({
        label: e.name,
        onPress: () => {
          setExerciseKey(e.key);
          track("training_stats_exercise_selected");
        },
      })),
    );
  }

  const recordRows: { label: string; value: string; day: string }[] = [];
  if (records !== null) {
    if (records.heaviest !== null)
      recordRows.push({
        label: "Schwerster Satz",
        value: `${formatWeight(records.heaviest.weightKg)} kg${records.heaviest.reps !== null ? ` × ${records.heaviest.reps}` : ""}`,
        day: records.heaviest.day,
      });
    if (records.bestE1rm !== null)
      recordRows.push({ label: "Max. geschätzt", value: `${formatWeight(records.bestE1rm.valueKg)} kg`, day: records.bestE1rm.day });
    if (records.bestVolume !== null) recordRows.push({ label: "Volumen in einer Einheit", value: kg(records.bestVolume.valueKg), day: records.bestVolume.day });
    if (records.mostReps !== null) recordRows.push({ label: "Meiste Wiederholungen", value: String(records.mostReps.reps), day: records.mostReps.day });
    if (records.longest !== null) recordRows.push({ label: "Längste Dauer", value: formatTime(records.longest.seconds), day: records.longest.day });
  }

  return (
    <View style={styles.content}>
      {header}

      <View style={styles.stats}>
        <Stat label="Trainings" value={String(sum.workouts)} />
        <Stat label="Gesamtzeit" value={formatTotalTime(sum.activeSeconds)} />
        {hasVolume && <Stat label="Volumen" value={kg(sum.volumeKg ?? 0)} />}
        <Stat label="Aktueller Streak" value={`${stats.currentStreak} ${stats.currentStreak === 1 ? "Tag" : "Tage"}`} />
        <Stat label="Längster Streak" value={`${stats.longestStreak} ${stats.longestStreak === 1 ? "Tag" : "Tage"}`} />
      </View>

      {sum.workouts === 0 ? (
        <EmptyState
          icon="bar-chart-outline"
          title="Noch keine Daten"
          message={isMe ? "Starte ein Training, dann erscheinen hier deine Zahlen." : "In diesem Zeitraum gibt es keine Trainings."}
          action={isMe ? { label: "Training starten", onPress: () => router.navigate("/training") } : undefined}
        />
      ) : (
        <>
          <Section title={`${metric === "workouts" ? "Trainings" : metric === "time" ? "Zeit" : "Volumen"} ${perLabel}`}>
            <SegmentedControl
              value={metric}
              accessibilityLabel="Wert im Diagramm"
              options={[
                { value: "workouts", label: "Trainings" },
                { value: "time", label: "Zeit" },
                ...(hasVolume ? [{ value: "volume" as const, label: "Volumen" }] : []),
              ]}
              onChange={setChartMetric}
            />
            <BarChart
              data={buckets.map((b) => ({ key: b.key, label: bucketLabel(b.key, stats.bucket), value: chartValue(b) }))}
              formatValue={chartFormat}
              accessibilityLabel={buckets
                .map((b) => `${bucketLabel(b.key, stats.bucket)}: ${metric === "time" ? formatTotalTime(b.activeSeconds) : metric === "volume" ? kg(b.volumeKg ?? 0) : `${b.workouts} Trainings`}`)
                .join(", ")}
            />
          </Section>

          {shares.length > 0 && (
            <Section title="Nach Plantagen">
              <View style={styles.card}>
                {shares.map((row, index) => (
                  <View key={row.title}>
                    {index > 0 && <Divider />}
                    <View style={styles.shareRow} accessible accessibilityLabel={`${row.title}: ${row.workouts} Trainings`}>
                      <View style={styles.shareText}>
                        <Text style={styles.shareTitle} numberOfLines={1}>
                          {row.title}
                        </Text>
                        <Text style={styles.shareCount}>{row.workouts}</Text>
                      </View>
                      <View style={styles.shareTrack}>
                        <View style={[styles.shareFill, { width: `${Math.max(2, row.share * 100)}%` }]} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {exercise !== null && (
            <Section title="Übungen">
              <View style={styles.card}>
                <ListItem
                  icon="barbell-outline"
                  title={exercise.name}
                  subtitle={`${exercise.sessions} ${exercise.sessions === 1 ? "Einheit" : "Einheiten"} im Zeitraum`}
                  chevron={stats.exercises.length > 1}
                  onPress={stats.exercises.length > 1 ? chooseExercise : undefined}
                  accessibilityLabel={`Übung: ${exercise.name}. Tippen, um eine andere zu wählen.`}
                />
              </View>
              {metrics.length > 1 && exerciseMetric !== null && (
                <SegmentedControl
                  value={exerciseMetric}
                  accessibilityLabel="Wert der Übung"
                  options={metrics.map((m) => ({ value: m, label: EXERCISE_METRIC_LABELS[m] }))}
                  onChange={setChosenMetric}
                />
              )}
              {exerciseMetric !== null && series.length > 0 ? (
                <>
                  <Text style={styles.muted}>
                    {EXERCISE_METRIC_LABELS[exerciseMetric]} pro Einheit
                    {exerciseMetric === "e1rm" ? " (Epley-Formel)" : exerciseMetric === "weight" ? " (höchstes Gewicht)" : ""}
                  </Text>
                  <LineChart
                    points={series.map((p) => ({ key: p.day, value: p.value }))}
                    formatValue={(value) => formatMetric(exerciseMetric, value)}
                    firstLabel={formatDate(series[0]?.day ?? stats.from)}
                    lastLabel={formatDate(series[series.length - 1]?.day ?? stats.to)}
                    accessibilityLabel={series.map((p) => `${formatDate(p.day)}: ${formatMetric(exerciseMetric, p.value)}`).join(", ")}
                  />
                </>
              ) : (
                <Text style={styles.muted}>Für diese Übung sind keine Werte erfasst.</Text>
              )}
              {recordRows.length > 0 && (
                <>
                  <Text style={styles.subTitle}>Bestleistungen im Zeitraum</Text>
                  <View style={styles.card}>
                    {recordRows.map((row, index) => (
                      <View key={row.label}>
                        {index > 0 && <Divider />}
                        <View style={styles.recordRow}>
                          <View style={styles.recordText}>
                            <Text style={styles.recordLabel}>{row.label}</Text>
                            <Text style={styles.muted}>{formatDate(row.day)}</Text>
                          </View>
                          <Text style={styles.recordValue}>{row.value}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </Section>
          )}
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    content: {
      gap: spacing.lg,
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    skeleton: {
      gap: spacing.ms,
    },
    stats: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    stat: {
      minWidth: 140,
      flexGrow: 1,
      flexBasis: "40%",
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
    section: {
      gap: spacing.ms,
    },
    sectionTitle: {
      ...typography.heading,
      color: colors.text,
    },
    subTitle: {
      ...typography.bodyStrong,
      color: colors.text,
    },
    muted: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    card: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    shareRow: {
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.ms,
    },
    shareText: {
      flex: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    shareTitle: {
      ...typography.body,
      flexShrink: 1,
      color: colors.text,
    },
    shareCount: {
      ...typography.body,
      ...typography.numeric,
      color: colors.textSecondary,
    },
    shareTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceRaised,
      overflow: "hidden",
    },
    shareFill: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textSecondary,
    },
    recordRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    recordText: {
      flex: 1,
      gap: 2,
    },
    recordLabel: {
      ...typography.body,
      color: colors.text,
    },
    recordValue: {
      ...typography.bodyStrong,
      ...typography.numeric,
      color: colors.text,
    },
  }),
);
