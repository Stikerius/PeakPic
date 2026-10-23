import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PendingLegalList } from "@/components/legal/pending-legal-list";
import { Button } from "@/components/ui/button";
import { spacing, typography } from "@/constants/theme";
import { signOut } from "@/lib/auth";
import { useLegalGate } from "@/lib/legalGate";
import { useOnboarding } from "@/lib/onboarding";
import { makeStyles } from "@/lib/theme";

/**
 * "Rechtstexte aktualisiert": shown after login while a current text isn't confirmed yet. Each
 * text is confirmed separately. "Später" only for updates that aren't blocking; otherwise only
 * confirming or signing out.
 */
export default function LegalUpdateScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { pending, postpone, markConfirmed } = useLegalGate();
  const { needed: onboardingNeeded } = useOnboarding();
  const [signingOut, setSigningOut] = useState(false);
  // Postponed on this screen: hidden here. Texts postponed earlier still show when the screen
  // is opened from the notice.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const remaining = pending.filter((doc) => !skipped.has(doc.documentId));
  const mustConfirm = remaining.some((doc) => !doc.canPostpone);
  const done = remaining.length === 0;

  // Leave only after the gate state has changed, so the router guards already let the next
  // screen through. Opened from a notice: back. As the gate after login: on to the intro for a
  // new account (the app stays guarded until it is done; replacing with "/" would go nowhere and
  // leave this empty screen), otherwise into the app.
  useEffect(() => {
    if (!done) return;
    if (router.canGoBack()) router.back();
    else router.replace(onboardingNeeded === true ? "/onboarding" : "/");
  }, [done, onboardingNeeded]);

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
        pending={remaining}
        allowPostpone
        onConfirmed={(id) => markConfirmed([id])}
        onPostpone={(id) => {
          postpone([id]);
          setSkipped((current) => new Set([...current, id]));
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
