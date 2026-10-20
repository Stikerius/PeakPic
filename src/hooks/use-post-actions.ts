import { router } from "expo-router";
import { ActionSheetIOS, Alert, Platform } from "react-native";

import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { workoutRepo } from "@/lib/workoutRepo";

type PostActionsOptions = {
  /** Called after the post was deleted, e.g. to leave a screen that showed it. */
  onDeleted?: () => void;
};

/** Menu for one of my own posts: edit (photos, order, caption, tags) or delete. */
export function usePostActions({ onDeleted }: PostActionsOptions = {}) {
  function edit(postId: string) {
    router.push({ pathname: "/post-create", params: { mode: "edit", postId } });
  }

  function confirmDelete(postId: string) {
    Alert.alert("Post löschen?", "Der Post wird mit allen Bildern endgültig gelöscht.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: () => {
          workoutRepo
            .deleteWorkout(postId)
            .then(() => {
              emitAppEvent("postDeleted", { postId });
              onDeleted?.();
            })
            .catch((error: unknown) => Alert.alert("Löschen fehlgeschlagen", describeError(error)));
        },
      },
    ]);
  }

  return function showPostActions(postId: string) {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Bearbeiten", "Löschen", "Abbrechen"], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (index) => {
          if (index === 0) edit(postId);
          else if (index === 1) confirmDelete(postId);
        },
      );
    } else {
      Alert.alert("Post", undefined, [
        { text: "Bearbeiten", onPress: () => edit(postId) },
        { text: "Löschen", style: "destructive", onPress: () => confirmDelete(postId) },
        { text: "Abbrechen", style: "cancel" },
      ]);
    }
  };
}
