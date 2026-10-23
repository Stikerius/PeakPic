import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { ExerciseEditor, IconButton } from "@/components/plans/exercise-editor";
import { Button } from "@/components/ui/button";
import { DraggableList } from "@/components/ui/draggable-list";
import { ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { SectionFooter, SectionHeader } from "@/components/ui/section-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { radius, spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import {
  PLAN_DAY_NOTES_MAX_LENGTH,
  PLAN_DAY_TITLE_MAX_LENGTH,
  PLAN_MAX_DAYS,
  PLAN_MAX_EXERCISES,
  PLAN_NAME_MAX_LENGTH,
  formatReps,
  formatTime,
  formatWeight,
  moveItem,
  planDraftError,
  type DayDraft,
  type ExerciseDraft,
  type PlanDayType,
} from "@/lib/planDraft";
import { confirmDeactivatePlan } from "@/lib/planActivation";
import { deletePlan, fetchExerciseNames, fetchPlanById, savePlan, type TrainingPlan } from "@/lib/planRepo";
import { moveLabel, moveTo } from "@/lib/sortable";
import { makeStyles, useTheme } from "@/lib/theme";
import { track, useTrackScreen } from "@/lib/usage";
import type { PlanVisibility } from "@/types/database";

const VISIBILITY_OPTIONS: { value: PlanVisibility; label: string }[] = [
  { value: "private", label: "Nur ich" },
  { value: "followers", label: "Follower" },
  { value: "public", label: "Alle" },
];

const DAY_TYPE_OPTIONS: { value: PlanDayType; label: string }[] = [
  { value: "training", label: "Training" },
  { value: "rest", label: "Ruhetag" },
];

// Stable keys for list rows while reordering (not saved).
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `k${keyCounter}`;
}

function newExercise(): ExerciseDraft {
  return { key: nextKey(), id: null, name: "", sets: "3", reps: "", time: "", weight: "", notes: "" };
}

function newDay(type: PlanDayType): DayDraft {
  return { key: nextKey(), id: null, type, title: type === "rest" ? "Ruhetag" : "", notes: "", exercises: [] };
}

/** What a day is called in lists and VoiceOver labels. */
function dayName(day: DayDraft, index: number): string {
  const title = day.title.trim();
  return title !== "" ? title : day.type === "rest" ? "Ruhetag" : `Tag ${index + 1}`;
}

function toDrafts(plan: TrainingPlan): DayDraft[] {
  return plan.days.map((d) => ({
    key: nextKey(),
    id: d.id,
    type: d.type,
    title: d.title,
    notes: d.notes ?? "",
    exercises: d.exercises.map((e) => ({
      key: nextKey(),
      id: e.id,
      name: e.name,
      sets: String(e.sets),
      reps: formatReps(e.repsMin, e.repsMax),
      time: e.targetSeconds !== null ? formatTime(e.targetSeconds) : "",
      weight: formatWeight(e.targetWeightKg),
      notes: e.notes ?? "",
    })),
  }));
}

