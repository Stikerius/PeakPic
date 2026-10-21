import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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

import { MentionSpots } from "@/components/mention-spots";
import { HighlightPicker } from "@/components/stories/highlight-picker";
import { StoryActivitySheet } from "@/components/stories/story-activity-sheet";
import { Avatar } from "@/components/ui/avatar";
import { useOpenProfile } from "@/hooks/use-open-profile";
import { useSwipeToDismiss } from "@/hooks/use-swipe-to-dismiss";
import { fontSize, onPhoto, radius, spacing, typography } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { formatRelativeTime } from "@/lib/format";
import {
  applyHighlightChoice,
  deleteHighlight,
  fetchHighlightGroup,
  removeStoryFromHighlight,
  type HighlightChoice,
} from "@/lib/highlightRepo";
import { fetchStoryActivity, fetchUserStoryGroup, type StoryActivity } from "@/lib/storyRepo";
import { useSession } from "@/lib/session";
import { deleteStory, markSeen, resortStories, toggleLike, useStories } from "@/lib/storyStore";
import { DarkScheme, makeStyles, useTheme } from "@/lib/theme";
import type { StoryGroup } from "@/types/social";

const STORY_DURATION_MS = 5000;
/** Horizontal drag (fraction of the width) or velocity (px/s) that switches to another person. */
const PAGE_DISTANCE = 0.25;
const PAGE_VELOCITY = 800;
const PAGE_DURATION_MS = 250;
/** Resistance when dragging back past the first person. */
const EDGE_RESISTANCE = 0.25;
/** Upward drag (px) or velocity (px/s) that opens viewers and likes of my own story. */
const ACTIVITY_DISTANCE = 60;
const ACTIVITY_VELOCITY = 500;

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
  const styles = useStyles();
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
  const styles = useStyles();
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
          <View>
            <Text style={styles.username} numberOfLines={1}>
              {group.isMine ? "Deine Story" : group.author.displayName}
            </Text>
            {!group.isMine && (
              <Text style={styles.handle} numberOfLines={1}>
                @{group.author.username}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function ProgressSegment({ state, progress }: { state: "done" | "active" | "todo"; progress: SharedValue<number> }) {
  const styles = useStyles();
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
  return (
    <DarkScheme>
      <StoryViewerScreenContent />
    </DarkScheme>
  );
}

function StoryViewerScreenContent() {
  const { colors } = useTheme();
  const styles = useStyles();
  // With highlightId: the stories of one highlight (also expired ones), no other people.
  // With only=1: just this person's active stories (e.g. opened from their profile).
  // With storyId (in those modes): start at exactly that story (links from chats/notifications).
  const { userId, highlightId, only, storyId } = useLocalSearchParams<{
    userId: string;
    highlightId?: string;
    only?: string;
    storyId?: string;
  }>();
  const store = useStories();
  const inHighlight = highlightId !== undefined;
  const singleGroupMode = inHighlight || only === "1";
  // undefined while loading, null if the highlight / stories are gone.
  const [highlightGroup, setHighlightGroup] = useState<StoryGroup | null | undefined>(undefined);
  const groups = singleGroupMode ? (highlightGroup ? [highlightGroup] : []) : store.groups;
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

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
  // Person the current sideways drag started on (rounded, also if it started mid-slide).
  const dragStartIndex = useSharedValue(0);
  const dragStartX = useSharedValue(0);
  // Person whose stories are shown; a ref so late animation callbacks can compare against it.
  const currentGroup = useRef(groupIndex);
  const openProfile = useOpenProfile();
  const myId = useSession().session?.user.id;
  const [activity, setActivity] = useState<StoryActivity | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  // The linked story (storyId) is expired, deleted or not visible to me.
  const [linkedMissing, setLinkedMissing] = useState(false);

  useEffect(() => {
    if (!singleGroupMode) return;
    (highlightId !== undefined ? fetchHighlightGroup(highlightId) : fetchUserStoryGroup(userId))
      .then((loaded) => {
        if (storyId !== undefined) {
          const index = loaded?.stories.findIndex((s) => s.id === storyId) ?? -1;
          if (index === -1) {
            setLinkedMissing(true);
            return;
          }
          setStoryIndex(index);
        }
        setHighlightGroup(loaded);
      })
      .catch(() => setHighlightGroup(null));
  }, [highlightId, userId, storyId, singleGroupMode]);

  const group = groups[groupIndex];
  const story = group?.stories[Math.min(storyIndex, group.stories.length - 1)];
  const loaded = story !== undefined && loadedId === story.id;

  function close() {
    router.back();
  }

  /**
   * Leaves the viewer for a profile. Replacing the full-screen viewer (instead of closing it
   * and pushing right away) avoids the push getting lost during the closing animation.
   */
  function closeAndOpenProfile(profileId: string) {
    setPaused(true);
    if (profileId === myId) {
      router.back();
      openProfile(profileId);
    } else {
      router.replace({ pathname: "/user/[userId]", params: { userId: profileId } });
    }
  }

  /** Called once the row has settled on `target`. Past the last person the viewer closes. */
  function commitGroup(target: number) {
    setMoving(false);
    if (target === currentGroup.current) return;
    if (target < 0 || target >= groups.length) return close();
    currentGroup.current = target;
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
    if (!loaded || paused || moving || activityOpen || highlightPickerOpen) return;
    progress.value = withTiming(
      1,
      { duration: (1 - progress.value) * STORY_DURATION_MS },
      (finished) => {
        if (finished) scheduleOnRN(goNext);
      },
    );
    return () => cancelAnimation(progress);
  }, [loaded, paused, moving, activityOpen, highlightPickerOpen, story?.id]);

  // Group disappeared (e.g. last own story deleted): leave the viewer.
  useEffect(() => {
    const loadingHighlight = singleGroupMode && highlightGroup === undefined;
    if (story === undefined && !loadingHighlight && !linkedMissing) close();
  }, [story]);

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event, success) => {
      // Ignore taps while a person switch is still sliding.
      if (!success || moving) return;
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

  // Positions come from pageX itself, not from groupIndex: a new swipe can start while the
  // previous slide is still running, before React has switched to the next person.
  const swipeSideways = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-20, 20])
    .onStart(() => {
      dragStartX.value = pageX.value;
      dragStartIndex.value = Math.round(-pageX.value / width);
      scheduleOnRN(setMoving, true);
    })
    .onUpdate((event) => {
      const dx = event.translationX;
      const atFirst = dragStartIndex.value <= 0;
      pageX.value = dragStartX.value + (dx > 0 && atFirst ? dx * EDGE_RESISTANCE : dx);
    })
    .onEnd((event) => {
      const base = dragStartIndex.value;
      const forward = event.translationX < -width * PAGE_DISTANCE || event.velocityX < -PAGE_VELOCITY;
      const back = event.translationX > width * PAGE_DISTANCE || event.velocityX > PAGE_VELOCITY;
      // Forward past the last person slides out and closes (commitGroup handles that).
      const target = forward ? base + 1 : back && base > 0 ? base - 1 : base;
      // Always settle on a whole page, never on the position where the drag started.
      if (target === base) {
        pageX.value = withSpring(-base * width, undefined, (finished) => {
          if (finished) scheduleOnRN(commitGroup, target);
        });
      } else {
        pageX.value = withTiming(-target * width, { duration: PAGE_DURATION_MS }, (finished) => {
          if (finished) scheduleOnRN(commitGroup, target);
        });
      }
    });

  // Own story: swipe up for viewers and likes.
  const isMine = group?.isMine === true;
  const swipeUp = Gesture.Pan()
    .enabled(isMine)
    .activeOffsetY(-10)
    .failOffsetX([-20, 20])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationY < -ACTIVITY_DISTANCE || event.velocityY < -ACTIVITY_VELOCITY) setActivityOpen(true);
    });

  const gestures = Gesture.Race(swipeDown.gesture, swipeUp, swipeSideways, holdToPause, tap);

  if (linkedMissing) {
    return (
      <View style={[styles.screen, styles.missing, styles.gone]}>
        <StatusBar hidden />
        <Ionicons name="time-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.goneTitle}>Diese Story ist nicht mehr verfügbar</Text>
        <Text style={styles.goneText}>Sie ist abgelaufen oder wurde gelöscht.</Text>
        <Pressable onPress={close} accessibilityRole="button" style={styles.goneButton}>
          <Text style={styles.goneButtonText}>Schliessen</Text>
        </Pressable>
      </View>
    );
  }

  if (group === undefined || story === undefined) {
    return (
      <View style={[styles.screen, styles.missing]}>
        {singleGroupMode && highlightGroup === undefined && <ActivityIndicator color={colors.text} />}
      </View>
    );
  }

  async function addToHighlight(choice: HighlightChoice) {
    setHighlightPickerOpen(false);
    if (story === undefined) return;
    try {
      await applyHighlightChoice(choice, story.id);
      emitAppEvent("highlightsChanged", undefined);
      Alert.alert("Gespeichert", `Die Story ist jetzt im Highlight „${choice.title}“.`);
    } catch (error) {
      Alert.alert("Highlight speichern fehlgeschlagen", describeError(error));
    }
  }

  function confirmRemoveFromHighlight() {
    if (story === undefined || highlightId === undefined || group === undefined) return;
    const storyId = story.id;
    const isLast = group.stories.length <= 1;
    setPaused(true);
    Alert.alert(
      "Aus Highlight entfernen?",
      isLast
        ? "Es ist die letzte Story. Das Highlight wird danach gelöscht."
        : "Die Story bleibt erhalten, sie ist nur nicht mehr in diesem Highlight.",
      [
        { text: "Abbrechen", style: "cancel", onPress: () => setPaused(false) },
        {
          text: "Entfernen",
          style: "destructive",
          onPress: () => {
            (isLast ? deleteHighlight(highlightId) : removeStoryFromHighlight(highlightId, storyId))
              .then(() => {
                emitAppEvent("highlightsChanged", undefined);
                if (isLast) return close();
                setHighlightGroup((g) => (g ? { ...g, stories: g.stories.filter((s) => s.id !== storyId) } : g));
              })
              .catch((error: unknown) => Alert.alert("Entfernen fehlgeschlagen", describeError(error)))
              .finally(() => setPaused(false));
          },
        },
      ],
    );
  }

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
                  <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
                </View>
              )}
            </View>
          </GestureDetector>

          {/* Above the photo's tap/swipe gestures, so tapping an @label opens that profile. */}
          <MentionSpots
            spots={story.mentionSpots.flatMap((spot) => {
              const person = story.mentions.find((m) => m.id === spot.userId);
              return person !== undefined ? [{ ...spot, username: person.username }] : [];
            })}
            imageAspect={story.canvasAspect ?? width / height}
            width={width}
            height={height}
            onPress={closeAndOpenProfile}
          />

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
                <View>
            <Text style={styles.username} numberOfLines={1}>
              {group.isMine ? "Deine Story" : group.author.displayName}
            </Text>
            {!group.isMine && (
              <Text style={styles.handle} numberOfLines={1}>
                @{group.author.username}
              </Text>
            )}
          </View>
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
                  <Ionicons name="chevron-up" size={14} color={colors.text} />
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
            {group.isMine && inHighlight ? (
              <Pressable
                onPress={confirmRemoveFromHighlight}
                accessibilityRole="button"
                accessibilityLabel="Aus Highlight entfernen"
                style={styles.roundButton}
              >
                <Ionicons name="remove-circle-outline" size={26} color={colors.text} />
              </Pressable>
            ) : group.isMine ? (
              <View style={styles.ownActions}>
                <Pressable
                  onPress={() => setHighlightPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Zu Highlight hinzufügen"
                  style={styles.roundButton}
                >
                  <Ionicons name="bookmark-outline" size={24} color={colors.text} />
                </Pressable>
                <Pressable
                  onPress={confirmDelete}
                  accessibilityRole="button"
                  accessibilityLabel="Story löschen"
                  style={styles.roundButton}
                >
                  <Ionicons name="trash-outline" size={24} color={colors.text} />
                </Pressable>
              </View>
            ) : inHighlight ? null : (
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

      <HighlightPicker
        visible={highlightPickerOpen}
        onPick={(choice) => void addToHighlight(choice)}
        onClose={() => setHighlightPickerOpen(false)}
      />

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

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: onPhoto.background,
    },
    slot: {
      overflow: "hidden",
      backgroundColor: onPhoto.background,
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
      backgroundColor: onPhoto.fillStrong,
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
    handle: {
      ...typography.label,
      fontWeight: "400",
      color: onPhoto.textSecondary,
    },
    time: {
      color: onPhoto.textSecondary,
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
      backgroundColor: onPhoto.scrim,
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
      backgroundColor: onPhoto.fillProgress,
    },
    mentionText: {
      color: colors.background,
      fontSize: fontSize.sm,
      fontWeight: "700",
    },
    gone: {
      gap: spacing.md,
      padding: spacing.xl,
    },
    goneTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: "700",
      textAlign: "center",
    },
    goneText: {
      color: colors.textSecondary,
      fontSize: fontSize.md,
      textAlign: "center",
    },
    goneButton: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceRaised,
    },
    goneButtonText: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "700",
    },
    ownActions: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    roundButton: {
      width: 52,
      height: 52,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: onPhoto.scrimLight,
    },
  }),
);
