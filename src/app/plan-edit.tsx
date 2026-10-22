import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { LIST_ICON_INSET, ListItem } from "@/components/ui/list-item";
import { SectionFooter, SectionHeader } from "@/components/ui/section-header";
import { spacing, typography } from "@/constants/theme";
import { showActionSheet } from "@/lib/actionSheet";
import { describeError } from "@/lib/errors";
import {
  PLAN_MAX_PLANS,
  VISIBILITY_LABELS,
  activatePlan,
  deletePlan,
  duplicatePlan,
  fetchMyPlans,
  type TrainingPlan,
} from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { track, useTrackScreen } from "@/lib/usage";

function planSubtitle(plan: TrainingPlan): string {
  const training = plan.days.filter((d) => d.type === "training").length;
  const rest = plan.days.length - training;
  const days = `${training} ${training === 1 ? "Trainingstag" : "Trainingstage"}${rest > 0 ? `, ${rest} ${rest === 1 ? "Ruhetag" : "Ruhetage"}` : ""}`;
  const parts = [days, VISIBILITY_LABELS[plan.visibility]];
  if (plan.origin !== null) parts.push(plan.origin);
  if (plan.removed) parts.push("von der Moderation entfernt");
  return parts.join(" · ");
}

/** "Trainingspläne": my plans, one of them active. Everything optional. */
export default function PlansScreen() {
  useTrackScreen("screen_plan_edit");
  const { colors } = useTheme();
  const styles = useStyles();
  const [plans, setPlans] = useState<TrainingPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let active = true;
    fetchMyPlans()
      .then((result) => {
        if (!active) return;
        setFailed(false);
        setPlans(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  function run(action: () => Promise<unknown>) {
    setBusy(true);
    action()
      .then(() => load())
      .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error)))
      .finally(() => setBusy(false));
  }

  function confirmActivate(plan: TrainingPlan) {
    Alert.alert(
      `„${plan.name}“ aktivieren?`,
      "Die Reihenfolge beginnt wieder bei Tag 1 und dein Plan-Streak startet neu. Bisherige Beiträge behalten ihre Zuordnung.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Aktivieren",
          onPress: () =>
            run(async () => {
              await activatePlan(plan.id);
              track("plan_activated");
            }),
        },
      ],
    );
  }

  function confirmDelete(plan: TrainingPlan) {
    Alert.alert(
      `„${plan.name}“ löschen?`,
      `Der Plan mit allen Tagen und Übungen wird gelöscht. Deine Beiträge bleiben erhalten.${plan.isActive ? " Danach hast du keinen aktiven Plan." : ""}`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Löschen", style: "destructive", onPress: () => run(() => deletePlan(plan.id)) },
      ],
    );
  }

  function openMenu(plan: TrainingPlan) {
    showActionSheet(plan.name, [
      { label: "Bearbeiten", onPress: () => router.push({ pathname: "/plan-editor/[planId]", params: { planId: plan.id } }) },
      ...(plan.isActive ? [] : [{ label: "Aktivieren", onPress: () => confirmActivate(plan) }]),
      { label: "Duplizieren", onPress: () => run(() => duplicatePlan(plan.id)) },
      { label: "Löschen", destructive: true, onPress: () => confirmDelete(plan) },
    ]);
  }

  if (plans === null) {
    return (
      <View style={styles.centered}>
        {failed ? <ErrorState onRetry={load} /> : <ActivityIndicator color={colors.textSecondary} />}
      </View>
    );
  }

  const canCreate = plans.length < PLAN_MAX_PLANS;
  const newPlan = () => router.push({ pathname: "/plan-editor/[planId]", params: { planId: "new" } });

  if (plans.length === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="list-outline"
          title="Noch kein Trainingsplan"
          message="Ein Plan ist freiwillig: eine Reihenfolge von Trainings- und Ruhetagen, unabhängig von Wochentagen."
          action={{ label: "Plan anlegen", onPress: newPlan }}
          fill
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionHeader title={`Meine Pläne (${plans.length} von ${PLAN_MAX_PLANS})`} />
      <View style={styles.group}>
        {plans.map((plan, index) => (
          <View key={plan.id}>
            {index > 0 && <Divider inset={LIST_ICON_INSET} />}
            <ListItem
              icon={plan.isActive ? "checkmark-circle" : "list-outline"}
              title={plan.name}
              subtitle={planSubtitle(plan)}
              trailing={plan.isActive ? <Badge value="Aktiv" tone="neutral" /> : undefined}
              onPress={() => openMenu(plan)}
              disabled={busy}
              accessibilityLabel={`${plan.name}${plan.isActive ? ", aktiv" : ""}, ${planSubtitle(plan)}`}
            />
          </View>
        ))}
      </View>
      <SectionFooter>
        Der aktive Plan bestimmt, was auf Home als Nächstes dran ist, und zählt für den Plan-Streak.
      </SectionFooter>
      <View style={styles.padded}>
        <Button label="Neuer Plan" icon="add" variant="secondary" onPress={newPlan} disabled={!canCreate || busy} />
        {!canCreate && <Text style={styles.hint}>Du hast die Höchstzahl von {PLAN_MAX_PLANS} Plänen erreicht.</Text>}
      </View>
    </ScrollView>
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
    },
    group: {
      marginTop: spacing.ms,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    padded: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
