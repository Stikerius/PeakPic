import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { formatRelativeTime } from "@/lib/format";
import type { InboxItem } from "@/lib/inboxRepo";
import { acceptFollowRequest, declineFollowRequest } from "@/lib/socialRepo";
import { makeStyles, useTheme } from "@/lib/theme";
import { answerWorkoutLink } from "@/lib/workoutLinkRepo";

type InboxRowProps = {
  item: InboxItem;
  /** Reload after an action (the database updates or removes the notification). */
  onChanged: () => void;
};

function sentence(item: InboxItem): string {
  switch (item.type) {
    case "follow_request":
      return "möchte dir folgen";
    case "tag":
      if (item.commentId !== null) return `hat dich in einem Kommentar erwähnt: „${item.commentBody ?? "…"}“`;
      if (item.storyId !== null) return "hat dich in einer Story markiert";
      return "hat dich in einem Beitrag markiert";
    case "workout_tag_request":
      return "möchte dich fürs Workout verlinken. Zu deinem Streak hinzufügen?";
    case "workout_tag_accepted":
      return "hat deine Workout-Verlinkung angenommen";
  }
}

/** One stored notification with its preview and actions (confirm, accept, repost …). */
export function InboxRow({ item, onChanged }: InboxRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      emitAppEvent("followChanged", undefined);
      onChanged();
    } catch (error) {
      Alert.alert("Das hat nicht geklappt", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  function open() {
    if (item.type === "follow_request") {
      router.push({ pathname: "/user/[userId]", params: { userId: item.actor.id } });
    } else if (item.commentId !== null && item.postId !== null) {
      router.push({ pathname: "/post/[postId]", params: { postId: item.postId } });
      router.push({ pathname: "/comments/[postId]", params: { postId: item.postId, commentId: item.commentId } });
    } else if (item.storyId !== null) {
      // Exactly the story I was tagged in (the actor owns it).
      router.push({ pathname: "/stories/[userId]", params: { userId: item.actor.id, only: "1", storyId: item.storyId } });
    } else if (item.postId !== null) {
      router.push({ pathname: "/post/[postId]", params: { postId: item.postId } });
    }
  }

  const link = item.link;
  let actions = null;
  if (item.type === "follow_request") {
    actions = (
      <View style={styles.actions}>
        <Button label="Bestätigen" size="sm" loading={busy} onPress={() => void run(() => acceptFollowRequest(item.actor.id))} />
        <Button
          label="Ablehnen"
          size="sm"
          variant="secondary"
          disabled={busy}
          onPress={() => void run(() => declineFollowRequest(item.actor.id))}
        />
      </View>
    );
  } else if (item.type === "workout_tag_request" && link !== null) {
    if (link.status === "pending" && !link.expired) {
      actions = (
        <View style={styles.actions}>
          <Button label="Annehmen" size="sm" loading={busy} onPress={() => void run(() => answerWorkoutLink(link.id, true))} />
          <Button
            label="Ablehnen"
            size="sm"
            variant="secondary"
            disabled={busy}
            onPress={() => void run(() => answerWorkoutLink(link.id, false))}
          />
        </View>
      );
    } else {
      const status =
        link.status === "accepted" ? "Angenommen" : link.status === "declined" ? "Abgelehnt" : "Abgelaufen";
      actions = (
        <View style={styles.actions}>
          <Text style={styles.status}>{status}</Text>
          {link.status === "accepted" && link.canRepost && !link.reposted && item.postId !== null && (
            <Button
              label="Selbst posten"
              size="sm"
              onPress={() => router.push({ pathname: "/repost/[postId]", params: { postId: item.postId ?? "" } })}
            />
          )}
          {link.reposted && <Text style={styles.status}>· Repostet</Text>}
        </View>
      );
    }
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !item.read && styles.unread, pressed && styles.pressed]}
    >
      <Avatar uri={item.actor.avatarUrl} username={item.actor.username} size={44} />
      <View style={styles.body}>
        <Text style={styles.sentence}>
          <Text style={styles.name}>{item.actor.username}</Text> {sentence(item)}
        </Text>
        <Text style={styles.time}>{formatRelativeTime(item.createdAt)}</Text>
        {actions}
      </View>
      {item.photoUrl !== null ? (
        <Image source={{ uri: item.photoUrl }} style={styles.thumb} contentFit="cover" />
      ) : item.type === "workout_tag_request" || item.type === "workout_tag_accepted" ? (
        <View style={[styles.thumb, styles.thumbIcon]}>
          <Ionicons name="link" size={20} color={colors.accent} />
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
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
    body: {
      flex: 1,
      gap: 2,
    },
    sentence: {
      color: colors.text,
      fontSize: fontSize.md,
      lineHeight: 21,
    },
    name: {
      fontWeight: "700",
    },
    time: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    status: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: "600",
    },
    thumb: {
      width: 48,
      height: 60,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceRaised,
    },
    thumbIcon: {
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
