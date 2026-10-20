import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type ReactNode } from "react";
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
import { StoryActivitySheet } from "@/components/stories/story-activity-sheet";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { formatRelativeTime } from "@/lib/format";
import { fetchStoryActivity, type StoryActivity } from "@/lib/storyRepo";
import { deleteStory, markSeen, resortStories, toggleLike, useStories } from "@/lib/storyStore";
import type { StoryGroup } from "@/types/social";

const STORY_DURATION_MS = 5000;
/** Horizontal drag (fraction of the width) or velocity (px/s) that switches to another person. */
const PAGE_DISTANCE = 0.25;
const PAGE_VELOCITY = 800;
const PAGE_DURATION_MS = 250;
/** Resistance when dragging back past the first person. */
const EDGE_RESISTANCE = 0.25;

/** Where a person's stories start: the first unseen one, or the beginning if all are seen. */
function entryIndex(group: StoryGroup | undefined): number {
  if (group === undefined) return 0;
  const index = group.stories.findIndex((s) => !s.seen);
  return index === -1 ? 0 : index;
}

/**
 * One person's page. Pages sit side by side at index * width and the row is shifted by
 * pageX, so after a switch the new page is already in place. The page leaving the centre
 * shrinks a little, which makes the transition between people visible.
 */
function PageSlot({
  index,
  pageX,
  width,
  children,
}: {
  index: number;
  pageX: SharedValue<number>;
  width: number;
  children: ReactNode;
}) {
  const slotStyle = useAnimatedStyle(() => {
    const offset = index * width + pageX.value;
    return {
      transform: [
        { translateX: offset },
        { scale: interpolate(Math.abs(offset), [0, width], [1, 0.88], "clamp") },
      ],
      borderRadius: interpolate(Math.abs(offset), [0, width * 0.2], [0, 16], "clamp"),
    };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, styles.slot, slotStyle]}>{children}</Animated.View>;
}

