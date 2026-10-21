import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { SectionFooter } from "@/components/ui/section-header";
import { spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { fetchMyRestDays, setRestBudget, type MyRestDays } from "@/lib/restRepo";
import { MAX_RESTS_PER_PERIOD, REST_PERIOD_DAYS, parseDayKey, restStatus, toDayKey } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";

function shortDate(day: string): string {
  const { day: d, month, year } = parseDayKey(day);
  return `${d}.${month}.${year}`;
}

/** "X Ruhetage pro 3 Wochen" in Profil bearbeiten. Optional; locked for 21 days after a change. */
export function RestBudgetEditor() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [rest, setRest] = useState<MyRestDays | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    let active = true;
    fetchMyRestDays()
      .then((result) => {
        if (active) setRest(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(load);

  if (rest === null) return null;
  const today = toDayKey(new Date());
  const current = rest.budget?.restsPerPeriod ?? 0;
  const value = draft ?? current;
  const status = rest.budget !== null ? restStatus(rest.budget, rest.uses, today) : null;
  const locked = status !== null && today < status.changeableFrom;

  function save() {
    Alert.alert(
      `${value} ${value === 1 ? "Ruhetag" : "Ruhetage"} pro 3 Wochen festlegen?`,
      `Die Einstellung gilt ab heute für ${REST_PERIOD_DAYS} Tage und lässt sich erst danach wieder ändern. Nicht genutzte Ruhetage verfallen am Ende jedes Zeitraums.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Festlegen",
          onPress: () => {
            setSaving(true);
            setRestBudget(value)
              .then(() => {
                setDraft(null);
                load();
              })
              .catch((error: unknown) => Alert.alert("Speichern fehlgeschlagen", describeError(error)))
              .finally(() => setSaving(false));
          },
        },
      ],
    );
  }

  function step(by: -1 | 1) {
    setDraft(Math.min(MAX_RESTS_PER_PERIOD, Math.max(0, value + by)));
  }

  return (
    <View>
      <View style={styles.row}>
        <Ionicons name="moon-outline" size={22} color={colors.textSecondary} />
        <Text style={styles.title}>Ruhetage pro 3 Wochen</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => step(-1)}
            disabled={locked || value === 0}
            accessibilityRole="button"
            accessibilityLabel="Weniger Ruhetage"
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, (locked || value === 0) && styles.disabled]}
          >
            <Ionicons name="remove" size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.value} accessibilityLabel={`${value} Ruhetage`}>
            {value}
          </Text>
          <Pressable
            onPress={() => step(1)}
            disabled={locked || value === MAX_RESTS_PER_PERIOD}
            accessibilityRole="button"
            accessibilityLabel="Mehr Ruhetage"
            style={({ pressed }) => [
              styles.stepButton,
              pressed && styles.pressed,
              (locked || value === MAX_RESTS_PER_PERIOD) && styles.disabled,
            ]}
          >
            <Ionicons name="add" size={20} color={colors.text} />
          </Pressable>
        </View>
      </View>
      {!locked && value !== current && (
        <View style={styles.save}>
          <Button label="Festlegen" variant="secondary" size="sm" onPress={save} loading={saving} />
        </View>
      )}
      <SectionFooter>
        {locked && status !== null
          ? `Diesen Zeitraum noch ${status.remaining} von ${status.total} übrig. Änderbar ab ${shortDate(status.changeableFrom)}.`
          : `Freiwillig. Ein Ruhetag hält deinen Streak an einem Tag ohne Training am Leben, zählt aber nicht mit. Einsetzbar für heute oder gestern, höchstens ${MAX_RESTS_PER_PERIOD} pro ${REST_PERIOD_DAYS} Tage.`}
      </SectionFooter>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    title: {
      ...typography.body,
      flex: 1,
      color: colors.text,
    },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
    },
    stepButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.6,
    },
    disabled: {
      opacity: 0.3,
    },
    value: {
      ...typography.bodyStrong,
      ...typography.numeric,
      minWidth: 20,
      textAlign: "center",
      color: colors.text,
    },
    save: {
      alignItems: "flex-end",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  }),
);
