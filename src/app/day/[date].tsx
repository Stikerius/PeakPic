import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Avatar } from "@/components/avatar";
import { PhotoCarousel } from "@/components/feed/photo-carousel";
import { PhotoViewer } from "@/components/photo-viewer";
import { fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent, onAppEvent } from "@/lib/events";
import { formatDayTitle, formatTime } from "@/lib/format";
import { fetchPost } from "@/lib/feedRepo";
import { useSession } from "@/lib/session";
import { makeStyles, useTheme } from "@/lib/theme";
import { fetchWorkoutDays } from "@/lib/workoutDaysRepo";
import { fetchUserPostsOnDay } from "@/lib/userProfileRepo";
import { workoutRepo } from "@/lib/workoutRepo";
import type { FeedPost } from "@/types/social";
import type { WorkoutWithPhoto } from "@/types/workout";

export default function DayScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  // Without userId (or with your own) this is your day and photos can be deleted.
  const { date, userId } = useLocalSearchParams<{ date: string; userId?: string }>();
  const myId = useSession().session?.user.id;
  const isMine = userId === undefined || userId === myId;
  const [workouts, setWorkouts] = useState<WorkoutWithPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ photoUrls: string[]; index: number } | null>(null);
  // Workouts of other people this user is linked to on this day (accepted workout links).
  const [linked, setLinked] = useState<FeedPost[]>([]);
  // Bumped after a post was edited or published, to reload the day.
  const [version, setVersion] = useState(0);

  useEffect(() => onAppEvent("postCreated", () => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let active = true;
    (isMine || userId === undefined ? workoutRepo.listWorkoutsOnDay(date) : fetchUserPostsOnDay(userId, date))
      .then((result) => {
        if (active) setWorkouts(result);
      })
      .catch(() => {
        if (active) setError("Fotos konnten nicht geladen werden.");
      });
    fetchWorkoutDays(isMine ? undefined : userId)
      .then(async ({ shared }) => {
        const posts = await Promise.all(shared.filter((s) => s.day === date).map((s) => fetchPost(s.postId)));
        if (active) setLinked(posts.flatMap((post) => (post !== null ? [post] : [])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [date, userId, isMine, version]);

  function openEditor(workout: WorkoutWithPhoto) {
    router.push({
      pathname: "/post-create",
      params: { mode: "edit", postId: workout.id, ...(workout.inFeed ? {} : { publish: "1" }) },
    });
  }

  async function remove(workout: WorkoutWithPhoto) {
    setDeletingId(workout.id);
    setError(null);
    try {
      await workoutRepo.deleteWorkout(workout.id);
      emitAppEvent("postDeleted", { postId: workout.id });
      const remaining = (workouts ?? []).filter((w) => w.id !== workout.id);
      setWorkouts(remaining);
      if (remaining.length === 0) router.back();
    } catch (deleteError) {
      setError(`Löschen fehlgeschlagen – ${describeError(deleteError)}`);
    } finally {
      setDeletingId(null);
    }
  }

  function confirmRemove(workout: WorkoutWithPhoto) {
    const isLast = workouts?.length === 1;
    Alert.alert(
      "Foto löschen?",
      isLast
        ? "Es ist dein einziges Foto an diesem Tag. Der Tag zählt danach nicht mehr für deinen Streak."
        : workout.photoUrls.length > 1
          ? "Der Post mit allen seinen Bildern wird endgültig gelöscht und verschwindet auch aus dem Feed."
          : "Das Foto wird endgültig gelöscht und verschwindet auch aus dem Feed.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Löschen", style: "destructive", onPress: () => void remove(workout) },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: formatDayTitle(date) }} />
      {workouts === null ? (
        <View style={styles.centered}>
          {error !== null ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      ) : (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          {linked.map((post) => (
            <Pressable
              key={`linked-${post.id}`}
              onPress={() => router.push({ pathname: "/post/[postId]", params: { postId: post.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Verlinktes Workout mit ${post.author.username} öffnen`}
              style={styles.card}
            >
              <View style={styles.linkedHeader}>
                <Avatar uri={post.author.avatarUrl} username={post.author.username} size={28} />
                <Text style={styles.linkedTitle}>Mit @{post.author.username}</Text>
                <Ionicons name="link" size={16} color={colors.accent} />
              </View>
              <PhotoCarousel photoUrls={post.photoUrls} label={`Workout von ${post.author.username}`} />
            </Pressable>
          ))}
          {workouts.length === 0 && linked.length === 0 && (
            <Text style={styles.empty}>
              {isMine ? "An diesem Tag gibt es keine Fotos." : "An diesem Tag wurde trainiert, aber keine Fotos geteilt."}
            </Text>
          )}
          {workouts.map((workout) => (
            <View key={workout.id} style={styles.card}>
              <PhotoCarousel
                photoUrls={workout.photoUrls}
                label={`Workout-Foto von ${formatTime(workout.createdAt)} Uhr`}
                onPressPhoto={(index) => setViewer({ photoUrls: workout.photoUrls, index })}
              />
              <View style={styles.footer}>
                <View style={styles.footerText}>
                  <Text style={styles.time}>
                    {formatTime(workout.createdAt)} Uhr{isMine && !workout.inFeed ? " · Nur für den Streak" : ""}
                  </Text>
                  {workout.caption !== null && (
                    <Text style={styles.caption}>{workout.caption}</Text>
                  )}
                </View>
                {isMine && (
                  <Pressable
                    onPress={() => openEditor(workout)}
                    disabled={deletingId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={workout.inFeed ? "Post bearbeiten" : "Bearbeiten und im Feed posten"}
                    style={({ pressed }) => [
                      styles.editButton,
                      !workout.inFeed && styles.publishButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={workout.inFeed ? "create-outline" : "paper-plane-outline"}
                      size={18}
                      color={workout.inFeed ? colors.text : colors.onAccent}
                    />
                    <Text style={[styles.editLabel, !workout.inFeed && styles.publishLabel]}>{workout.inFeed ? "Bearbeiten" : "Im Feed posten"}</Text>
                  </Pressable>
                )}
                {isMine && (
                  <Pressable
                    onPress={() => confirmRemove(workout)}
                    disabled={deletingId !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Foto löschen"
                    hitSlop={spacing.sm}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
                  >
                    {deletingId === workout.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Ionicons name="trash-outline" size={22} color={colors.danger} />
                    )}
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <PhotoViewer
        photoUrls={viewer?.photoUrls ?? []}
        initialIndex={viewer?.index ?? null}
        onClose={() => setViewer(null)}
      />
    </>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: spacing.md,
      gap: spacing.lg,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
      backgroundColor: colors.background,
    },
    card: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: colors.surface,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
    },
    footerText: {
      flex: 1,
      gap: spacing.xs,
    },
    time: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
    },
    caption: {
      color: colors.text,
      fontSize: fontSize.md,
    },
    linkedHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
    },
    linkedTitle: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: "700",
    },
    editButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceRaised,
    },
    publishButton: {
      backgroundColor: colors.accent,
    },
    editLabel: {
      color: colors.text,
      fontSize: fontSize.sm,
      fontWeight: "700",
    },
    publishLabel: {
      color: colors.onAccent,
    },
    deleteButton: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceRaised,
    },
    pressed: {
      opacity: 0.6,
    },
    empty: {
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
