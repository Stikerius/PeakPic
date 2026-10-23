import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";

import { RoundOrderEditor, type RoundUnit } from "@/components/plans/round-order-editor";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { resolvePlanDeviation, type MyPlanRound, type TrainingPlan } from "@/lib/planRepo";
import { deviationProposal } from "@/lib/planRoundState";
import { makeStyles } from "@/lib/theme";
import { track } from "@/lib/usage";

type PlanDeviationPromptProps = {
  plan: TrainingPlan | null;
  round: MyPlanRound;
  /** After an answer the server accepted: reload the round. */
  onChanged: () => void;
};

/**
 * "Du hast Pull statt Push trainiert. Wie soll dein Plan weitergehen?" Shown on Home and Training
 * while a question is open; "Später entscheiden" closes it until the screen is opened again (after
 * 2 days the server makes it an exception). Never a warning: any unit is fine.
 */
export function PlanDeviationPrompt({ plan, round, onChanged }: PlanDeviationPromptProps) {
  const styles = useStyles();
  const pending = round.round?.pending ?? null;
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [step, setStep] = useState<"choose" | "reorder">("choose");
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // "Später": ask again the next time the screen is opened.
  useFocusEffect(
    useCallback(() => {
      return () => setDismissedId(null);
    }, []),
  );

  // Questions the server turned into an exception after 2 days: a short notice, once.
  const autoResolved = round.autoResolved;
  useEffect(() => {
    const first = autoResolved[0];
    if (first === undefined) return;
    Alert.alert(
      "Plan läuft weiter",
      `Du hattest ${first.doneTitle} statt ${first.expectedTitle} trainiert und nicht entschieden. Das gilt jetzt als Ausnahme, dein Plan läuft wie geplant weiter.`,
    );
  }, [autoResolved]);

  if (plan === null || pending === null || pending.id === dismissedId || round.round === null) return null;
  const state = round.round;
  const titleOf = (id: string) => plan.days.find((d) => d.id === id);
  const units: RoundUnit[] = order.flatMap((id) => {
    const day = titleOf(id);
    return day === undefined ? [] : [{ id, title: day.title, type: day.type }];
  });

  function close() {
    setDismissedId(pending?.id ?? null);
    setStep("choose");
    setError(null);
  }

  async function answer(decision: "exception" | "reordered", scope: "round" | "plan" | null) {
    if (pending === null) return;
    setBusy(true);
    setError(null);
    try {
      await resolvePlanDeviation(pending.id, decision, decision === "reordered" ? order : null, scope);
      track(decision === "exception" ? "plan_deviation_exception" : "plan_deviation_reordered");
      setStep("choose");
      onChanged();
    } catch (answerError) {
      setError(describeError(answerError));
    } finally {
      setBusy(false);
    }
  }

  function startReorder() {
    if (pending === null) return;
    setOrder(deviationProposal(state, pending.doneDayId));
    setStep("reorder");
  }

  return (
    <Sheet visible title="Dein Plan" onClose={close} heightFraction={step === "reorder" ? 0.85 : 0.5}>
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging}>
        {step === "choose" ? (
          <>
            <Text style={styles.question}>
              Du hast {pending.doneTitle} statt {pending.expectedTitle} trainiert. Wie soll dein Plan weitergehen?
            </Text>
            <Button
              label="Ausnahme, Plan läuft wie geplant weiter"
              variant="secondary"
              onPress={() => void answer("exception", null)}
              loading={busy}
            />
            <Text style={styles.explain}>
              {pending.expectedTitle} bleibt als Nächstes dran, {pending.doneTitle} kommt in diesem Durchlauf noch.
            </Text>
            <Button label="Reihenfolge anpassen" variant="secondary" onPress={startReorder} disabled={busy} />
            <Text style={styles.explain}>{pending.doneTitle} gilt als erledigt, du ordnest den Rest.</Text>
            <Button label="Später entscheiden" variant="ghost" onPress={close} disabled={busy} />
          </>
        ) : (
          <>
            <Text style={styles.question}>
              {pending.doneTitle} gilt als erledigt. So geht dein Durchlauf weiter:
            </Text>
            <RoundOrderEditor units={units} onChange={setOrder} onDragChange={setDragging} disabled={busy} />
            <Button label="Nur für diesen Durchlauf" onPress={() => void answer("reordered", "round")} loading={busy} />
            <Button
              label="Plan dauerhaft ändern"
              variant="secondary"
              onPress={() => void answer("reordered", "plan")}
              disabled={busy}
            />
            <Button label="Zurück" variant="ghost" onPress={() => setStep("choose")} disabled={busy} />
          </>
        )}
        {error !== null && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    content: {
      gap: spacing.ms,
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    question: {
      ...typography.body,
      color: colors.text,
    },
    explain: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: -spacing.xs,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
  }),
);
