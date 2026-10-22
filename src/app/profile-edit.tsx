import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { RestBudgetEditor } from "@/components/profile/rest-budget-editor";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { SectionHeader } from "@/components/ui/section-header";
import { TextField } from "@/components/ui/text-field";
import { spacing, typography } from "@/constants/theme";
import { normalizeUsername } from "@/lib/auth";
import { describeError } from "@/lib/errors";
import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameError,
  nextUsernameChange,
  usernameFormatError,
  usernameLockedMessage,
} from "@/lib/names";
import { fetchMyPlan, type TrainingPlan } from "@/lib/planRepo";
import { NameChangeError, getMyProfile, isUsernameAvailable, updateMyNames, type Profile } from "@/lib/profileRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { useTrackScreen } from "@/lib/usage";

type Availability = "unknown" | "checking" | "available" | "taken";

const AVAILABILITY_DELAY_MS = 400;

export default function ProfileEditScreen() {
  useTrackScreen("screen_profile_edit");
  const { colors } = useTheme();
  const styles = useStyles();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  // Result of the last availability check, for the name it was made for.
  const [checked, setChecked] = useState<{ name: string; free: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; displayName?: string; general?: string }>({});

  function load() {
    getMyProfile()
      .then((result) => {
        setProfile(result);
        setDisplayName(result.displayName);
        setUsername(result.username);
      })
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  // undefined while loading; refreshed when coming back from the plan editor.
  const [plan, setPlan] = useState<TrainingPlan | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchMyPlan()
        .then((result) => {
          if (active) setPlan(result);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

  const normalized = normalizeUsername(username);
  const usernameChanged = profile !== null && normalized !== profile.username;
  const checkable = usernameChanged && usernameFormatError(normalized) === null;
  const now = new Date();
  const lockedUntil = profile !== null ? nextUsernameChange(profile.usernameChangedAt, now) : null;
  const availability: Availability = !checkable
    ? "unknown"
    : checked?.name !== normalized
      ? "checking"
      : checked.free
        ? "available"
        : "taken";

  // Live hint whether the new username is free; the database decides on save anyway.
  useEffect(() => {
    if (!checkable) return;
    let active = true;
    const timer = setTimeout(() => {
      isUsernameAvailable(normalized)
        .then((free) => {
          if (active) setChecked({ name: normalized, free });
        })
        .catch(() => undefined);
    }, AVAILABILITY_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [normalized, checkable]);

  if (profile === null) {
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

  const trimmedDisplayName = displayName.trim();
  const displayNameChanged = trimmedDisplayName !== profile.displayName;
  const usernameHint = lockedUntil !== null
    ? usernameLockedMessage(lockedUntil, now)
    : availability === "available"
      ? "Verfügbar."
      : availability === "checking"
        ? "Wird geprüft …"
        : "3–20 Zeichen: a–z, 0–9, _ und Punkt. Änderbar alle 14 Tage.";

  async function save() {
    if (profile === null) return;
    const nextErrors: typeof errors = {};
    const nameError = displayNameError(trimmedDisplayName);
    if (nameError !== null) nextErrors.displayName = nameError;
    if (usernameChanged) {
      const formatError = usernameFormatError(normalized);
      if (formatError !== null) nextErrors.username = formatError;
      else if (availability === "taken") nextErrors.username = "Username vergeben.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!usernameChanged && !displayNameChanged) {
      router.back();
      return;
    }

    setSaving(true);
    try {
      await updateMyNames({
        ...(usernameChanged ? { username: normalized } : {}),
        ...(displayNameChanged ? { displayName: trimmedDisplayName } : {}),
      });
      router.back();
    } catch (error) {
      if (error instanceof NameChangeError) setErrors({ [error.field]: error.message });
      else setErrors({ general: `Speichern fehlgeschlagen. ${describeError(error)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionHeader title="Name" />
        <View style={styles.fields}>
          <TextField
            label="Anzeigename"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            error={errors.displayName}
            hint="Wird gross im Profil gezeigt. Muss nicht eindeutig sein."
          />
          <TextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            editable={lockedUntil === null}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            maxLength={20}
            error={errors.username ?? (availability === "taken" ? "Username vergeben." : null)}
            hint={usernameHint}
          />
          <Text style={styles.note}>
            Follower, Chats und Markierungen bleiben bei einer Umbenennung erhalten. Dein bisheriger Username
            bleibt für dich reserviert, ältere Erwähnungen führen weiter zu dir.
          </Text>
        </View>

        {errors.general !== undefined && <Text style={styles.error}>{errors.general}</Text>}
        <View style={styles.actions}>
          <Button label="Speichern" onPress={() => void save()} loading={saving} />
        </View>

        <SectionHeader title="Trainingsplan" />
        <View style={styles.group}>
          <ListItem
            icon="list-outline"
            title={plan ? plan.name : "Plan anlegen"}
            subtitle={
              plan === undefined
                ? "…"
                : plan === null
                  ? "Freiwillig. Eine feste Abfolge von Einheiten, z.B. Push, Pull, Beine."
                  : `${plan.days.length === 1 ? "1 Einheit" : `${plan.days.length} Einheiten`}${plan.showInProfile ? "" : " · nicht im Profil sichtbar"}`
            }
            chevron
            onPress={() => router.push("/plan-edit")}
          />
        </View>

        <SectionHeader title="Ruhetage" />
        <RestBudgetEditor />
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
    fields: {
      gap: spacing.md,
      paddingHorizontal: spacing.md,
    },
    note: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    actions: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
    },
    group: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
  }),
);
