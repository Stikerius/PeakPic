import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { getMyProfile, type Profile } from "@/lib/profileRepo";
import { refreshStories, useStories } from "@/lib/storyStore";
import type { StoryGroup } from "@/types/social";

const AVATAR_SIZE = 62;
const RING_GAP = 3;
const RING_WIDTH = 2.5;
const ITEM_SIZE = AVATAR_SIZE + 2 * (RING_GAP + RING_WIDTH);

function openViewer(group: StoryGroup) {
  router.push({ pathname: "/stories/[userId]", params: { userId: group.author.id } });
}

export function StoryBar() {
  const { groups, uploading } = useStories();
  const [me, setMe] = useState<Profile | null>(null);
  const myGroup = groups.find((g) => g.isMine);
  const otherGroups = groups.filter((g) => !g.isMine);

  useEffect(() => {
    void refreshStories();
    getMyProfile()
      .then(setMe)
      .catch(() => undefined);
  }, []);

  function chooseSource() {
    router.push("/story-create");
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bar}
      style={styles.container}
    >
      <View style={styles.item}>
        <Pressable
          onPress={() => (myGroup !== undefined ? openViewer(myGroup) : chooseSource())}
          onLongPress={chooseSource}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={myGroup !== undefined ? "Deine Story ansehen" : "Story hinzufügen"}
          accessibilityHint={myGroup !== undefined ? "Lange drücken, um eine weitere Story hinzuzufügen" : undefined}
        >
          <View style={[styles.ring, myGroup !== undefined ? styles.ringSeen : styles.ringNone]}>
            <Avatar uri={me?.avatarUrl ?? null} username={me?.username ?? "?"} size={AVATAR_SIZE} />
          </View>
        </Pressable>
        <Pressable
          onPress={chooseSource}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Story hinzufügen"
          hitSlop={spacing.sm}
          style={styles.addBadge}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons name="add" size={16} color={colors.text} />
          )}
        </Pressable>
        <Text style={styles.label} numberOfLines={1}>
          Deine Story
        </Text>
      </View>

      {otherGroups.map((group) => (
        <Pressable
          key={group.author.id}
          onPress={() => openViewer(group)}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel={`Story von ${group.author.username}${group.hasUnseen ? ", neu" : ""}`}
        >
          <View style={[styles.ring, group.hasUnseen ? styles.ringUnseen : styles.ringSeen]}>
            <Avatar uri={group.author.avatarUrl} username={group.author.username} size={AVATAR_SIZE} />
          </View>
          <Text style={[styles.label, !group.hasUnseen && styles.labelSeen]} numberOfLines={1}>
            {group.author.username}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bar: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  item: {
    width: ITEM_SIZE,
    alignItems: "center",
    gap: spacing.xs,
  },
  ring: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: radius.full,
    borderWidth: RING_WIDTH,
    padding: RING_GAP,
    alignItems: "center",
    justifyContent: "center",
  },
  ringUnseen: {
    borderColor: colors.primary,
  },
  ringSeen: {
    borderColor: colors.border,
  },
  ringNone: {
    borderColor: "transparent",
  },
  addBadge: {
    position: "absolute",
    top: ITEM_SIZE - 24,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
  },
  label: {
    width: ITEM_SIZE + spacing.sm,
    color: colors.text,
    fontSize: fontSize.sm - 1,
    textAlign: "center",
  },
  labelSeen: {
    color: colors.textMuted,
  },
});
