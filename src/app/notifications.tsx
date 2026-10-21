import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ModerationNotices } from "@/components/moderation/moderation-notices";
import { InboxRow } from "@/components/notifications/inbox-row";
import { Avatar } from "@/components/ui/avatar";
import { fontSize, radius, spacing, type ColorName } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { formatRelativeTime } from "@/lib/format";
import { fetchInbox, markInboxRead, subscribeToInbox, type InboxItem } from "@/lib/inboxRepo";
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
import { makeStyles, useTheme } from "@/lib/theme";

const KIND_ICONS: Record<NotificationKind, { name: ComponentProps<typeof Ionicons>["name"]; color: ColorName }> = {
  story: { name: "aperture", color: "accent" },
  workout: { name: "barbell", color: "accent" },
  post_like: { name: "heart", color: "danger" },
  comment: { name: "chatbubble", color: "text" },
  follow: { name: "person-add", color: "success" },
  story_like: { name: "heart", color: "danger" },
  mention: { name: "at", color: "warning" },
  post_tag: { name: "pricetag", color: "warning" },
};

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const myId = useSession().session?.user.id;
  const openProfile = useOpenProfile();
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      // Keep the previous "seen" time for this visit, so new items stay highlighted.
      const [activity, stored] = await Promise.all([fetchNotifications(), fetchInbox()]);
      setFeed(activity);
      setInbox(stored);
      setError(null);
      await Promise.all([markNotificationsSeen(), markInboxRead()]);
    } catch {
      setError("Mitteilungen konnten nicht geladen werden.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // New tags, workout links and follow requests appear live.
  useEffect(() => {
    if (myId === undefined) return;
    return subscribeToInbox(myId, () => {
      fetchInbox()
        .then(setInbox)
        .catch(() => undefined);
    });
  }, [myId]);

  async function open(group: NotificationGroup) {
    const target = group.target;
    switch (target.type) {
      case "stories": {
        // The viewer reads from the story store, so make sure it's current.
        await refreshStories();
        router.push({ pathname: "/stories/[userId]", params: { userId: target.userId } });
        return;
      }
      case "own_story":
        // Straight to the liked story (or a friendly "expired" message).
        if (myId !== undefined) {
          router.push({ pathname: "/stories/[userId]", params: { userId: myId, only: "1", storyId: target.storyId } });
        }
        return;
      case "post":
        router.push({ pathname: "/post/[postId]", params: { postId: target.postId } });
        return;
      case "comment":
        router.push({ pathname: "/post/[postId]", params: { postId: target.postId } });
        router.push({ pathname: "/comments/[postId]", params: { postId: target.postId, commentId: target.commentId } });
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
        {error !== null ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }

  const today = toDayKey(new Date());

  return (
    <FlatList
      style={styles.screen}
      data={feed.groups}
      keyExtractor={(group) => group.key}
      contentContainerStyle={feed.groups.length === 0 && inbox.length === 0 ? styles.emptyContainer : undefined}
      ListHeaderComponent={
        <View>
          <ModerationNotices />
          {inbox.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Für dich</Text>
              {inbox.map((item) => (
                <InboxRow key={item.id} item={item} onChanged={() => void load()} />
              ))}
              {feed.groups.length > 0 && <Text style={styles.sectionTitle}>Aktivität</Text>}
            </>
          )}
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={colors.accent}
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
        inbox.length > 0 ? null : (
          <View style={styles.centered}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>Noch nichts Neues. Folge Freunden, um mitzubekommen, wann sie trainieren.</Text>
          </View>
        )
      }
    />
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
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
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "700",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
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
      backgroundColor: colors.surfaceRaised,
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
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: radius.full,
      backgroundColor: colors.accent,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);
