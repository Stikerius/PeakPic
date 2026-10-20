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
      onSubmit={async ({ fileUris, mentionIds }) => {
        const [fileUri] = fileUris;
        if (fileUri === undefined) return "Kein Bild.";
        const error = await addStory(fileUri, mentionIds);
        if (error === null) onShared();
        return error;
      }}
    />
  );
}
