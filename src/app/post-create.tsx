import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";

import { MediaEditor, type MediaEditorResult } from "@/components/media-editor/media-editor";
import { Button } from "@/components/ui/button";
import { fontSize, onPhoto, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import {
  addToDayPost,
  createPost,
  fetchPostForEdit,
  updatePost,
  type EditablePost,
  type PostPhotoInput,
} from "@/lib/postRepo";
import { DarkScheme, makeStyles, useTheme } from "@/lib/theme";
import { requestWorkoutLinks } from "@/lib/workoutLinkRepo";

/** Photos per post (carousel). */
const MAX_PHOTOS = 10;

/**
 * "day": first proof of the day, published to the feed as today's slideshow.
 * "single": an extra post on a day that already has its slideshow (doesn't count twice).
 * "append": more photos for today's slideshow `postId`.
 * "edit": edit my post `postId` again; with publish=1 it also goes to the feed
 *         (a streak-only proof turned into a post).
 */
type Mode = "day" | "single" | "append" | "edit";

type Params = { mode: Mode; photoUri?: string; postId?: string; publish?: string };

/**
 * Asks the chosen people to count the workout. The post is saved already, so a failure here
 * only warns (saving again would create the post twice).
 */
async function linkWorkouts(postId: string, userIds: string[]): Promise<void> {
  try {
    await requestWorkoutLinks(postId, userIds);
  } catch (error) {
    console.warn("[post] Workout-Verlinkung fehlgeschlagen:", error);
    Alert.alert("Post gespeichert", `Die Workout-Verlinkung hat nicht geklappt – ${describeError(error)}`);
  }
}

export default function PostCreateScreen() {
  return (
    <DarkScheme>
      <PostCreateScreenContent />
    </DarkScheme>
  );
}

function PostCreateScreenContent() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { mode, photoUri, postId, publish } = useLocalSearchParams<Params>();
  const publishing = publish === "1";
  const [existing, setExisting] = useState<EditablePost | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || postId === undefined) return;
    fetchPostForEdit(postId)
      .then(setExisting)
      .catch((error: unknown) => setLoadError(describeError(error)));
  }, [mode, postId]);

  async function submit({
    photos: edited,
    mentionIds,
    workoutLinkIds,
    caption,
    showInProfile,
  }: MediaEditorResult): Promise<string | null> {
    // Editor photos refer to existing ones by their index in `existing.photos`.
    const photos: PostPhotoInput[] = edited.map((photo) => {
      const before = photo.source !== null ? existing?.photos[Number(photo.source)] : undefined;
      return {
        existing: before !== undefined ? { originalPath: before.originalPath, photoPath: before.photoPath } : null,
        originalUri: photo.originalUri,
        renderedUri: photo.renderedUri,
        edits: photo.edits,
        changed: photo.changed,
      };
    });
    try {
      if (mode === "edit" || mode === "append") {
        if (postId === undefined) return "Der Post wurde nicht gefunden.";
        if (mode === "append") {
          await addToDayPost(postId, photos, mentionIds);
          await linkWorkouts(postId, workoutLinkIds);
        } else {
          await updatePost(postId, {
            photos,
            caption,
            showInProfile,
            inFeed: publishing || existing?.inFeed === true,
            tagIds: mentionIds,
          });
          await linkWorkouts(postId, workoutLinkIds);
        }
      } else {
        const newPostId = await createPost({
          photos,
          caption,
          inFeed: true,
          isDayPost: mode === "day",
          showInProfile,
          tagIds: mentionIds,
        });
        await linkWorkouts(newPostId, workoutLinkIds);
      }
      emitAppEvent("postCreated", undefined);
      router.back();
      return null;
    } catch (error) {
      console.error("[post] Speichern fehlgeschlagen:", error);
      return describeError(error);
    }
  }

  if (mode === "edit") {
    if (existing === null) {
      return (
        <View style={styles.centered}>
          {loadError !== null ? (
            <>
              <Text style={styles.error}>Post konnte nicht geladen werden – {loadError}</Text>
              <Button label="Zurück" variant="secondary" onPress={() => router.back()} />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      );
    }
    return (
      <>
        <StatusBar style="light" />
        <MediaEditor
          variant="post"
          initialPhotos={existing.photos.map((p, index) => ({ uri: p.url, source: String(index), edits: p.edits }))}
          initialTags={existing.tags}
          initialCaption={existing.caption}
          initialShowInProfile={existing.showInProfile}
          maxPhotos={MAX_PHOTOS}
          showCaption
          title={publishing ? "Im Feed posten" : "Post bearbeiten"}
          submitLabel={publishing ? "Posten" : "Speichern"}
          onBack={() => router.back()}
          onSubmit={submit}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <MediaEditor
        variant="post"
        initialUris={photoUri !== undefined ? [photoUri] : []}
        maxPhotos={MAX_PHOTOS}
        showCaption={mode !== "append"}
        initialShowInProfile={mode !== "append" ? true : undefined}
        title={mode === "day" ? "Workout von heute" : mode === "single" ? "Einzelner Post" : "Zur Slideshow von heute"}
        submitLabel={mode === "append" ? "Hinzufügen" : "Teilen"}
        onBack={() => router.back()}
        onSubmit={submit}
      />
    </>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.md,
      padding: spacing.xl,
      backgroundColor: onPhoto.background,
    },
    error: {
      color: colors.danger,
      fontSize: fontSize.md,
      textAlign: "center",
    },
  }),
);
