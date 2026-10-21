import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { STORY_RING_INSET, StoryRing } from "@/components/stories/story-ring";
import { Avatar } from "@/components/ui/avatar";
import { fontSize, radius, spacing, typography } from "@/constants/theme";
import { getMyProfile, type Profile } from "@/lib/profileRepo";
import { refreshStories, useStories } from "@/lib/storyStore";
import { makeStyles, useTheme } from "@/lib/theme";
import type { StoryGroup } from "@/types/social";

const AVATAR_SIZE = 62;
const ITEM_SIZE = AVATAR_SIZE + 2 * STORY_RING_INSET;

function openViewer(group: StoryGroup) {
  router.push({ pathname: "/stories/[userId]", params: { userId: group.author.id } });
}

export function StoryBar() {
  const { colors } = useTheme();
  const styles = useStyles();
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
          <StoryRing size={ITEM_SIZE} state={myGroup !== undefined ? "seen" : "none"}>
            <Avatar uri={me?.avatarUrl ?? null} username={me?.username ?? "?"} size={AVATAR_SIZE} />
          </StoryRing>
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
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Ionicons name="add" size={16} color={colors.onAccent} />
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
          <StoryRing size={ITEM_SIZE} state={group.hasUnseen ? "unseen" : "seen"}>
            <Avatar uri={group.author.avatarUrl} username={group.author.username} size={AVATAR_SIZE} />
          </StoryRing>
          <Text style={[styles.label, !group.hasUnseen && styles.labelSeen]} numberOfLines={1}>
            {group.author.displayName}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>
            @{group.author.username}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
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
    addBadge: {
      position: "absolute",
      top: ITEM_SIZE - 24,
      right: 0,
      width: 24,
      height: 24,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: colors.background,
    },
    label: {
      width: ITEM_SIZE + spacing.sm,
      color: colors.text,
      fontSize: fontSize.sm - 1,
      textAlign: "center",
    },
    handle: {
      ...typography.label,
      fontWeight: "400",
      width: ITEM_SIZE + spacing.sm,
      color: colors.textTertiary,
      textAlign: "center",
    },
    labelSeen: {
      color: colors.textSecondary,
    },
  }),
);
