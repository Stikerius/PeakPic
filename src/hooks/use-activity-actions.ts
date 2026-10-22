import { router } from "expo-router";
import { Alert } from "react-native";

import { showActionSheet } from "@/lib/actionSheet";
import { describeError } from "@/lib/errors";
import { setPendingWorkoutLink } from "@/lib/pendingWorkoutLink";
import { VISIBILITY_LABELS } from "@/lib/planRepo";
import { deleteWorkout, setWorkoutVisibility, type WorkoutListItem } from "@/lib/trainingRepo";
import { track } from "@/lib/usage";
import type { ActivityVisibility } from "@/lib/workout";

const VISIBILITIES: ActivityVisibility[] = ["private", "followers", "public"];

/** The menu of one of my activities: who sees it, add a photo, delete. */
export function useActivityActions(onChanged: () => void, onDeleted?: () => void) {
  function changeVisibility(item: WorkoutListItem) {
    showActionSheet(
      "Wer sieht diese Aktivität",
      VISIBILITIES.filter((v) => v !== item.visibility).map((v) => ({
        label: VISIBILITY_LABELS[v],
        onPress: () =>
          void setWorkoutVisibility(item.id, v)
            .then(() => {
              track("activity_visibility_changed");
              onChanged();
            })
            .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error))),
      })),
    );
  }

  function addPhoto(item: WorkoutListItem) {
    setPendingWorkoutLink({
      workoutId: item.id,
      planDayId: item.planDayId,
      shareWithPost: false,
      countsForStreak: item.countsForStreak,
      createdAt: Date.now(),
    });
    track("workout_photo_added");
    router.dismissAll();
    router.navigate("/camera");
  }

  function confirmDelete(item: WorkoutListItem) {
    Alert.alert(
      "Aktivität löschen?",
      `Der Trainingsbericht wird gelöscht.${item.postId !== null ? " Der Beitrag mit den Fotos bleibt." : ""}${item.countsForStreak ? " Der Tag zählt dann nur noch, wenn es einen anderen Nachweis gibt." : ""}`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: () =>
            void deleteWorkout(item.id)
              .then(() => {
                track("activity_deleted");
                (onDeleted ?? onChanged)();
              })
              .catch((error: unknown) => Alert.alert("Hat nicht geklappt", describeError(error))),
        },
      ],
    );
  }

  function openMenu(item: WorkoutListItem) {
    showActionSheet(item.title, [
      { label: `Sichtbarkeit: ${VISIBILITY_LABELS[item.visibility]}`, onPress: () => changeVisibility(item) },
      ...(item.postId === null ? [{ label: "Foto hinzufügen", onPress: () => addPhoto(item) }] : []),
      { label: "Löschen", destructive: true, onPress: () => confirmDelete(item) },
    ]);
  }

  return { openMenu };
}
