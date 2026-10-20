import { router } from "expo-router";
import { ActionSheetIOS, Alert, Platform } from "react-native";

import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { setPostShownInProfile } from "@/lib/postRepo";
import { workoutRepo } from "@/lib/workoutRepo";

type PostActionsOptions = {
  /** Called after the post was deleted, e.g. to leave a screen that showed it. */
  onDeleted?: () => void;
};

/** Menu for one of my own posts: edit, show in or hide from the profile grid, delete. */
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

  function toggleProfile(postId: string, show: boolean) {
    setPostShownInProfile(postId, show)
      .then(() => emitAppEvent("postCreated", undefined))
      .catch((error: unknown) => Alert.alert("Ändern fehlgeschlagen", describeError(error)));
  }

  return function showPostActions(post: { id: string; showInProfile: boolean }) {
    const profileLabel = post.showInProfile ? "Im Profil ausblenden" : "Im Profil anzeigen";
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Bearbeiten", profileLabel, "Löschen", "Abbrechen"], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
        (index) => {
          if (index === 0) edit(post.id);
          else if (index === 1) toggleProfile(post.id, !post.showInProfile);
          else if (index === 2) confirmDelete(post.id);
        },
      );
    } else {
      Alert.alert("Post", undefined, [
        { text: "Bearbeiten", onPress: () => edit(post.id) },
        { text: profileLabel, onPress: () => toggleProfile(post.id, !post.showInProfile) },
        { text: "Löschen", style: "destructive", onPress: () => confirmDelete(post.id) },
        { text: "Abbrechen", style: "cancel" },
      ]);
    }
  };
}
