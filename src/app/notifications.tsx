import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { formatRelativeTime } from "@/lib/format";
import { fetchNotifications, markNotificationsSeen, type NotificationFeed } from "@/lib/notificationRepo";
import {
  joinNames,
  notificationText,
  type NotificationGroup,
  type NotificationKind,
} from "@/lib/notifications";
import { useSession } from "@/lib/session";
import { refreshStories } from "@/lib/storyStore";
import { toDayKey } from "@/lib/streak";

const KIND_ICONS: Record<NotificationKind, { name: ComponentProps<typeof Ionicons>["name"]; color: string }> = {
  story: { name: "aperture", color: colors.primary },
  workout: { name: "barbell", color: colors.primary },
  post_like: { name: "heart", color: colors.danger },
  comment: { name: "chatbubble", color: colors.text },
  follow: { name: "person-add", color: colors.success },
  story_like: { name: "heart", color: colors.danger },
  mention: { name: "at", color: colors.warning },
  post_tag: { name: "pricetag", color: colors.warning },
};

export default function NotificationsScreen() {
  const myId = useSession().session?.user.id;
  const openProfile = useOpenProfile();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      // Keep the previous "seen" time for this visit, so new items stay highlighted.
      setFeed(await fetchNotifications());
      setError(null);
      await markNotificationsSeen();
    } catch {
      setError("Mitteilungen konnten nicht geladen werden.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function open(group: NotificationGroup) {
    const target = group.target;
    switch (target.type) {
      case "stories":
      case "own_story": {
        // The viewer reads from the story store, so make sure it's current.
        await refreshStories();
        const userId = target.type === "stories" ? target.userId : myId;
        if (userId !== undefined) router.push({ pathname: "/stories/[userId]", params: { userId } });
        return;
      }
      case "post":
        router.push({ pathname: "/post/[postId]", params: { postId: target.postId } });
        return;
      case "profile":
        openProfile(target.userId);
        return;
      case "feed":
        router.navigate("/feed");
        return;
    }
  }

  if (feed === null) {
    return (
      <View style={styles.centered}>
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const today = toDayKey(new Date());

  return (
    <FlatList
      style={styles.screen}
      data={feed.groups}
      keyExtractor={(group) => group.key}
      contentContainerStyle={feed.groups.length === 0 ? styles.emptyContainer : undefined}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={colors.primary}
        />
      }
      renderItem={({ item }) => {
        const actors = item.actorIds.flatMap((id) => {
          const profile = feed.profiles.get(id);
          return profile !== undefined ? [profile] : [];
        });
        const first = actors[0];
        const second = actors[1];
        const unread = item.latestAt > feed.seenAt;
        const icon = KIND_ICONS[item.kind];
        return (
          <Pressable
            onPress={() => void open(item)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, unread && styles.unread, pressed && styles.pressed]}
          >
            <View style={styles.avatars}>
              {first !== undefined && <Avatar uri={first.avatarUrl} username={first.username} size={44} />}
              {second !== undefined && (
                <View style={styles.secondAvatar}>
                  <Avatar uri={second.avatarUrl} username={second.username} size={30} />
                </View>
              )}
              <View style={styles.kindBadge}>
                <Ionicons name={icon.name} size={12} color={icon.color} />
              </View>
            </View>
            <View style={styles.text}>
              <Text style={styles.sentence}>
                <Text style={styles.names}>{joinNames(actors.map((a) => a.username))}</Text>{" "}
                {notificationText(item, today)}
              </Text>
              <Text style={styles.time}>{formatRelativeTime(item.latestAt)}</Text>
            </View>
            {unread && <View style={styles.unreadDot} />}
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>Noch nichts Neues. Folge Freunden, um mitzubekommen, wann sie trainieren.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  emptyContainer: {
    flexGrow: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  unread: {
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.7,
  },
  avatars: {
    width: 52,
    height: 52,
  },
  secondAvatar: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.background,
  },
  kindBadge: {
    position: "absolute",
    left: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.background,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  sentence: {
    color: colors.text,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  names: {
    fontWeight: "700",
  },
  time: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
