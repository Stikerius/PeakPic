import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { RoundOrderEditor, type RoundUnit } from "@/components/plans/round-order-editor";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { SectionFooter, SectionHeader } from "@/components/ui/section-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { spacing, typography } from "@/constants/theme";
import { showActionSheet } from "@/lib/actionSheet";
import { describeError } from "@/lib/errors";
import { adjustPlanRound, fetchMyPlan, fetchMyPlanRound, skipPlanRoundUnit, type TrainingPlan } from "@/lib/planRepo";
import { openIds, type PlanRoundState } from "@/lib/planRoundState";
import { makeStyles, useTheme } from "@/lib/theme";
import { track, useTrackScreen } from "@/lib/usage";

type Loaded = { plan: TrainingPlan | null; round: PlanRoundState | null };

/**
 * "Aktueller Durchlauf": the units of the active plan's round, done (locked), next and open.
 * Open units can be reordered (drag or arrows) or skipped any time. Changes show only once the
 * server confirmed them; a refused change goes back to the saved order.
 */
export default function PlanRoundScreen() {
  useTrackScreen("screen_plan_round");
  const { colors } = useTheme();
  const styles = useStyles();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(() => {
    let active = true;
    Promise.all([fetchMyPlan(), fetchMyPlanRound()])
      .then(([plan, round]) => {
        if (!active) return;
        setFailed(false);
        setLoaded({ plan, round: round.round });
        setDraft(null);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  if (loaded === null) {
    return (
      <View style={styles.screen}>
        {failed ? <ErrorState onRetry={() => void load()} fill /> : <ListSkeleton rows={5} avatar={false} />}
      </View>
    );
  }
  const { plan, round } = loaded;
  if (plan === null || round === null) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="list-outline"
          title="Kein aktiver Plan"
          message="Aktiviere einen Plan, dann siehst du hier deinen Durchlauf."
          fill
        />
      </View>
    );
  }

  const unitOf = (id: string): RoundUnit[] => {
    const day = plan.days.find((d) => d.id === id);
    return day === undefined ? [] : [{ id, title: day.title, type: day.type }];
  };
  const done = round.dayOrder.slice(0, round.nextIndex).flatMap(unitOf);
  const savedOpen = openIds(round);
  const open = (draft ?? savedOpen).flatMap(unitOf);
  const skipped = round.skipped.flatMap(unitOf);
  const changed = draft !== null && draft.join(",") !== savedOpen.join(",");

  async function save() {
    if (draft === null) return;
    setBusy(true);
    try {
      await adjustPlanRound(draft);
      track("plan_round_adjusted");
      load();
    } catch (error) {
      setDraft(null); // back to the saved order
      Alert.alert("Nicht gespeichert", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSkip(unit: RoundUnit, mode: "end" | "drop") {
    setBusy(true);
    try {
      await skipPlanRoundUnit(unit.id, mode);
      track("plan_round_unit_skipped");
      load();
    } catch (error) {
      Alert.alert("Hat nicht geklappt", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  function skip(unit: RoundUnit) {
    showActionSheet(`${unit.title} überspringen`, [
      { label: "Ans Ende des Durchlaufs", onPress: () => void runSkip(unit, "end") },
      { label: "In diesem Durchlauf weglassen", onPress: () => void runSkip(unit, "drop") },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} scrollEnabled={!dragging}>
      <Text style={styles.intro}>
        {plan.name}: Ein Durchlauf geht einmal durch alle Tage. Danach beginnt der nächste in der Reihenfolge des Plans.
      </Text>

      {done.length > 0 && (
        <>
          <SectionHeader title="Erledigt" />
          <View style={styles.group}>
            {done.map((unit, index) => (
              <View key={unit.id}>
                {index > 0 && <Divider inset={spacing.md} />}
                <View style={styles.row} accessible accessibilityLabel={`${unit.title}, erledigt`}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.textSecondary} />
                  <Text style={styles.mutedText}>{unit.title}</Text>
                  <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <SectionHeader title="Offen" />
      <RoundOrderEditor units={open} onChange={setDraft} onDragChange={setDragging} disabled={busy} firstIsNext onMore={skip} />
      <SectionFooter>
        Ziehen am Griff oder mit den Pfeilen. Die Reihenfolge gilt für diesen Durchlauf; dein Plan bleibt, wie er ist.
      </SectionFooter>
      {changed && (
        <View style={styles.actions}>
          <Button label="Reihenfolge speichern" onPress={() => void save()} loading={busy} />
          <Button label="Verwerfen" variant="ghost" onPress={() => setDraft(null)} disabled={busy} />
        </View>
      )}

      {skipped.length > 0 && (
        <>
          <SectionHeader title="In diesem Durchlauf weggelassen" />
          <View style={styles.group}>
            {skipped.map((unit, index) => (
              <View key={unit.id}>
                {index > 0 && <Divider inset={spacing.md} />}
                <View style={styles.row} accessible accessibilityLabel={`${unit.title}, weggelassen`}>
                  <Ionicons name="remove-circle-outline" size={20} color={colors.textTertiary} />
                  <Text style={styles.mutedText}>{unit.title}</Text>
                </View>
              </View>
            ))}
          </View>
          <SectionFooter>Weggelassene Einheiten zählen nicht als erledigt und kommen im nächsten Durchlauf wieder.</SectionFooter>
        </>
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
    intro: {
      ...typography.caption,
      color: colors.textSecondary,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    group: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    row: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
    },
    mutedText: {
      ...typography.body,
      flex: 1,
      color: colors.textSecondary,
    },
    actions: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
  }),
);
