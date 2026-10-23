import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { makeStyles, useTheme } from "@/lib/theme";

export type ProfileTab = "posts" | "activities" | "stats" | "reposts" | "tagged";

type IconName = ComponentProps<typeof Ionicons>["name"];

export const PROFILE_TABS: { tab: ProfileTab; label: string; active: IconName; inactive: IconName }[] = [
  { tab: "posts", label: "Beiträge", active: "grid", inactive: "grid-outline" },
  { tab: "activities", label: "Aktivitäten", active: "barbell", inactive: "barbell-outline" },
  { tab: "stats", label: "Statistik", active: "stats-chart", inactive: "stats-chart-outline" },
  { tab: "reposts", label: "Reposts", active: "repeat", inactive: "repeat-outline" },
  { tab: "tagged", label: "Verlinkt", active: "person-circle", inactive: "person-circle-outline" },
];

export function isProfileTab(value: unknown): value is ProfileTab {
  return PROFILE_TABS.some((t) => t.tab === value);
}

type ProfileTabBarProps = { value: ProfileTab; onChange: (tab: ProfileTab) => void };

/** Icon tabs of a profile (like Instagram): the active one filled with a line below. */
export function ProfileTabBar({ value, onChange }: ProfileTabBarProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {PROFILE_TABS.map((t) => {
        const selected = t.tab === value;
        return (
          <Pressable
            key={t.tab}
            onPress={() => onChange(t.tab)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Ionicons name={selected ? t.active : t.inactive} size={24} color={selected ? colors.text : colors.textTertiary} />
            <View style={[styles.indicator, selected && styles.indicatorActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    tab: {
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.6,
    },
    indicator: {
      position: "absolute",
      left: "20%",
      right: "20%",
      bottom: 0,
      height: 2,
    },
    indicatorActive: {
      backgroundColor: colors.text,
    },
  }),
);
