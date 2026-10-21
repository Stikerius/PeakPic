import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { radius, spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { applyRestDay, undoRestDay, type MyRestDays } from "@/lib/restRepo";
import { addDays, canUseRestDay, parseDayKey, restStatus, type DayKey } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";

type RestDaysCardProps = {
  rest: MyRestDays;
  trainingDays: ReadonlySet<DayKey>;
  today: DayKey;
  /** Called after a rest day was used or taken back. */
  onChanged: () => void;
};

function shortDate(day: DayKey): string {
  const { day: d, month } = parseDayKey(day);
  return `${d}.${month}.`;
}

/**
 * "Ruhetage übrig: X von Y" with a button for yesterday or today when there was no training.
 * Only rendered for people with a rest day budget.
 */
export function RestDaysCard({ rest, trainingDays, today, onChanged }: RestDaysCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  if (rest.budget === null || rest.budget.restsPerPeriod === 0) return null;

  const status = restStatus(rest.budget, rest.uses, today);
  const yesterday = addDays(today, -1);
  // Yesterday first: that's the day that would end the streak.
  const usable = [yesterday, today].find((day) => canUseRestDay(day, today, rest.budget, rest.uses, trainingDays));
  const undoable = [yesterday, today].filter((day) => rest.uses.includes(day));
  const dayName = (day: DayKey) => (day === today ? "heute" : "gestern");

  function run(action: () => Promise<void>) {
    setBusy(true);
    action()
      .then(onChanged)
      .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error)))
      .finally(() => setBusy(false));
  }

  function confirmUse(day: DayKey) {
    Alert.alert(
      `Ruhetag für ${dayName(day)} einsetzen?`,
      `Dein Streak läuft weiter, ohne dass der Tag mitzählt. Danach übrig: ${status.remaining - 1} von ${status.total}.`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Einsetzen", onPress: () => run(() => applyRestDay(day)) },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="moon-outline" size={20} color={colors.textSecondary} />
        <View style={styles.text}>
          <Text style={styles.title}>
            Ruhetage übrig: {status.remaining} von {status.total}
          </Text>
          <Text style={styles.subtitle}>Zeitraum bis {shortDate(addDays(status.periodEnd, -1))}</Text>
        </View>
      </View>
      {usable !== undefined && (
        <Button
          label={`Ruhetag für ${dayName(usable)} einsetzen`}
          variant="secondary"
          size="sm"
          onPress={() => confirmUse(usable)}
          loading={busy}
        />
      )}
      {undoable.map((day) => (
        <Button
          key={day}
          label={`Ruhetag ${dayName(day)} zurücknehmen`}
          variant="ghost"
          size="sm"
          onPress={() => run(() => undoRestDay(day))}
          disabled={busy}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      gap: spacing.ms,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typography.body,
      ...typography.numeric,
      fontWeight: "600",
      color: colors.text,
    },
    subtitle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
