import { MediaEditor } from "@/components/media-editor/media-editor";
import { addStory } from "@/lib/storyStore";

type StoryEditorProps = {
  photoUri: string;
  onBack: () => void;
  onShared: () => void;
};

/** Story flow's editor: the shared media editor in its full-screen story layout. */
export function StoryEditor({ photoUri, onBack, onShared }: StoryEditorProps) {
  return (
    <MediaEditor
      variant="story"
      initialUris={[photoUri]}
      submitLabel="Deine Story"
      onBack={onBack}
      onSubmit={async ({ photos, mentionIds }) => {
        const [photo] = photos;
        if (photo === undefined) return "Kein Bild.";
        const error = await addStory(photo.renderedUri ?? photo.originalUri, mentionIds);
        if (error === null) onShared();
        return error;
      }}
    />
  );
}
