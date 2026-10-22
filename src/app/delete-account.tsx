import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { SUPPORT_EMAIL } from "@/constants/app";
import { spacing, typography } from "@/constants/theme";
import { clearLocalData, deleteMyAccount, DELETION_NOT_ALLOWED, reauthenticate } from "@/lib/accountDeletion";
import { useAccountStatus } from "@/lib/accountStatus";
import { getMyProfile } from "@/lib/profileRepo";
import { makeStyles } from "@/lib/theme";
import { useTrackScreen } from "@/lib/usage";

const DELETED = [
  "Profil, Username (wird wieder frei) und Anzeigename",
  "Beiträge, Storys und Highlights",
  "Kommentare und Likes",
  "Follower, Gefolgte und Follow-Anfragen",
  "Markierungen, Erwähnungen und Workout-Verlinkungen",
  "Deine Chat-Nachrichten",
  "Alle hochgeladenen Fotos und Dateien",
  "Trainingsplan, Streak und Ruhetage",
  "Einstellungen, Blockierungen und Mitteilungen",
  "Bestätigungen der Rechtstexte",
];

const KEPT = [
  "Chats bleiben für die anderen Mitglieder; du erscheinst dort als „Gelöschtes Konto“.",
  "Meldungen und Entscheidungen der Moderation bleiben ohne deinen Namen (nur pseudonymisiert).",
  "Kopien gemeldeter Nachrichten bleiben als Nachweis, ohne Namen.",
  "Ein Löschprotokoll ohne persönliche Daten.",
];

function Bullets({ items }: { items: string[] }) {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <Text key={item} style={styles.item}>
          {"• "}
          {item}
        </Text>
      ))}
    </View>
  );
}

/** "Konto löschen": final and immediate. Password again plus the own username as confirmation. */
export default function DeleteAccountScreen() {
  useTrackScreen("screen_delete_account");
  const styles = useStyles();
  const { refresh } = useAccountStatus();
  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [typedUsername, setTypedUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMyProfile()
      .then((profile) => {
        if (active) setUsername(profile.username);
      })
      .catch(() => {
        if (active) setError("Profil konnte nicht geladen werden. Prüfe deine Verbindung.");
      });
    return () => {
      active = false;
    };
  }, []);

  const usernameMatches = username !== null && typedUsername.trim().toLowerCase() === username;
  const canDelete = password.length > 0 && usernameMatches && !busy;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      // Re-authenticate directly before deleting: the server requires a fresh sign-in.
      const authError = await reauthenticate(password);
      if (authError !== null) {
        setError(authError);
        return;
      }
      const result = await deleteMyAccount();
      if (result.status === "deleted") {
        // Leads to the login (the session ends).
        await clearLocalData();
        return;
      }
      if (result.status === "reauth") {
        setError("Bitte gib dein Passwort erneut ein.");
        return;
      }
      setError(result.message);
      // Started but not finished: the account is now "deleting"; the app shows the screen to
      // finish the deletion.
      // (If it never started, the status is still active and nothing changes.)
      if (result.message !== DELETION_NOT_ALLOWED) refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.warning}>Das kann nicht rückgängig gemacht werden.</Text>
        <Text style={styles.text}>Dein Konto wird sofort und endgültig gelöscht. Es gibt keine Wartefrist.</Text>

        <Text style={styles.heading} accessibilityRole="header">
          Was gelöscht wird
        </Text>
        <Bullets items={DELETED} />

        <Text style={styles.heading} accessibilityRole="header">
          Was bleibt
        </Text>
        <Bullets items={KEPT} />
        <Text style={styles.caption}>
          Gesperrte Konten und Konten mit Inhalten in Prüfung können nicht selbst gelöscht werden. Wende dich dann an{" "}
          {SUPPORT_EMAIL}.
        </Text>

        <View style={styles.form}>
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
          <TextField
            label="Dein Username zur Bestätigung"
            hint={username !== null ? `Tippe „${username}“ ein.` : undefined}
            value={typedUsername}
            onChangeText={setTypedUsername}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          {error !== null && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          <Button
            label="Konto endgültig löschen"
            variant="secondary"
            destructive
            onPress={() => void remove()}
            disabled={!canDelete}
            loading={busy}
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
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    warning: {
      ...typography.heading,
      color: colors.danger,
    },
    text: {
      ...typography.body,
      color: colors.text,
    },
    heading: {
      ...typography.body,
      fontWeight: "600",
      color: colors.text,
      marginTop: spacing.sm,
    },
    list: {
      gap: spacing.xs,
    },
    item: {
      ...typography.body,
      color: colors.textSecondary,
    },
    caption: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    form: {
      gap: spacing.md,
      marginTop: spacing.md,
    },
    error: {
      ...typography.caption,
      color: colors.danger,
    },
  }),
);
