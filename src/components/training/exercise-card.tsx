import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { IconButton } from "@/components/plans/exercise-editor";
import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { randomUuid } from "@/lib/ids";
import { exerciseSummary, formatTime, suggestNames } from "@/lib/planDraft";
import { makeStyles, useTheme } from "@/lib/theme";
import {
  WORKOUT_RULES,
  exerciseDurationMs,
  formatDuration,
  newSet,
  parseSet,
  stopwatchMs,
  type DraftExercise,
  type DraftSet,
} from "@/lib/workout";

type ExerciseCardProps = {
  exercise: DraftExercise;
  index: number;
  count: number;
  now: number;
  knownNames: readonly string[];
  onChange: (next: DraftExercise) => void;
  onCompleteSet: (setKey: string) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
};

/** One exercise of the running training: name, target, sets with "Satz fertig", stopwatch. */
export function ExerciseCard({ exercise, index, count, now, knownNames, onChange, onCompleteSet, onMove, onRemove }: ExerciseCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [nameFocused, setNameFocused] = useState(false);
  const [setError, setSetError] = useState<string | null>(null);
  const suggestions = nameFocused ? suggestNames(exercise.name, knownNames, 4) : [];
  const duration = exerciseDurationMs(exercise);
  const running = exercise.stopwatch.startedAt !== null;

  function updateSet(key: string, change: Partial<DraftSet>) {
    onChange({ ...exercise, sets: exercise.sets.map((s) => (s.key === key ? { ...s, ...change } : s)) });
  }

  function complete(set: DraftSet) {
    const values = parseSet(set, exercise.timed);
    if (typeof values === "string") {
      setSetError(values);
      return;
    }
    setSetError(null);
    onCompleteSet(set.key);
  }

  function addSet() {
    if (exercise.sets.length >= WORKOUT_RULES.maxSetsPerExercise) return;
    const last = exercise.sets[exercise.sets.length - 1];
    const prefill = last !== undefined ? { reps: last.reps, weight: last.weight, seconds: last.seconds } : undefined;
    onChange({ ...exercise, sets: [...exercise.sets, newSet(randomUuid(), prefill)] });
  }

  function toggleStopwatch() {
    const sw = exercise.stopwatch;
    if (sw.startedAt === null) {
      onChange({ ...exercise, stopwatch: { ...sw, startedAt: now } });
      return;
    }
    // Stop: the time goes into the first open set.
    const ms = stopwatchMs(sw, now);
    const open = exercise.sets.find((s) => !s.done);
    onChange({
      ...exercise,
      stopwatch: { startedAt: null, accumulatedMs: 0 },
      sets: exercise.sets.map((s) => (s === open ? { ...s, seconds: formatTime(Math.round(ms / 1000)) } : s)),
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>Übung {index + 1}</Text>
        <View style={styles.headerActions}>
          <IconButton icon="chevron-up" label={`Übung ${index + 1} nach oben`} onPress={() => onMove(-1)} disabled={index === 0} />
          <IconButton icon="chevron-down" label={`Übung ${index + 1} nach unten`} onPress={() => onMove(1)} disabled={index === count - 1} />
          <IconButton icon="trash-outline" label={`Übung ${index + 1} entfernen`} onPress={onRemove} destructive />
        </View>
      </View>
      <TextInput
        value={exercise.name}
        onChangeText={(name) => onChange({ ...exercise, name })}
        onFocus={() => setNameFocused(true)}
        onBlur={() => setNameFocused(false)}
        placeholder="Übung, z.B. Kniebeugen"
        placeholderTextColor={colors.textTertiary}
        maxLength={60}
        style={styles.name}
        accessibilityLabel={`Name von Übung ${index + 1}`}
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((name) => (
            <Pressable
              key={name}
              onPress={() => onChange({ ...exercise, name })}
              accessibilityRole="button"
              accessibilityLabel={`Vorschlag ${name}`}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
            >
              <Text style={styles.suggestionText}>{name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {exercise.target !== null && (
        <Text style={styles.target}>
          Ziel:{" "}
          {exerciseSummary({
            sets: exercise.target.sets,
            repsMin: exercise.target.repsMin,
            repsMax: exercise.target.repsMax,
            targetSeconds: exercise.target.seconds,
            targetWeightKg: exercise.target.weightKg,
          })}
        </Text>
      )}
      <View style={styles.modeRow}>
        <Pressable
          onPress={() => onChange({ ...exercise, timed: !exercise.timed })}
          accessibilityRole="switch"
          accessibilityState={{ checked: exercise.timed }}
          accessibilityLabel="Zeitübung"
          style={styles.modeToggle}
        >
          <Ionicons name={exercise.timed ? "checkbox" : "square-outline"} size={20} color={colors.textSecondary} />
          <Text style={styles.modeText}>Zeitübung</Text>
        </Pressable>
        {duration > 0 && <Text style={styles.duration}>Dauer {formatDuration(duration)}</Text>}
      </View>
      {exercise.timed && (
        <View style={styles.stopwatch}>
          <Text style={styles.stopwatchTime}>{formatDuration(stopwatchMs(exercise.stopwatch, now))}</Text>
          <Button
            label={running ? "Stopp" : "Stoppuhr starten"}
            icon={running ? "stop" : "play"}
            variant="secondary"
            size="sm"
            onPress={toggleStopwatch}
          />
        </View>
      )}

      <View style={styles.setHeader}>
        <Text style={[styles.colLabel, styles.colIndex]}>Satz</Text>
        <Text style={[styles.colLabel, styles.col]}>{exercise.timed ? "Zeit" : "Wdh."}</Text>
        <Text style={[styles.colLabel, styles.col]}>kg (optional)</Text>
        <View style={styles.colAction} />
      </View>
      {exercise.sets.map((set, setIndex) => (
        <View key={set.key} style={[styles.setRow, set.done && styles.setDone]}>
          <Text style={[styles.setIndex, styles.colIndex]}>{setIndex + 1}</Text>
          <TextInput
            value={exercise.timed ? set.seconds : set.reps}
            onChangeText={(text) => updateSet(set.key, exercise.timed ? { seconds: text } : { reps: text })}
            keyboardType={exercise.timed ? "numbers-and-punctuation" : "number-pad"}
            placeholder={exercise.timed ? "0:45" : "10"}
            placeholderTextColor={colors.textTertiary}
            maxLength={exercise.timed ? 6 : 4}
            editable={!set.done}
            style={[styles.input, styles.col]}
            accessibilityLabel={`Satz ${setIndex + 1}, ${exercise.timed ? "Zeit" : "Wiederholungen"}`}
          />
          <TextInput
            value={set.weight}
            onChangeText={(weight) => updateSet(set.key, { weight })}
            keyboardType="decimal-pad"
            placeholder="–"
            placeholderTextColor={colors.textTertiary}
            maxLength={7}
            editable={!set.done}
            style={[styles.input, styles.col]}
            accessibilityLabel={`Satz ${setIndex + 1}, Gewicht in kg`}
          />
          <View style={styles.colAction}>
            {set.done ? (
              <IconButton
                icon="checkmark-circle"
                label={`Satz ${setIndex + 1} erledigt, antippen zum Bearbeiten`}
                onPress={() => updateSet(set.key, { done: false, completedAt: null })}
              />
            ) : (
              <IconButton icon="ellipse-outline" label={`Satz ${setIndex + 1} fertig`} onPress={() => complete(set)} />
            )}
            <IconButton
              icon="close"
              label={`Satz ${setIndex + 1} entfernen`}
              onPress={() => onChange({ ...exercise, sets: exercise.sets.filter((s) => s.key !== set.key) })}
            />
          </View>
        </View>
      ))}
      {setError !== null && <Text style={styles.error}>{setError}</Text>}
      <Button
        label="Satz hinzufügen"
        icon="add"
        variant="ghost"
        size="sm"
        onPress={addSet}
        disabled={exercise.sets.length >= WORKOUT_RULES.maxSetsPerExercise}
        style={styles.addSet}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerActions: {
      flexDirection: "row",
      marginRight: -spacing.sm,
    },
    label: {
      ...typography.label,
      color: colors.textSecondary,
    },
    name: {
      ...typography.heading,
      color: colors.text,
      minHeight: 44,
    },
    suggestions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    suggestion: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    suggestionText: {
      ...typography.caption,
      color: colors.text,
    },
    pressed: {
      opacity: 0.6,
    },
    target: {
      ...typography.caption,
      ...typography.numeric,
      color: colors.textSecondary,
    },
    modeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modeToggle: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    modeText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    duration: {
      ...typography.caption,
      ...typography.numeric,
      color: colors.textSecondary,
    },
    stopwatch: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    stopwatchTime: {
      ...typography.heading,
      ...typography.numeric,
      color: colors.text,
    },
    setHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    colLabel: {
      ...typography.label,
      color: colors.textSecondary,
    },
    colIndex: {
      width: 36,
    },
    col: {
      flex: 1,
    },
    colAction: {
      width: 88,
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    setRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.md,
    },
    setDone: {
      backgroundColor: colors.surfaceRaised,
    },
    setIndex: {
      ...typography.body,
      ...typography.numeric,
      color: colors.textSecondary,
      textAlign: "center",
    },
    input: {
      ...typography.body,
      ...typography.numeric,
      minHeight: 44,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
      color: colors.text,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
    addSet: {
      alignSelf: "flex-start",
    },
  }),
);
