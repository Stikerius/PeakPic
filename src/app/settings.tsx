import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { listHiddenUserIds } from "@/lib/privacyRepo";
import type { AudienceScope } from "@/types/database";

type RowProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
};

function SettingsRow({ icon, title, subtitle, onPress }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

function countLabel(count: number | undefined): string {
  if (count === undefined) return "…";
  if (count === 0) return "Alle Follower sehen sie";
  return `Verborgen vor ${count} ${count === 1 ? "Person" : "Personen"}`;
}

export default function SettingsScreen() {
  const [counts, setCounts] = useState<Partial<Record<AudienceScope, number>>>({});

  useFocusEffect(
    useCallback(() => {
      void Promise.all([listHiddenUserIds("stories"), listHiddenUserIds("posts")])
        .then(([stories, posts]) => setCounts({ stories: stories.size, posts: posts.size }))
        .catch(() => undefined);
    }, []),
  );

  function open(scope: AudienceScope) {
    router.push({ pathname: "/privacy/[scope]", params: { scope } });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Privatsphäre</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="aperture-outline"
          title="Story verbergen vor"
          subtitle={countLabel(counts.stories)}
          onPress={() => open("stories")}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon="images-outline"
          title="Beiträge verbergen vor"
          subtitle={countLabel(counts.posts)}
          onPress={() => open("posts")}
        />
      </View>
      <Text style={styles.footnote}>
        Verborgene Personen sehen deine Storys bzw. Workout-Beiträge und deinen Kalender nicht mehr. Sie
        erfahren davon nichts.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: "600",
    paddingHorizontal: spacing.sm,
  },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  pressed: {
    backgroundColor: colors.surfaceElevated,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.md + 22 + spacing.md,
    backgroundColor: colors.border,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 19,
    paddingHorizontal: spacing.sm,
  },
});
