import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { radius, spacing, typography } from "@/constants/theme";
import { clearLocalData, deleteMyAccount, reauthenticate } from "@/lib/accountDeletion";
import { signOut } from "@/lib/auth";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * "Löschung wird abgeschlossen": a deletion was started but not finished (account_status
 * 'deleting'). The account is already invisible; retrying continues where it stopped.
 */
export function DeletionPending() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      if (needsPassword) {
        const authError = await reauthenticate(password);
        if (authError !== null) {
          setError(authError);
          return;
        }
      }
      const result = await deleteMyAccount();
      if (result.status === "deleted") {
        await clearLocalData();
        return;
      }
      if (result.status === "reauth") {
        setNeedsPassword(true);
        setError("Zur Sicherheit: bitte gib dein Passwort erneut ein.");
        return;
      }
      setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.icon}>
          <Ionicons name="trash-outline" size={40} color={colors.textSecondary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Löschung wird abgeschlossen
        </Text>
        <Text style={styles.text}>
          Die Löschung deines Kontos wurde gestartet, aber nicht beendet. Dein Konto ist für andere bereits unsichtbar.
          Versuche es erneut; bereits Gelöschtes bleibt gelöscht.
        </Text>
        {needsPassword && (
          <TextField
            label="Passwort"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!busy}
          />
        )}
        {error !== null && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          <Button
            label="Erneut versuchen"
            variant="secondary"
            destructive
            loading={busy}
            disabled={needsPassword && password.length === 0}
            onPress={() => void retry()}
          />
          <Button
            label="Abmelden"
            variant="secondary"
            loading={signingOut}
            disabled={busy}
            onPress={() => {
              setSigningOut(true);
              void signOut().finally(() => setSigningOut(false));
            }}
          />
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
    content: {
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    icon: {
      alignSelf: "center",
      width: 88,
      height: 88,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: {
      ...typography.title,
      color: colors.text,
      textAlign: "center",
    },
    text: {
      ...typography.body,
      color: colors.textSecondary,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
    actions: {
      gap: spacing.sm,
      marginTop: spacing.md,
    },
  }),
);
