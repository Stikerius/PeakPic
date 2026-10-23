import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { PostCard } from "@/components/feed/post-card";
import { Button } from "@/components/ui/button";
import { withReportSheet } from "@/components/moderation/report-provider";
import { fontSize, spacing } from "@/constants/theme";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { useOtherPostActions } from "@/hooks/use-other-post-actions";
import { usePostActions } from "@/hooks/use-post-actions";
import { useSession } from "@/lib/session";
import { onAppEvent } from "@/lib/events";
import { doubleTapLike, type DoubleTapResult } from "@/lib/doubleTapLike";
import { describeError } from "@/lib/errors";
import { fetchPost, setPostLiked } from "@/lib/feedRepo";
import { getMyRepost } from "@/lib/repostRepo";
import { toDayKey } from "@/lib/streak";
import { makeStyles, useTheme } from "@/lib/theme";
import { isWorkoutLinkExpired } from "@/lib/workoutLinks";
import { answerWorkoutLink, getMyWorkoutLink } from "@/lib/workoutLinkRepo";
import type { WorkoutShareStatus } from "@/types/database";
import type { FeedPost } from "@/types/social";
import { useTrackScreen } from "@/lib/usage";
import { fetchWorkoutIdForPost } from "@/lib/trainingRepo";

type LoadState = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; post: FeedPost };

/** A single post, e.g. opened from a shared post in a chat. */
function PostScreen() {
  useTrackScreen("screen_post");
  const { colors } = useTheme();
  const styles = useStyles();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [liking, setLiking] = useState(false);
  // A like from a double tap that is still on its way (no second request, no toggle meanwhile).
  const pendingLike = useRef(new Set<string>());
  const openProfile = useOpenProfile();
  const myId = useSession().session?.user.id;
  const showOtherPostActions = useOtherPostActions();
  const showPostActions = usePostActions({ onDeleted: () => router.back() });
  // Bumped after the post was edited, to reload it.
  const [version, setVersion] = useState(0);
  // My workout link to this post (someone else's) and whether I reposted it.
  const [link, setLink] = useState<{ id: string; status: WorkoutShareStatus; reposted: boolean } | null>(null);
  const [answering, setAnswering] = useState(false);
  // The recorded training shown with this post, if I may see it.
  const [workoutId, setWorkoutId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWorkoutIdForPost(postId)
      .then((found) => {
        if (active) setWorkoutId(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [postId]);

  useEffect(() => {
    let active = true;
    Promise.all([getMyWorkoutLink(postId), getMyRepost(postId)])
      .then(([mine, repost]) => {
        if (active) setLink(mine !== null ? { ...mine, reposted: repost !== null } : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [postId, version]);

  async function answer(accept: boolean) {
    if (link === null) return;
    setAnswering(true);
    try {
      await answerWorkoutLink(link.id, accept);
      setLink({ ...link, status: accept ? "accepted" : "declined" });
    } catch (error) {
      Alert.alert("Das hat nicht geklappt", describeError(error));
    } finally {
      setAnswering(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetchPost(postId)
      .then((post) => {
        if (active) setState(post === null ? { status: "missing" } : { status: "ready", post });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    const unsubscribeEdits = onAppEvent("postCreated", () => setVersion((v) => v + 1));
    const unsubscribe = onAppEvent("commentAdded", (event) => {
      if (event.postId !== postId) return;
      setState((s) =>
        s.status === "ready" ? { status: "ready", post: { ...s.post, commentCount: s.post.commentCount + 1 } } : s,
      );
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeEdits();
    };
  }, [postId, version]);

  async function toggleLike() {
    if (state.status !== "ready" || liking || pendingLike.current.size > 0) return;
    const post = state.post;
    const liked = !post.likedByMe;
    const apply = (value: boolean) =>
      setState({
        status: "ready",
        post: { ...post, likedByMe: value, likeCount: Math.max(0, post.likeCount + (value === post.likedByMe ? 0 : value ? 1 : -1)) },
      });
    apply(liked); // optimistic
    setLiking(true);
    try {
      await setPostLiked(post.id, liked);
    } catch {
      apply(post.likedByMe);
    } finally {
      setLiking(false);
    }
  }

  /** Double tap on the photo: likes, never unlikes. */
  function likeByDoubleTap(): DoubleTapResult {
    if (state.status !== "ready" || liking) return "already";
    const post = state.post;
    return doubleTapLike({
      postId: post.id,
      liked: post.likedByMe,
      pending: pendingLike.current,
      apply: (value) =>
        setState((current) =>
          current.status === "ready" && current.post.likedByMe !== value
            ? {
                status: "ready",
                post: { ...current.post, likedByMe: value, likeCount: Math.max(0, current.post.likeCount + (value ? 1 : -1)) },
              }
            : current,
        ),
      send: (id) => setPostLiked(id, true),
      onFailed: () => Alert.alert("Like konnte nicht gespeichert werden.", "Bitte prüfe deine Verbindung."),
    });
  }

  if (state.status !== "ready") {
    return (
      <View style={styles.centered}>
        {state.status === "loading" ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.message}>
              {state.status === "missing"
                ? "Dieser Post ist nicht mehr verfügbar."
                : "Post konnte nicht geladen werden."}
            </Text>
          </>
        )}
      </View>
    );
  }

  const expired = isWorkoutLinkExpired(state.post.workoutDate, toDayKey(new Date()));

  return (
    <ScrollView style={styles.screen}>
      {link !== null && link.status !== "declined" && (
        <View style={styles.linkBanner}>
          <Text style={styles.linkText}>
            {link.status === "accepted"
              ? `Dieses Workout zählt für deinen Streak (mit @${state.post.author.username}).`
              : expired
                ? "Die Workout-Verlinkung ist abgelaufen."
                : `@${state.post.author.username} möchte dich fürs Workout verlinken.`}
          </Text>
          {link.status === "pending" && !expired && (
            <View style={styles.linkActions}>
              <Button label="Annehmen" size="sm" loading={answering} onPress={() => void answer(true)} />
              <Button label="Ablehnen" size="sm" variant="secondary" disabled={answering} onPress={() => void answer(false)} />
            </View>
          )}
          {link.status === "accepted" && !link.reposted && (
            <Button
              label="Selbst posten"
              size="sm"
              onPress={() => router.push({ pathname: "/repost/[postId]", params: { postId } })}
            />
          )}
        </View>
      )}
      <PostCard
        post={state.post}
        onToggleLike={() => void toggleLike()}
        onDoubleTapLike={likeByDoubleTap}
        onOpenComments={(id) => router.push({ pathname: "/comments/[postId]", params: { postId: id } })}
        onOpenProfile={openProfile}
        onShare={(id) => router.push({ pathname: "/share/[postId]", params: { postId: id } })}
        onMore={state.post.author.id === myId ? showPostActions : showOtherPostActions}
      />
      {workoutId !== null && (
        <View style={styles.reportButton}>
          <Button
            label="Trainingsbericht"
            icon="barbell-outline"
            variant="secondary"
            onPress={() => router.push({ pathname: "/workout/[id]", params: { id: workoutId } })}
          />
        </View>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    reportButton: {
      padding: spacing.md,
    },
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    linkBanner: {
      gap: spacing.sm,
      margin: spacing.md,
      padding: spacing.md,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    linkText: {
      color: colors.text,
      fontSize: fontSize.md,
    },
    linkActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
      backgroundColor: colors.background,
    },
    message: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);

export default withReportSheet(PostScreen);
