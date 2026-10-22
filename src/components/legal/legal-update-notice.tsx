import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing, typography } from "@/constants/theme";
import { formatRelativeTime } from "@/lib/format";
import { useLegalGate } from "@/lib/legalGate";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * The in-app notice "Rechtstexte aktualisiert" (notification type legal_update, no sender),
 * shown while there is still something to confirm. Opens the confirmation screen.
 */
export function LegalUpdateNotice() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { pending } = useLegalGate();
  const [latestAt, setLatestAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    requireUserId()
      .then((userId) =>
        supabase
          .from("notifications")
          .select("created_at")
          .eq("user_id", userId)
          .eq("type", "legal_update")
          .is("read_at", null)
          .order("created_at", { ascending: false })
          .limit(1),
      )
      .then(({ data }) => {
        if (active) setLatestAt(data?.[0]?.created_at ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (pending.length === 0 || latestAt === null) return null;
  return (
    <Pressable
      onPress={() => router.push("/legal-update")}
      accessibilityRole="button"
      accessibilityLabel="Rechtstexte aktualisiert, ansehen und bestätigen"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Ionicons name="document-text-outline" size={22} color={colors.textSecondary} />
      <View style={styles.text}>
        <Text style={styles.title}>Rechtstexte aktualisiert</Text>
        <Text style={styles.subtitle}>
          {pending.length === 1 ? "1 Text" : `${pending.length} Texte`} zu bestätigen · {formatRelativeTime(latestAt)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.ms,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      padding: spacing.ms,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      backgroundColor: colors.surface,
    },
    pressed: {
      backgroundColor: colors.surfaceRaised,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typography.body,
      fontWeight: "600",
      color: colors.text,
    },
    subtitle: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
