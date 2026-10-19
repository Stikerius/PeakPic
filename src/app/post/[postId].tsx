import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { PostCard } from "@/components/feed/post-card";
import { colors, fontSize, spacing } from "@/constants/theme";
import { onAppEvent } from "@/lib/events";
import { fetchPost, setPostLiked } from "@/lib/feedRepo";
import type { FeedPost } from "@/types/social";

type LoadState = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; post: FeedPost };

/** A single post, e.g. opened from a shared post in a chat. */
export default function PostScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [liking, setLiking] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPost(postId)
      .then((post) => {
        if (active) setState(post === null ? { status: "missing" } : { status: "ready", post });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    const unsubscribe = onAppEvent("commentAdded", (event) => {
      if (event.postId !== postId) return;
      setState((s) =>
        s.status === "ready" ? { status: "ready", post: { ...s.post, commentCount: s.post.commentCount + 1 } } : s,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [postId]);

  async function toggleLike() {
    if (state.status !== "ready" || liking) return;
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

  if (state.status !== "ready") {
    return (
      <View style={styles.centered}>
        {state.status === "loading" ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Ionicons name="image-outline" size={48} color={colors.textMuted} />
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

  return (
    <ScrollView style={styles.screen}>
      <PostCard
        post={state.post}
        onToggleLike={() => void toggleLike()}
        onOpenComments={(id) => router.push({ pathname: "/comments/[postId]", params: { postId: id } })}
        onShare={(id) => router.push({ pathname: "/share/[postId]", params: { postId: id } })}
      />
    </ScrollView>
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
  message: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
