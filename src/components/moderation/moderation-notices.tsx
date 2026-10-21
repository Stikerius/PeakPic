import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { SUPPORT_EMAIL } from "@/constants/app";
import { radius, spacing, typography } from "@/constants/theme";
import { formatRelativeTime } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { makeStyles, useTheme } from "@/lib/theme";

type Notice = { id: string; kind: string; message: string; createdAt: string; unread: boolean };

const KIND_TITLES: Record<string, string> = {
  warning: "Verwarnung",
  removal: "Inhalt entfernt",
  suspension: "Konto gesperrt",
  ban: "Konto gesperrt",
  info: "Hinweis",
};

async function fetchNotices(): Promise<Notice[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("moderation_notices")
    .select("id, kind, message, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
    unread: row.read_at === null,
  }));
}

/** Messages from the moderation team (warnings, removed content), above the notifications. */
export function ModerationNotices() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let active = true;
    fetchNotices()
      .then((result) => {
        if (!active) return;
        setNotices(result);
        if (result.some((n) => n.unread)) void supabase.rpc("mark_moderation_notices_read", {});
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (notices.length === 0) return null;
  return (
    <View style={styles.container}>
      {notices.map((notice) => (
        <View key={notice.id} style={[styles.card, notice.unread && styles.unread]} accessible>
          <View style={styles.header}>
            <Ionicons name="shield-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.title}>{KIND_TITLES[notice.kind] ?? "Hinweis"} vom Moderationsteam</Text>
            <Text style={styles.time}>{formatRelativeTime(notice.createdAt)}</Text>
          </View>
          <Text style={styles.message}>{notice.message}</Text>
        </View>
      ))}
      <Text style={styles.footer}>Fragen oder Einspruch: {SUPPORT_EMAIL}</Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    container: {
      gap: spacing.sm,
      padding: spacing.md,
    },
    card: {
      gap: spacing.xs,
      padding: spacing.ms,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    unread: {
      borderColor: colors.accent,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    title: {
      ...typography.caption,
      fontWeight: "600",
      flex: 1,
      color: colors.text,
    },
    time: {
      ...typography.label,
      color: colors.textTertiary,
    },
    message: {
      ...typography.body,
      color: colors.text,
    },
    footer: {
      ...typography.caption,
      color: colors.textSecondary,
    },
  }),
);
