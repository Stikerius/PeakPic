import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { Avatar } from "@/components/avatar";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { formatRelativeTime } from "@/lib/format";
import { deleteStory, markSeen, toggleLike, useStories } from "@/lib/storyStore";
import type { StoryGroup } from "@/types/social";

const STORY_DURATION_MS = 5000;
const DISMISS_DISTANCE = 120;

function firstUnseenIndex(group: StoryGroup | undefined): number {
  if (group === undefined) return 0;
  const index = group.stories.findIndex((s) => !s.seen);
  return index === -1 ? 0 : index;
}

function ProgressSegment({ state, progress }: { state: "done" | "active" | "todo"; progress: SharedValue<number> }) {
  const fillStyle = useAnimatedStyle(() => ({
    width: `${(state === "done" ? 1 : state === "active" ? progress.value : 0) * 100}%`,
  }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, fillStyle]} />
    </View>
  );
}

export default function StoryViewerScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { groups } = useStories();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [groupIndex, setGroupIndex] = useState(() =>
    Math.max(0, groups.findIndex((g) => g.author.id === userId)),
  );
  const [storyIndex, setStoryIndex] = useState(() => firstUnseenIndex(groups[groupIndex]));
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const progress = useSharedValue(0);
  const translateY = useSharedValue(0);

  const group = groups[groupIndex];
  const story = group?.stories[Math.min(storyIndex, group.stories.length - 1)];
  const loaded = story !== undefined && loadedId === story.id;

  function close() {
    router.back();
  }

  function goNext() {
    if (group === undefined) return close();
    if (storyIndex < group.stories.length - 1) {
      setStoryIndex(storyIndex + 1);
    } else if (groupIndex < groups.length - 1) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(firstUnseenIndex(groups[groupIndex + 1]));
    } else {
      close();
    }
  }

  function goPrev() {
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1);
    } else if (groupIndex > 0) {
      const previous = groups[groupIndex - 1];
      setGroupIndex(groupIndex - 1);
      setStoryIndex(Math.max(0, (previous?.stories.length ?? 1) - 1));
    } else {
      progress.value = 0; // restart the first story
    }
  }

  // New story: reset the bar, record the view, warm the cache for the rest of the group.
  useEffect(() => {
    if (story === undefined) return;
    progress.value = 0;
    markSeen(story);
    const upcoming = group?.stories.slice(storyIndex + 1).flatMap((s) => (s.photoUrl ? [s.photoUrl] : []));
    if (upcoming !== undefined && upcoming.length > 0) void Image.prefetch(upcoming);
  }, [story?.id]);

  // Run the timer once the image is shown; pausing keeps the current progress.
  useEffect(() => {
    if (!loaded || paused) return;
    progress.value = withTiming(
      1,
      { duration: (1 - progress.value) * STORY_DURATION_MS },
      (finished) => {
        if (finished) scheduleOnRN(goNext);
      },
    );
    return () => cancelAnimation(progress);
  }, [loaded, paused, story?.id]);

  // Group disappeared (e.g. last own story deleted): leave the viewer.
  useEffect(() => {
    if (story === undefined) close();
  }, [story]);

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event, success) => {
      if (!success) return;
      if (event.x < width / 3) goPrev();
      else goNext();
    });

  const holdToPause = Gesture.LongPress()
    .minDuration(200)
    .runOnJS(true)
    .onStart(() => setPaused(true))
    .onFinalize(() => setPaused(false));

  const swipeDown = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-20, 20])
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > 1000) {
        translateY.value = withTiming(height, { duration: 180 }, () => scheduleOnRN(close));
      } else {
        translateY.value = withSpring(0);
      }
    });

  const gestures = Gesture.Race(swipeDown, holdToPause, tap);

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: interpolate(translateY.value, [0, height * 0.5], [1, 0.5], "clamp"),
  }));

  if (group === undefined || story === undefined) return <View style={styles.screen} />;

  function confirmDelete() {
    if (story === undefined) return;
    const storyId = story.id;
    setPaused(true);
    Alert.alert("Story löschen?", "Die Story wird für alle entfernt.", [
      { text: "Abbrechen", style: "cancel", onPress: () => setPaused(false) },
      {
        text: "Löschen",
        style: "destructive",
        onPress: () => {
          // Last story of the group: leave first, so the next person's story doesn't flash up.
          // Otherwise the clamped storyIndex simply shows the following story.
          if ((group?.stories.length ?? 0) <= 1) close();
          deleteStory(storyId)
            .catch(() => Alert.alert("Löschen fehlgeschlagen", "Bitte versuche es erneut."))
            .finally(() => setPaused(false));
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <Animated.View style={[styles.flex, dragStyle]}>
        <GestureDetector gesture={gestures}>
          <View style={styles.flex} collapsable={false}>
            {story.photoUrl !== null ? (
              <Image
                key={story.id}
                source={{ uri: story.photoUrl }}
                style={styles.flex}
                contentFit="cover"
                onLoad={() => setLoadedId(story.id)}
                onError={() => setLoadedId(story.id)}
                accessibilityLabel={`Story von ${group.author.username}`}
              />
            ) : (
              <View style={[styles.flex, styles.missing]} onLayout={() => setLoadedId(story.id)}>
                <Ionicons name="image-outline" size={48} color={colors.textMuted} />
              </View>
            )}
          </View>
        </GestureDetector>

        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.progressRow}>
            {group.stories.map((s, index) => (
              <ProgressSegment
                key={s.id}
                progress={progress}
                state={index < storyIndex ? "done" : index === storyIndex ? "active" : "todo"}
              />
            ))}
          </View>
          <View style={styles.header}>
            <Avatar uri={group.author.avatarUrl} username={group.author.username} size={32} />
            <Text style={styles.username}>{group.isMine ? "Deine Story" : group.author.username}</Text>
            <Text style={styles.time}>{formatRelativeTime(story.createdAt)}</Text>
            <View style={styles.flex} />
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Story schliessen"
              hitSlop={spacing.md}
            >
              <Ionicons name="close" size={28} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
          {group.isMine ? (
            <Pressable
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel="Story löschen"
              style={styles.roundButton}
            >
              <Ionicons name="trash-outline" size={24} color={colors.text} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void toggleLike(story)}
              accessibilityRole="button"
              accessibilityLabel={story.likedByMe ? "Like entfernen" : "Story liken"}
              accessibilityState={{ selected: story.likedByMe }}
              style={styles.roundButton}
            >
              <Ionicons
                name={story.likedByMe ? "heart" : "heart-outline"}
                size={28}
                color={story.likedByMe ? colors.danger : colors.text}
              />
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  flex: {
    flex: 1,
  },
  missing: {
    alignItems: "center",
    justifyContent: "center",
  },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  progressRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  segmentFill: {
    height: "100%",
    backgroundColor: colors.text,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  username: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  time: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: fontSize.sm,
  },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
  },
  roundButton: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
});
