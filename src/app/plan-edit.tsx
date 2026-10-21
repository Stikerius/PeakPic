import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { SectionFooter, SectionHeader } from "@/components/ui/section-header";
import { TextField } from "@/components/ui/text-field";
import { spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import {
  PLAN_DAY_NOTES_MAX_LENGTH,
  PLAN_DAY_TITLE_MAX_LENGTH,
  PLAN_MAX_DAYS,
  PLAN_NAME_MAX_LENGTH,
  deleteMyPlan,
  fetchMyPlan,
  planDraftError,
  saveMyPlan,
  type PlanDayDraft,
  type TrainingPlan,
} from "@/lib/planRepo";
import { makeStyles, useTheme } from "@/lib/theme";

/** A draft unit plus a key that stays stable while reordering. */
type DraftRow = PlanDayDraft & { key: string };

type IconName = ComponentProps<typeof Ionicons>["name"];

function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.textSecondary} />
    </Pressable>
  );
}

export default function PlanEditScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [plan, setPlan] = useState<TrainingPlan | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [showInProfile, setShowInProfile] = useState(true);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(0);

  function newRow(draft: PlanDayDraft): DraftRow {
    nextKey.current += 1;
    return { ...draft, key: `row-${nextKey.current}` };
  }

  function load() {
    fetchMyPlan()
      .then((result) => {
        setPlan(result);
        setName(result?.name ?? "");
        setShowInProfile(result?.showInProfile ?? true);
        setRows(
          result !== null
            ? result.days.map((d) => newRow({ id: d.id, title: d.title, notes: d.notes ?? "" }))
            : [newRow({ id: null, title: "", notes: "" })],
        );
      })
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  function updateRow(key: string, change: Partial<PlanDayDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function moveRow(index: number, by: -1 | 1) {
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  async function save() {
    const draftError = planDraftError(name, rows);
    if (draftError !== null) {
      setError(draftError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveMyPlan(name, showInProfile, rows);
      router.back();
    } catch (saveError) {
      setError(`Speichern fehlgeschlagen. ${describeError(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert("Plan entfernen?", "Der Plan und seine Einheiten werden gelöscht. Deine Beiträge bleiben erhalten.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Entfernen",
        style: "destructive",
        onPress: () => {
          setSaving(true);
          deleteMyPlan()
            .then(() => router.back())
            .catch((deleteError: unknown) => setError(`Entfernen fehlgeschlagen. ${describeError(deleteError)}`))
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

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <View style={styles.group}>
          <ListItem
            title="Plan im Profil anzeigen"
            trailing={
              <Switch
                value={showInProfile}
                onValueChange={setShowInProfile}
                trackColor={{ true: colors.accent, false: colors.border }}
                accessibilityLabel="Plan im Profil anzeigen"
              />
            }
          />
        </View>
        <SectionFooter>
          Sichtbar für alle, die deine Beiträge sehen dürfen (bestätigte Follower bzw. alle bei öffentlichem Profil).
        </SectionFooter>

        <SectionHeader title={`Einheiten (${rows.length})`} />
        <Text style={styles.intro}>
          Die Einheiten wiederholen sich in dieser Reihenfolge, unabhängig von Wochentagen.
        </Text>
        <View style={styles.group}>
          {rows.map((row, index) => (
            <View key={row.key}>
              {index > 0 && <Divider />}
              <View style={styles.unit}>
                <View style={styles.unitHeader}>
                  <Text style={styles.unitLabel}>Einheit {index + 1}</Text>
                  <View style={styles.unitActions}>
                    <IconButton
                      icon="chevron-up"
                      label={`Einheit ${index + 1} nach oben`}
                      onPress={() => moveRow(index, -1)}
                      disabled={index === 0}
                    />
                    <IconButton
                      icon="chevron-down"
                      label={`Einheit ${index + 1} nach unten`}
                      onPress={() => moveRow(index, 1)}
                      disabled={index === rows.length - 1}
                    />
                    <IconButton
                      icon="trash-outline"
                      label={`Einheit ${index + 1} löschen`}
                      onPress={() => removeRow(row.key)}
                      disabled={rows.length === 1}
                      destructive
                    />
                  </View>
                </View>
                <TextField
                  label="Name"
                  value={row.title}
                  onChangeText={(title) => updateRow(row.key, { title })}
                  placeholder="z.B. Push"
                  maxLength={PLAN_DAY_TITLE_MAX_LENGTH}
                />
                <TextField
                  label="Notizen (optional)"
                  value={row.notes}
                  onChangeText={(notes) => updateRow(row.key, { notes })}
                  placeholder="z.B. Bankdrücken 4×8, Schulterdrücken 3×10"
                  maxLength={PLAN_DAY_NOTES_MAX_LENGTH}
                  multiline
                />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.padded}>
          <Button
            label="Einheit hinzufügen"
            icon="add"
            variant="secondary"
            onPress={() => setRows((current) => [...current, newRow({ id: null, title: "", notes: "" })])}
            disabled={rows.length >= PLAN_MAX_DAYS}
            style={styles.addButton}
          />
        </View>

        {error !== null && <Text style={styles.error}>{error}</Text>}
        <View style={[styles.padded, styles.actions]}>
          <Button label="Speichern" onPress={() => void save()} loading={saving} />
          {plan !== null && (
            <Button label="Plan entfernen" variant="ghost" destructive onPress={confirmDelete} disabled={saving} />
          )}
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
    },
    padded: {
      paddingHorizontal: spacing.md,
    },
    group: {
      marginTop: spacing.ms,
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
    unit: {
      gap: spacing.ms,
      padding: spacing.md,
    },
    unitHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    unitLabel: {
      ...typography.bodyStrong,
      color: colors.text,
    },
    unitActions: {
      flexDirection: "row",
      marginRight: -spacing.sm,
    },
    iconButton: {
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
    addButton: {
      marginTop: spacing.md,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    actions: {
      gap: spacing.sm,
      paddingTop: spacing.lg,
    },
  }),
);
