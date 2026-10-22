import { linkWorkoutPost } from "@/lib/trainingRepo";

/**
 * "Fotos hinzufügen" after a training: the next post made through the camera belongs to it.
 * The camera then skips the plan question (the plan day comes from the training) and asks
 * whether the training report is shown with the post. Kept in memory only; if the app is
 * closed in between, the photo can still be added later from the activity.
 */
export type PendingWorkoutLink = {
  workoutId: string;
  planDayId: string | null;
  shareWithPost: boolean;
  createdAt: number;
};

/** A link older than this is dropped, so a much later, unrelated post isn't attached. */
const PENDING_TTL_MS = 30 * 60_000;

let pending: PendingWorkoutLink | null = null;

export function setPendingWorkoutLink(link: PendingWorkoutLink | null): void {
  pending = link;
}

export function getPendingWorkoutLink(now: number = Date.now()): PendingWorkoutLink | null {
  if (pending !== null && now - pending.createdAt > PENDING_TTL_MS) pending = null;
  return pending;
}

export function setPendingShareWithPost(share: boolean): void {
  if (pending !== null) pending = { ...pending, shareWithPost: share };
}

/** After the post was saved: connects it with the training (a failure only warns; the post stays). */
export async function linkPendingWorkout(postId: string): Promise<void> {
  const link = getPendingWorkoutLink();
  if (link === null) return;
  pending = null;
  try {
    await linkWorkoutPost(link.workoutId, postId, link.shareWithPost);
  } catch (error) {
    console.warn("[training] Beitrag nicht mit dem Training verknüpft:", error);
  }
}
