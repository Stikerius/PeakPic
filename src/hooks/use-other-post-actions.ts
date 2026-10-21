import { useReport } from "@/components/moderation/report-provider";
import { showActionSheet } from "@/lib/actionSheet";
import type { FeedPost } from "@/types/social";

/** "…" menu on someone else's post. */
export function useOtherPostActions(): (post: FeedPost) => void {
  const { openReport } = useReport();
  return (post) =>
    showActionSheet(undefined, [
      { label: "Beitrag melden", destructive: true, onPress: () => openReport({ targetType: "post", targetId: post.id }) },
    ]);
}
