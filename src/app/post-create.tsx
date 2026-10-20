import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { MediaEditor, type MediaEditorResult } from "@/components/media-editor/media-editor";
import { colors, fontSize, spacing } from "@/constants/theme";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { addToDayPost, createPost, fetchPostForEdit, updatePost, type EditablePost } from "@/lib/postRepo";

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

export default function PostCreateScreen() {
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

  async function submit({ fileUris, mentionIds, caption }: MediaEditorResult): Promise<string | null> {
    try {
      if (mode === "edit" || mode === "append") {
        if (postId === undefined) return "Der Post wurde nicht gefunden.";
        if (mode === "append") {
          await addToDayPost(postId, fileUris, mentionIds);
        } else {
          await updatePost(postId, {
            photoUris: fileUris,
            existingPaths: Object.fromEntries((existing?.photos ?? []).map((p) => [p.url, p.path])),
            caption,
            inFeed: publishing || existing?.inFeed === true,
            tagIds: mentionIds,
          });
        }
      } else {
        await createPost({
          photoUris: fileUris,
          caption,
          inFeed: true,
          isDayPost: mode === "day",
          tagIds: mentionIds,
        });
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
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      );
    }
    return (
      <>
        <StatusBar style="light" />
        <MediaEditor
          variant="post"
          initialUris={existing.photos.map((p) => p.url)}
          initialCaption={existing.caption}
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
        title={mode === "day" ? "Workout von heute" : mode === "single" ? "Einzelner Post" : "Zur Slideshow von heute"}
        submitLabel={mode === "append" ? "Hinzufügen" : "Teilen"}
        onBack={() => router.back()}
        onSubmit={submit}
      />
    </>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: "#000000",
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.md,
    textAlign: "center",
  },
});
