import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, type ColorValue } from "react-native";

import { colors, spacing } from "@/constants/theme";

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

function SearchButton() {
  return (
    <Link href="/search" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Leute finden"
        hitSlop={spacing.sm}
        style={styles.headerButton}
      >
        <Ionicons name="person-add-outline" size={22} color={colors.text} />
      </Pressable>
    </Link>
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
          headerRight: SearchButton,
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
  headerButton: {
    paddingHorizontal: spacing.md,
  },
});
