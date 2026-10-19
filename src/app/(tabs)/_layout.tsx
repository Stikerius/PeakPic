import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View, type ColorValue } from "react-native";

import { colors, radius, spacing } from "@/constants/theme";
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

function FeedHeaderActions() {
  const unreadChats = useUnreadChatCount();
  return (
    <View style={styles.headerActions}>
      <Link href="/search" asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Leute finden" hitSlop={spacing.sm}>
          <Ionicons name="person-add-outline" size={22} color={colors.text} />
        </Pressable>
      </Link>
      <Link href="/chats" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unreadChats > 0 ? `Chats, ${unreadChats} ungelesen` : "Chats"}
          hitSlop={spacing.sm}
        >
          <Ionicons name="paper-plane-outline" size={23} color={colors.text} />
          {unreadChats > 0 && <View style={styles.unreadDot} />}
        </Pressable>
      </Link>
    </View>
  );
}

export default function TabLayout() {
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
        options={{ title: "Home", tabBarIcon: tabIcon("home", "home-outline") }}
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
        name="profile"
        options={{ title: "Profil", tabBarIcon: tabIcon("person", "person-outline") }}
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
  unreadDot: {
    position: "absolute",
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
