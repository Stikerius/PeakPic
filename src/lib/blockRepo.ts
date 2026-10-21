import { emitAppEvent } from "@/lib/events";
import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";

export type BlockedAccount = PublicProfile & { blockedAt: string };

/**
 * Blocks someone. The database removes follows and requests in both directions and hides
 * both of you from each other; the other person is not told.
 */
export async function blockUser(userId: string): Promise<void> {
  const me = await requireUserId();
  const { error } = await supabase.from("user_blocks").insert({ blocker_id: me, blocked_id: userId });
  // Already blocked: nothing to do.
  if (error && error.code !== "23505") throw error;
  emitAppEvent("followChanged", undefined);
}

/** Unblocks someone. Follows are not restored. */
export async function unblockUser(userId: string): Promise<void> {
  const me = await requireUserId();
  const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", me).eq("blocked_id", userId);
  if (error) throw error;
  emitAppEvent("followChanged", undefined);
}

/** People I blocked (their profiles are otherwise hidden from me). */
export async function listBlockedAccounts(): Promise<BlockedAccount[]> {
  const { data, error } = await supabase.rpc("get_my_blocked_accounts", {});
  if (error) throw error;
  const urls = await getSignedPhotoUrls(data.flatMap((row) => (row.avatar_path !== null ? [row.avatar_path] : [])));
  return data.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_path !== null ? (urls.get(row.avatar_path) ?? null) : null,
    blockedAt: row.blocked_at,
  }));
}

/** Whether a block between me and another member stops new messages in this chat. */
export async function isChatBlocked(conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("conversation_has_block", { conversation: conversationId });
  if (error) throw error;
  return data;
}
