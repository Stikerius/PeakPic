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

import { PhotoCarousel } from "@/components/feed/photo-carousel";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { formatDayTitle, formatTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { fetchUserPostsOnDay } from "@/lib/userProfileRepo";
import { workoutRepo } from "@/lib/workoutRepo";
import type { WorkoutWithPhoto } from "@/types/workout";

export default function DayScreen() {
  // Without userId (or with your own) this is your day and photos can be deleted.
  const { date, userId } = useLocalSearchParams<{ date: string; userId?: string }>();
  const myId = useSession().session?.user.id;
  const isMine = userId === undefined || userId === myId;
  const [workouts, setWorkouts] = useState<WorkoutWithPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (isMine || userId === undefined ? workoutRepo.listWorkoutsOnDay(date) : fetchUserPostsOnDay(userId, date))
      .then((result) => {
        if (active) setWorkouts(result);
      })
      .catch(() => {
        if (active) setError("Fotos konnten nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, [date, userId, isMine]);

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
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          {workouts.length === 0 && (
            <Text style={styles.empty}>An diesem Tag gibt es keine Fotos.</Text>
          )}
          {workouts.map((workout) => (
            <View key={workout.id} style={styles.card}>
              <PhotoCarousel
                photoUrls={workout.photoUrls}
                label={`Workout-Foto von ${formatTime(workout.createdAt)} Uhr`}
              />
              <View style={styles.footer}>
                <View style={styles.footerText}>
                  <Text style={styles.time}>{formatTime(workout.createdAt)} Uhr</Text>
                  {workout.caption !== null && (
                    <Text style={styles.caption}>{workout.caption}</Text>
                  )}
                </View>
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
    </>
  );
}

const styles = StyleSheet.create({
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
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  caption: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
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
