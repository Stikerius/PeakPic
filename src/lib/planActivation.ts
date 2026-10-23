import { Alert } from "react-native";

import { describeError } from "@/lib/errors";
import { activatePlan, deactivatePlan, type TrainingPlan } from "@/lib/planRepo";
import { track } from "@/lib/usage";

/** "Plan deaktivieren" with a confirmation; `onDone` after the server confirmed it. */
export function confirmDeactivatePlan(onDone: () => void): void {
  Alert.alert(
    "Plan deaktivieren?",
    "Danach hast du keinen aktiven Plan: kein „Heute dran“, keine Plan-Frage beim Posten, und dein Plan-Streak endet. Dein normaler Streak, deine Trainings und Beiträge bleiben, wie sie sind. Du kannst den Plan jederzeit wieder aktivieren.",
    [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Deaktivieren",
        style: "destructive",
        onPress: () => {
          deactivatePlan()
            .then(() => {
              track("plan_deactivated");
              onDone();
            })
            .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error)));
        },
      },
    ],
  );
}

/**
 * Activating a plan. A plan I deactivated myself can start at day 1 or continue where I stopped;
 * any other plan starts at day 1 (the plan streak runs anew).
 */
export function confirmActivatePlan(plan: TrainingPlan, onDone: () => void): void {
  const run = (resume: boolean) =>
    activatePlan(plan.id, resume)
      .then(() => {
        track("plan_activated");
        onDone();
      })
      .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error)));
  if (plan.deactivatedAt !== null) {
    Alert.alert(
      `„${plan.name}“ wieder aktivieren?`,
      "Du kannst bei Tag 1 beginnen (dein Plan-Streak startet neu) oder dort weitermachen, wo du aufgehört hast.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Bei Tag 1 beginnen", onPress: () => void run(false) },
        { text: "Dort weitermachen", onPress: () => void run(true) },
      ],
    );
    return;
  }
  Alert.alert(
    `„${plan.name}“ aktivieren?`,
    "Die Reihenfolge beginnt bei Tag 1 und dein Plan-Streak startet neu. Bisherige Beiträge und Trainings behalten ihre Zuordnung.",
    [
      { text: "Abbrechen", style: "cancel" },
      { text: "Aktivieren", onPress: () => void run(false) },
    ],
  );
}
