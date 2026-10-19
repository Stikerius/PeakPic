import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
import { onAppEvent } from "@/lib/events";
import { countUnreadNotifications } from "@/lib/notificationRepo";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Header bell with the number of unread notification groups. Refreshes on mount,
 * every minute and after follows; doesn't rely on screen focus (headers may render
 * outside the screen's navigation context).
 */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    const reload = () => {
      countUnreadNotifications()
        .then((count) => {
          if (active) setUnread(count);
        })
        .catch(() => undefined);
    };
    reload();
    const timer = setInterval(reload, REFRESH_INTERVAL_MS);
    const unsubscribers = [
      onAppEvent("notificationsSeen", () => setUnread(0)),
      onAppEvent("followChanged", reload),
    ];
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

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

const styles = StyleSheet.create({
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
});
