import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View, type ColorValue } from "react-native";

import { NewChatButton } from "@/components/chat/new-chat-button";
import { NotificationBell } from "@/components/notification-bell";
import { colors, spacing } from "@/constants/theme";
import { useFollowRequestCount } from "@/hooks/use-follow-requests";
import { useUnreadChatCount } from "@/hooks/use-unread-chats";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type TabIconProps = {
  focused: boolean;
  color: ColorValue;
  size: number;
};

function tabIcon(active: IoniconName, inactive: IoniconName) {
  return function TabIcon({ focused, color, size }: TabIconProps) {
    return (
      <Ionicons name={focused ? active : inactive} color={color} size={size} />
    );
  };
}

function SettingsButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Einstellungen"
        hitSlop={spacing.sm}
        style={styles.headerActions}
      >
        <Ionicons name="settings-outline" size={22} color={colors.text} />
      </Pressable>
    </Link>
  );
}

function FeedHeaderActions() {
  return (
    <View style={styles.headerActions}>
      <Link href="/search" asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Leute finden" hitSlop={spacing.sm}>
          <Ionicons name="person-add-outline" size={22} color={colors.text} />
        </Pressable>
      </Link>
      <NotificationBell />
    </View>
  );
}

function HomeHeaderActions() {
  return (
    <View style={styles.headerActions}>
      <NotificationBell />
    </View>
  );
}

export default function TabLayout() {
  const unreadChats = useUnreadChatCount();
  const followRequests = useFollowRequestCount();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: tabIcon("home", "home-outline"),
          headerRight: HomeHeaderActions,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: tabIcon("people", "people-outline"),
          headerRight: FeedHeaderActions,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Kamera",
          headerShown: false,
          tabBarIcon: tabIcon("camera", "camera-outline"),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: tabIcon("chatbubbles", "chatbubbles-outline"),
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.text },
          headerRight: NewChatButton,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profil",
          tabBarIcon: tabIcon("person", "person-outline"),
          tabBarBadge: followRequests > 0 ? followRequests : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.text },
          headerRight: SettingsButton,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
  },
});