/** Static preview of a neighbouring person, visible while swiping towards them. */
function StoryPreview({ group, topInset }: { group: StoryGroup; topInset: number }) {
  const story = group.stories[entryIndex(group)];
  return (
    <View style={styles.flex}>
      {story?.photoUrl != null ? (
        <Image source={{ uri: story.photoUrl }} style={styles.flex} contentFit="cover" />
      ) : (
        <View style={[styles.flex, styles.missing]} />
      )}
      <View style={[styles.top, { paddingTop: topInset + spacing.sm }]}>
        <View style={styles.progressRow}>
          {group.stories.map((s) => (
            <View key={s.id} style={styles.segment} />
          ))}
        </View>
        <View style={styles.header}>
          <Avatar uri={group.author.avatarUrl} username={group.author.username} size={32} />
          <Text style={styles.username}>{group.isMine ? "Deine Story" : group.author.username}</Text>
        </View>
      </View>
    </View>
  );
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
  const { width } = useWindowDimensions();

  const [groupIndex, setGroupIndex] = useState(() =>
    Math.max(0, groups.findIndex((g) => g.author.id === userId)),
  );
  const [storyIndex, setStoryIndex] = useState(() => entryIndex(groups[groupIndex]));
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // Finger is moving the viewer (swipe down or sideways), or a person switch is animating.
  const [moving, setMoving] = useState(false);
  const progress = useSharedValue(0);
  const pageX = useSharedValue(-groupIndex * width);
  const dragStartX = useSharedValue(0);
  const openProfile = useOpenProfile();
  const [activity, setActivity] = useState<StoryActivity | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  const group = groups[groupIndex];
  const story = group?.stories[Math.min(storyIndex, group.stories.length - 1)];
  const loaded = story !== undefined && loadedId === story.id;

  function close() {
    router.back();
  }

  function closeAndOpenProfile(userId: string) {
    router.back();
    openProfile(userId);
  }

  /** Called once the row has slid to `target`. Past the last person the viewer closes. */
  function commitGroup(target: number) {
    setMoving(false);
    if (target < 0 || target >= groups.length) return close();
    setGroupIndex(target);
    setStoryIndex(entryIndex(groups[target]));
  }

  /** Person switch from a tap or the timer, with the same slide as a swipe. */
  function slideToGroup(target: number) {
    setMoving(true);
    pageX.value = withTiming(-target * width, { duration: PAGE_DURATION_MS }, (finished) => {
      if (finished) scheduleOnRN(commitGroup, target);
    });
  }

  function goNext() {
    if (group === undefined) return close();
    if (storyIndex < group.stories.length - 1) setStoryIndex(storyIndex + 1);
    else slideToGroup(groupIndex + 1);
  }

  function goPrev() {
    if (storyIndex > 0) setStoryIndex(storyIndex - 1);
    else if (groupIndex > 0) slideToGroup(groupIndex - 1);
    else progress.value = 0; // restart the first story
  }

  // Keep the row aligned with the current person (also if the width changes).
  useEffect(() => {
    pageX.value = -groupIndex * width;
  }, [groupIndex, width]);

  // Closing the viewer moves people I've now seen completely to the back of the bar.
  useEffect(() => resortStories, []);

  // New story: reset the bar, record the view, warm the cache for the rest of the group.
  useEffect(() => {
    if (story === undefined) return;
    progress.value = 0;
    markSeen(story);
    const nextGroup = groups[groupIndex + 1];
    const upcoming = [
      ...(group?.stories.slice(storyIndex + 1) ?? []),
      ...(nextGroup !== undefined ? [nextGroup.stories[entryIndex(nextGroup)]] : []),
    ].flatMap((s) => (s?.photoUrl ? [s.photoUrl] : []));
    if (upcoming.length > 0) void Image.prefetch(upcoming);
  }, [story?.id]);

  useEffect(() => {
    setActivity(null);
    if (story === undefined || group?.isMine !== true) return;
    let active = true;
    fetchStoryActivity(story.id)
      .then((result) => {
        if (active) setActivity(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [story?.id, group?.isMine]);

  // Run the timer once the image is shown; pausing keeps the current progress.
  useEffect(() => {
    if (!loaded || paused || moving || activityOpen) return;
    progress.value = withTiming(
      1,
      { duration: (1 - progress.value) * STORY_DURATION_MS },
      (finished) => {
        if (finished) scheduleOnRN(goNext);
      },
    );
    return () => cancelAnimation(progress);
  }, [loaded, paused, moving, activityOpen, story?.id]);

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

  const swipeDown = useSwipeToDismiss({
    onDismiss: close,
    onDragStart: () => setMoving(true),
    onDragCancel: () => setMoving(false),
  });

  const hasPrevGroup = groupIndex > 0;
  const swipeSideways = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-20, 20])
    .onStart(() => {
      dragStartX.value = pageX.value;
      scheduleOnRN(setMoving, true);
    })
    .onUpdate((event) => {
      const dx = event.translationX;
      pageX.value = dragStartX.value + (dx > 0 && !hasPrevGroup ? dx * EDGE_RESISTANCE : dx);
    })
    .onEnd((event) => {
      const forward = event.translationX < -width * PAGE_DISTANCE || event.velocityX < -PAGE_VELOCITY;
      const back = event.translationX > width * PAGE_DISTANCE || event.velocityX > PAGE_VELOCITY;
      // Forward past the last person slides out and closes (commitGroup handles that).
      const target = forward ? groupIndex + 1 : back && hasPrevGroup ? groupIndex - 1 : groupIndex;
      if (target === groupIndex) {
        pageX.value = withSpring(dragStartX.value);
        scheduleOnRN(setMoving, false);
        return;
      }
      pageX.value = withTiming(-target * width, { duration: PAGE_DURATION_MS }, (finished) => {
        if (finished) scheduleOnRN(commitGroup, target);
      });
    });

  const gestures = Gesture.Race(swipeDown.gesture, swipeSideways, holdToPause, tap);

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
      <Animated.View style={[styles.flex, swipeDown.animatedStyle]}>
        {[groupIndex - 1, groupIndex + 1].map((index) => {
          const neighbour = groups[index];
          return neighbour === undefined ? null : (
            <PageSlot key={neighbour.author.id} index={index} pageX={pageX} width={width}>
              <StoryPreview group={neighbour} topInset={insets.top} />
            </PageSlot>
          );
        })}
        <PageSlot key={group.author.id} index={groupIndex} pageX={pageX} width={width}>
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
              <Pressable
                onPress={() => closeAndOpenProfile(group.author.id)}
                accessibilityRole="button"
                accessibilityLabel={`Profil von ${group.author.username}`}
                style={styles.author}
              >
                <Avatar uri={group.author.avatarUrl} username={group.author.username} size={32} />
                <Text style={styles.username}>{group.isMine ? "Deine Story" : group.author.username}</Text>
              </Pressable>
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
            <View style={styles.mentions}>
              {group.isMine && (
                <Pressable
                  onPress={() => setActivityOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`${activity?.viewCount ?? 0} Aufrufe, ${activity?.likeCount ?? 0} Likes`}
                  style={styles.activityPill}
                >
                  <Ionicons name="eye-outline" size={16} color={colors.text} />
                  <Text style={styles.activityText}>{activity?.viewCount ?? "–"}</Text>
                  <Ionicons name="heart" size={16} color={colors.danger} />
                  <Text style={styles.activityText}>{activity?.likeCount ?? "–"}</Text>
                </Pressable>
              )}
              {story.mentions.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => closeAndOpenProfile(person.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Profil von ${person.username}`}
                  style={styles.mentionChip}
                >
                  <Ionicons name="person" size={12} color={colors.background} />
                  <Text style={styles.mentionText}>@{person.username}</Text>
                </Pressable>
              ))}
            </View>
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
        </PageSlot>
      </Animated.View>

      <StoryActivitySheet
        activity={activity}
        visible={activityOpen}
        onClose={() => setActivityOpen(false)}
        onOpenProfile={(userId) => {
          setActivityOpen(false);
          closeAndOpenProfile(userId);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  slot: {
    overflow: "hidden",
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
  author: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  mentions: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  activityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  activityText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: "700",
    marginRight: 4,
  },
  mentionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
  },
  mentionText: {
    color: colors.background,
    fontSize: fontSize.sm,
    fontWeight: "700",
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
