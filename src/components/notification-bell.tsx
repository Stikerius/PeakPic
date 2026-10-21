import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { radius, spacing } from "@/constants/theme";
import { onAppEvent } from "@/lib/events";
import { countUnreadInbox, subscribeToInbox } from "@/lib/inboxRepo";
import { countUnreadNotifications } from "@/lib/notificationRepo";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Header bell with the number of unread notifications: activity groups plus stored
 * notifications (tags, workout links, follow requests, live via Realtime). Also refreshes
 * every minute and after follows; doesn't rely on screen focus (headers may render outside
 * the screen's navigation context).
 */
export function NotificationBell() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [unread, setUnread] = useState(0);
  const myId = useSession().session?.user.id;

  useEffect(() => {
    let active = true;
    const reload = () => {
      Promise.all([countUnreadNotifications(), countUnreadInbox()])
        .then(([groups, inbox]) => {
          if (active) setUnread(groups + inbox);
        })
        .catch(() => undefined);
    };
    reload();
    const timer = setInterval(reload, REFRESH_INTERVAL_MS);
    const unsubscribers = [
      onAppEvent("notificationsSeen", () => setUnread(0)),
      onAppEvent("followChanged", reload),
      ...(myId !== undefined ? [subscribeToInbox(myId, reload)] : []),
    ];
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [myId]);

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Mitteilungen, ${unread} neu` : "Mitteilungen"}
      hitSlop={spacing.sm}
    >
      <Ionicons name="notifications-outline" size={24} color={colors.text} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    badge: {
      position: "absolute",
      top: -5,
      right: -7,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.danger,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    badgeText: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "800",
    },
  }),
);
