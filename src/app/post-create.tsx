import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { MediaEditor, type MediaEditorResult } from "@/components/media-editor/media-editor";
import { describeError } from "@/lib/errors";
import { emitAppEvent } from "@/lib/events";
import { addToDayPost, createPost } from "@/lib/postRepo";

/** Photos per post (carousel). */
const MAX_PHOTOS = 10;

/**
 * "day": first proof of the day, published to the feed as today's slideshow.
 * "single": an extra post on a day that already has its slideshow (doesn't count twice).
 * "append": more photos for today's slideshow `postId`.
 */
type Mode = "day" | "single" | "append";

const TITLES: Record<Mode, string> = {
  day: "Workout von heute",
  single: "Einzelner Post",
  append: "Zur Slideshow von heute",
};

export default function PostCreateScreen() {
  const { photoUri, mode, postId } = useLocalSearchParams<{ photoUri: string; mode: Mode; postId?: string }>();

  async function submit({ fileUris, mentionIds, caption }: MediaEditorResult): Promise<string | null> {
    try {
      if (mode === "append") {
        if (postId === undefined) return "Die Slideshow von heute wurde nicht gefunden.";
        await addToDayPost(postId, fileUris, mentionIds);
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

  return (
    <>
      <StatusBar style="light" />
      <MediaEditor
        variant="post"
        initialUris={[photoUri]}
        maxPhotos={MAX_PHOTOS}
        showCaption={mode !== "append"}
        title={TITLES[mode]}
        submitLabel={mode === "append" ? "Hinzufügen" : "Teilen"}
        onBack={() => router.back()}
        onSubmit={submit}
      />
    </>
  );
}
