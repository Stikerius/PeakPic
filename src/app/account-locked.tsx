import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/constants/app";
import { radius, spacing, typography } from "@/constants/theme";
import { useAccountStatus } from "@/lib/accountStatus";
import { signOut } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * Shown instead of the app while the account is not active. Everything else is locked by the
 * router; the database refuses all writes of such accounts anyway.
 */
export default function AccountLockedScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { account, refresh } = useAccountStatus();
  const [signingOut, setSigningOut] = useState(false);

  const status = account?.status ?? "suspended";
  const temporary = status === "suspended" && account?.suspendedUntil !== null && account?.suspendedUntil !== undefined;
  const title =
    status === "banned" ? "Konto dauerhaft gesperrt" : status === "deleting" ? "Konto wird gelöscht" : "Konto gesperrt";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View style={styles.icon}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.textSecondary} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {temporary && account?.suspendedUntil !== null && account?.suspendedUntil !== undefined && (
        <Text style={styles.until}>
          Bis {formatDate(account.suspendedUntil)}, {formatTime(account.suspendedUntil)} Uhr
        </Text>
      )}
      {account?.message !== null && account?.message !== undefined && account.message.length > 0 ? (
        <View style={styles.messageBox}>
          <Text style={styles.messageLabel}>Nachricht vom Moderationsteam</Text>
          <Text style={styles.message}>{account.message}</Text>
        </View>
      ) : (
        <Text style={styles.text}>
          {status === "deleting"
            ? "Dein Konto wird gerade gelöscht."
            : "Dein Konto wurde wegen eines Verstosses gegen unsere Regeln gesperrt."}
        </Text>
      )}
      <Text style={styles.text}>
        Während der Sperre kannst du nichts posten, kommentieren oder schreiben. Dein Profil ist für andere nicht
        sichtbar.
      </Text>
      <Text style={styles.text}>
        Fragen oder Einspruch: <Text style={styles.email}>{SUPPORT_EMAIL}</Text>
      </Text>

      <View style={styles.actions}>
        {temporary && <Button label="Status neu laden" variant="secondary" onPress={refresh} />}
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
    until: {
      ...typography.body,
      ...typography.numeric,
      color: colors.textSecondary,
      textAlign: "center",
    },
    messageBox: {
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    messageLabel: {
      ...typography.label,
      color: colors.textSecondary,
    },
    message: {
      ...typography.body,
      color: colors.text,
    },
    text: {
      ...typography.body,
      color: colors.textSecondary,
    },
    email: {
      color: colors.text,
      fontWeight: "600",
    },
    actions: {
      gap: spacing.sm,
      marginTop: spacing.md,
    },
  }),
);
