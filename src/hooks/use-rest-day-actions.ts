import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { describeError } from "@/lib/errors";
import { applyRestDay, undoRestDay, type MyRestDays } from "@/lib/restRepo";
import { addDays, canUseRestDay, restStatus, type DayKey } from "@/lib/streak";

type RestDayActions = {
  busy: boolean;
  /** Asks to use a rest day for `day`, or explains why it isn't possible. */
  requestUse: (day: DayKey) => void;
  /** Asks to take back the rest day on `day`. */
  requestUndo: (day: DayKey) => void;
  /** Use or take back, whichever fits `day` (for tapping a calendar day). */
  requestToggle: (day: DayKey) => void;
};

/** The rest day dialogs, shared by the Home card and the calendar. */
export function useRestDayActions(
  rest: MyRestDays,
  trainingDays: ReadonlySet<DayKey>,
  today: DayKey,
  onChanged: () => void,
): RestDayActions {
  const [busy, setBusy] = useState(false);
  const dayName = (day: DayKey) => (day === today ? "heute" : "gestern");

  function run(action: () => Promise<void>) {
    setBusy(true);
    action()
      .then(onChanged)
      .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error)))
      .finally(() => setBusy(false));
  }

  function requestUse(day: DayKey) {
    if (rest.budget === null || rest.budget.restsPerWeek === 0) {
      Alert.alert("Keine Ruhetage eingerichtet", "Du kannst Ruhetage pro Woche im Profil unter „Profil bearbeiten“ festlegen.", [
        { text: "Später", style: "cancel" },
        { text: "Zum Profil", onPress: () => router.push("/profile-edit") },
      ]);
      return;
    }
    if (day !== today && day !== addDays(today, -1)) {
      Alert.alert("Nicht möglich", "Ruhetage gehen nur für heute oder gestern.");
      return;
    }
    if (trainingDays.has(day)) {
      Alert.alert("Nicht nötig", `Du hast ${dayName(day)} schon trainiert.`);
      return;
    }
    const status = restStatus(rest.budget, rest.uses, day);
    if (!canUseRestDay(day, today, rest.budget, rest.uses, trainingDays)) {
      Alert.alert("Keine Ruhetage übrig", `In dieser Woche hast du alle ${status.total} Ruhetage genutzt.`);
      return;
    }
    Alert.alert(
      `Ruhetag für ${dayName(day)} setzen?`,
      `Dein Streak läuft weiter, ohne dass der Tag mitzählt. Danach diese Woche übrig: ${status.remaining - 1} von ${status.total}.`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Setzen", onPress: () => run(() => applyRestDay(day)) },
      ],
    );
  }

  function requestUndo(day: DayKey) {
    const planned = rest.planned.includes(day);
    Alert.alert(`Ruhetag ${dayName(day)} zurücknehmen?`, planned ? "Der geplante Ruhetag gilt dann als nicht bestätigt." : "Der Ruhetag wird wieder gutgeschrieben.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Zurücknehmen", style: "destructive", onPress: () => run(() => undoRestDay(day)) },
    ]);
  }

  function requestToggle(day: DayKey) {
    if (rest.uses.includes(day) || rest.planned.includes(day)) requestUndo(day);
    else requestUse(day);
  }

  return { busy, requestUse, requestUndo, requestToggle };
}
