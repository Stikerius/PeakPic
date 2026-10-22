import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PendingLegalList } from "@/components/legal/pending-legal-list";
import { Button } from "@/components/ui/button";
import { spacing, typography } from "@/constants/theme";
import { signOut } from "@/lib/auth";
import { useLegalGate } from "@/lib/legalGate";
import { makeStyles } from "@/lib/theme";

/**
 * "Rechtstexte aktualisiert": shown after login while a current text isn't confirmed yet. Each
 * text is confirmed separately. "Später" only for updates that aren't blocking; otherwise only
 * confirming or signing out.
 */
export default function LegalUpdateScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { pending, postpone, refresh } = useLegalGate();
  const [signingOut, setSigningOut] = useState(false);
  const mustConfirm = pending.some((doc) => !doc.canPostpone);

  // Opened from a notification: back. As the gate after login: on into the app (the router
  // then shows the intro or the app, whichever comes next).
  function leaveIfDone(nextPending: number) {
    if (nextPending > 0) return;
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        Rechtstexte aktualisiert
      </Text>
      <Text style={styles.text}>
        Bitte lies die geänderten Texte. Die Nutzungsbedingungen akzeptierst du, die Datenschutzerklärung und die
        Richtlinien nimmst du zur Kenntnis.
      </Text>
      <PendingLegalList
        pending={pending}
        allowPostpone
        onConfirmed={() => {
          refresh();
          leaveIfDone(pending.length - 1);
        }}
        onPostpone={(id) => {
          postpone([id]);
          leaveIfDone(pending.length - 1);
        }}
      />
      {mustConfirm && (
        <View style={styles.signOut}>
          <Text style={styles.hint}>Ohne Bestätigung kannst du die App nicht weiter nutzen.</Text>
          <Button
            label="Abmelden"
            variant="secondary"
            loading={signingOut}
            onPress={() => {
              setSigningOut(true);
              void signOut().finally(() => setSigningOut(false));
            }}
          />
        </View>
      )}
    </ScrollView>
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
      paddingHorizontal: spacing.md,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    text: {
      ...typography.body,
      color: colors.textSecondary,
    },
    signOut: {
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    hint: {
      ...typography.caption,
      color: colors.textSecondary,
      textAlign: "center",
    },
  }),
);