/** Edit or create one plan: name, visibility, days (training or rest) with exercises. */
export default function PlanEditorScreen() {
  useTrackScreen("screen_plan_editor");
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const isNew = planId === "new";
  const { colors } = useTheme();
  const styles = useStyles();
  const [plan, setPlan] = useState<TrainingPlan | null | undefined>(isNew ? null : undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<PlanVisibility>("private");
  const [allowAdopt, setAllowAdopt] = useState(true);
  const [days, setDays] = useState<DayDraft[]>(() => (isNew ? [newDay("training")] : []));
  const [knownNames, setKnownNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No scrolling while a row is dragged.
  const [dragging, setDragging] = useState(false);
  const load = useCallback(() => {
    fetchExerciseNames()
      .then(setKnownNames)
      .catch(() => undefined);
    if (isNew) return;
    fetchPlanById(planId)
      .then((result) => {
        setPlan(result);
        if (result === null) return;
        setName(result.name);
        setVisibility(result.visibility);
        setAllowAdopt(result.allowAdopt);
        setDays(toDrafts(result));
      })
      .catch(() => setLoadFailed(true));
  }, [isNew, planId]);

  useEffect(load, [load]);

  function updateDay(dayKey: string, change: Partial<DayDraft>) {
    setDays((current) => current.map((d) => (d.key === dayKey ? { ...d, ...change } : d)));
  }

  function updateExercise(dayKey: string, exerciseKey: string, change: Partial<ExerciseDraft>) {
    setDays((current) =>
      current.map((d) =>
        d.key === dayKey ? { ...d, exercises: d.exercises.map((e) => (e.key === exerciseKey ? { ...e, ...change } : e)) } : d,
      ),
    );
  }

  function duplicateDay(index: number) {
    setDays((current) => {
      const source = current[index];
      if (source === undefined || current.length >= PLAN_MAX_DAYS) return current;
      const copy: DayDraft = {
        ...source,
        key: nextKey(),
        id: null,
        exercises: source.exercises.map((e) => ({ ...e, key: nextKey(), id: null })),
      };
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
    });
  }

  function confirmRemoveDay(day: DayDraft, index: number) {
    const remove = () => setDays((current) => current.filter((d) => d.key !== day.key));
    if (day.exercises.length === 0) {
      remove();
      return;
    }
    Alert.alert(`Tag ${index + 1} entfernen?`, "Der Tag und seine Übungen werden beim Speichern entfernt.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Entfernen", style: "destructive", onPress: remove },
    ]);
  }

  /** Days of the stored plan in their stored order (to see whether the order changed). */
  const storedOrder = plan?.days.map((d) => d.id).join(",") ?? "";
  const draftOrder = days.flatMap((d) => (d.id !== null ? [d.id] : [])).join(",");
  const orderChanged = plan !== null && plan !== undefined && (draftOrder !== storedOrder || days.some((d) => d.id === null));

  function save() {
    const problem = planDraftError(name, days);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (plan?.isActive === true && orderChanged) {
      Alert.alert(
        "Reihenfolge des aktiven Plans",
        "Es wird nichts zurückgesetzt: Was du in diesem Durchlauf schon gemacht hast, bleibt erledigt. Als Nächstes kommt die erste noch offene Einheit in der neuen Reihenfolge, und dein Plan-Streak läuft weiter.",
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Speichern", onPress: () => void store() },
        ],
      );
      return;
    }
    void store();
  }

  async function store() {
    setSaving(true);
    setError(null);
    try {
      await savePlan(isNew ? null : planId, name, visibility, allowAdopt, days);
      if (orderChanged) track("plan_days_reordered");
      router.back();
    } catch (saveError) {
      setError(`Speichern fehlgeschlagen. ${describeError(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (plan === null || plan === undefined) return;
    Alert.alert("Plan löschen?", "Der Plan mit allen Tagen und Übungen wird gelöscht. Deine Beiträge bleiben erhalten.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: () => {
          setSaving(true);
          deletePlan(plan.id)
            .then(() => router.back())
            .catch((deleteError: unknown) => setError(`Löschen fehlgeschlagen. ${describeError(deleteError)}`))
            .finally(() => setSaving(false));
        },
      },
    ]);
  }

  if (plan === undefined) {
    return (
      <View style={styles.centered}>
        {loadFailed ? (
          <ErrorState
            onRetry={() => {
              setLoadFailed(false);
              load();
            }}
          />
        ) : (
          <ActivityIndicator color={colors.textSecondary} />
        )}
      </View>
    );
  }
  if (plan === null && !isNew) {
    return (
      <View style={styles.centered}>
        <ErrorState message="Diesen Plan gibt es nicht mehr." />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!dragging}>
        <SectionHeader title="Plan" />
        <View style={styles.padded}>
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="z.B. Push / Pull / Beine"
            maxLength={PLAN_NAME_MAX_LENGTH}
          />
        </View>
        <View style={[styles.padded, styles.field]}>
          <Text style={styles.fieldLabel}>Wer sieht diesen Plan</Text>
          <SegmentedControl value={visibility} options={VISIBILITY_OPTIONS} onChange={setVisibility} accessibilityLabel="Wer sieht diesen Plan" />
        </View>
        {visibility !== "private" && (
          <View style={styles.group}>
            <ListItem
              title="Übernehmen erlauben"
              trailing={
                <Switch
                  value={allowAdopt}
                  onValueChange={setAllowAdopt}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  accessibilityLabel="Übernehmen erlauben"
                />
              }
            />
          </View>
        )}
        <SectionFooter>
          „Alle“ gilt nur bei öffentlichem Profil, sonst sehen ihn nur bestätigte Follower. Wer den Plan übernimmt,
          bekommt eine Kopie ohne Zielgewichte und Notizen.
        </SectionFooter>

        <SectionHeader title={`Tage (${days.length})`} />
        <Text style={styles.intro}>
          Die Tage wiederholen sich in dieser Reihenfolge, unabhängig von Wochentagen. Ein Ruhetag gilt für den Tag
          nach dem vorherigen Training.
        </Text>
        {days.length > 1 && (
          <>
            <Text style={styles.orderTitle}>Reihenfolge</Text>
            <View style={styles.group}>
              <DraggableList
                items={days}
                keyOf={(day) => day.key}
                onMove={(from, to) => setDays((c) => moveTo(c, from, to))}
                onDragChange={setDragging}
                renderItem={(day, index, handle) => (
                  <View style={[styles.orderRow, index > 0 && styles.orderDivider]}>
                    {handle}
                    <View style={styles.flex}>
                      <Text style={styles.orderText} numberOfLines={1}>
                        {index + 1}. {dayName(day, index)}
                      </Text>
                      <Text style={styles.orderMeta}>{day.type === "rest" ? "Ruhetag" : `${day.exercises.length} Übungen`}</Text>
                    </View>
                    <IconButton
                      icon="chevron-up"
                      label={moveLabel(dayName(day, index), index, days.length, "up")}
                      onPress={() => setDays((c) => moveItem(c, index, -1))}
                      disabled={index === 0}
                    />
                    <IconButton
                      icon="chevron-down"
                      label={moveLabel(dayName(day, index), index, days.length, "down")}
                      onPress={() => setDays((c) => moveItem(c, index, 1))}
                      disabled={index === days.length - 1}
                    />
                  </View>
                )}
              />
            </View>
            <Text style={styles.hint}>Zum Ziehen den Griff kurz gedrückt halten.</Text>
          </>
        )}
        {days.map((day, index) => (
          <View key={day.key} style={styles.day}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayLabel}>Tag {index + 1}</Text>
              <View style={styles.dayActions}>
                <IconButton
                  icon="chevron-up"
                  label={moveLabel(dayName(day, index), index, days.length, "up")}
                  onPress={() => setDays((c) => moveItem(c, index, -1))}
                  disabled={index === 0}
                />
                <IconButton
                  icon="chevron-down"
                  label={moveLabel(dayName(day, index), index, days.length, "down")}
                  onPress={() => setDays((c) => moveItem(c, index, 1))}
                  disabled={index === days.length - 1}
                />
                <IconButton icon="copy-outline" label={`Tag ${index + 1} duplizieren`} onPress={() => duplicateDay(index)} disabled={days.length >= PLAN_MAX_DAYS} />
                <IconButton
                  icon="trash-outline"
                  label={`Tag ${index + 1} entfernen`}
                  onPress={() => confirmRemoveDay(day, index)}
                  disabled={days.length === 1}
                  destructive
                />
              </View>
            </View>
            <SegmentedControl
              value={day.type}
              options={DAY_TYPE_OPTIONS}
              onChange={(type) => updateDay(day.key, { type, title: type === "rest" && day.title === "" ? "Ruhetag" : day.title })}
              accessibilityLabel={`Art von Tag ${index + 1}`}
            />
            <TextField
              label="Name"
              value={day.title}
              onChangeText={(title) => updateDay(day.key, { title })}
              placeholder={day.type === "rest" ? "Ruhetag" : "z.B. Push"}
              maxLength={PLAN_DAY_TITLE_MAX_LENGTH}
            />
            {day.type === "training" && (
              <>
                <DraggableList
                  items={day.exercises}
                  keyOf={(exercise) => exercise.key}
                  onMove={(from, to) => updateDay(day.key, { exercises: moveTo(day.exercises, from, to) })}
                  onDragChange={setDragging}
                  renderItem={(exercise, exIndex, handle) => (
                    <ExerciseEditor
                      exercise={exercise}
                      label={`Übung ${exIndex + 1}`}
                      knownNames={knownNames}
                      isFirst={exIndex === 0}
                      isLast={exIndex === day.exercises.length - 1}
                      position={{ index: exIndex, total: day.exercises.length }}
                      handle={day.exercises.length > 1 ? handle : undefined}
                      onChange={(change) => updateExercise(day.key, exercise.key, change)}
                      onMove={(by) => updateDay(day.key, { exercises: moveItem(day.exercises, exIndex, by) })}
                      onRemove={() => updateDay(day.key, { exercises: day.exercises.filter((e) => e.key !== exercise.key) })}
                    />
                  )}
                />
                <Button
                  label="Übung hinzufügen"
                  icon="add"
                  variant="ghost"
                  size="sm"
                  onPress={() => updateDay(day.key, { exercises: [...day.exercises, newExercise()] })}
                  disabled={day.exercises.length >= PLAN_MAX_EXERCISES}
                  style={styles.addExercise}
                />
              </>
            )}
            <TextField
              label="Notizen (optional)"
              value={day.notes}
              onChangeText={(notes) => updateDay(day.key, { notes })}
              maxLength={PLAN_DAY_NOTES_MAX_LENGTH}
              multiline
            />
          </View>
        ))}
        <View style={[styles.padded, styles.addDays]}>
          <Button
            label="Trainingstag"
            icon="add"
            variant="secondary"
            onPress={() => setDays((c) => [...c, newDay("training")])}
            disabled={days.length >= PLAN_MAX_DAYS}
            style={styles.flex}
          />
          <Button
            label="Ruhetag"
            icon="add"
            variant="secondary"
            onPress={() => setDays((c) => [...c, newDay("rest")])}
            disabled={days.length >= PLAN_MAX_DAYS}
            style={styles.flex}
          />
        </View>

        {error !== null && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <View style={[styles.padded, styles.actions]}>
          <Button label="Speichern" onPress={save} loading={saving} />
          {plan?.isActive === true && (
            <Button
              label="Plan deaktivieren"
              variant="ghost"
              onPress={() => confirmDeactivatePlan(() => router.back())}
              disabled={saving}
            />
          )}
          {plan !== null && <Button label="Plan löschen" variant="ghost" destructive onPress={confirmDelete} disabled={saving} />}
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
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    content: {
      paddingBottom: spacing.xl,
      gap: spacing.sm,
    },
    padded: {
      paddingHorizontal: spacing.md,
    },
    field: {
      gap: spacing.sm,
    },
    fieldLabel: {
      ...typography.label,
      color: colors.textSecondary,
    },
    group: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    intro: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
    },
    day: {
      gap: spacing.ms,
      marginHorizontal: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    dayHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dayLabel: {
      ...typography.bodyStrong,
      color: colors.text,
    },
    orderTitle: {
      ...typography.label,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
    },
    orderRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingRight: spacing.xs,
      backgroundColor: colors.surface,
    },
    orderDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    orderText: {
      ...typography.body,
      color: colors.text,
    },
    orderMeta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
    },
    dayActions: {
      flexDirection: "row",
      marginRight: -spacing.sm,
    },
    addExercise: {
      alignSelf: "flex-start",
    },
    addDays: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    flex: {
      flex: 1,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    actions: {
      gap: spacing.sm,
      paddingTop: spacing.lg,
    },
  }),
);
