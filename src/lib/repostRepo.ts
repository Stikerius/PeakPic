import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";

export const REPOST_CAPTION_MAX_LENGTH = 200;

export type Repost = {
  id: string;
  originalPostId: string;
  reposter: PublicProfile;
  caption: string | null;
  createdAt: string;
};

const REPOST_SELECT = `id, original_post_id, caption, created_at, reposter:profiles!post_reposts_reposter_id_fkey(${PROFILE_COLUMNS})`;

type RepostRow = {
  id: string;
  original_post_id: string;
  caption: string | null;
  created_at: string;
  reposter: { id: string; username: string; avatar_path: string | null };
};

async function toReposts(rows: RepostRow[]): Promise<Repost[]> {
  const profiles = await toPublicProfiles(rows.map((r) => r.reposter));
  return rows.map((r) => ({
    id: r.id,
    originalPostId: r.original_post_id,
    reposter: profiles.get(r.reposter.id) ?? { id: r.reposter.id, username: r.reposter.username, avatarUrl: null },
    caption: r.caption,
    createdAt: r.created_at,
  }));
}

/**
 * Reposts a post I'm linked to (accepted). The database allows it only for accepted
 * workout links to posts that are in the feed. No files are copied.
 */
export async function createRepost(originalPostId: string, caption: string): Promise<void> {
  const userId = await requireUserId();
  const trimmed = caption.trim();
  const { error } = await supabase
    .from("post_reposts")
    .insert({ original_post_id: originalPostId, reposter_id: userId, caption: trimmed.length > 0 ? trimmed : null });
  if (error) throw error;
}

/** Only the reposter can delete a repost. */
export async function deleteRepost(repostId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("post_reposts").delete().eq("id", repostId).eq("reposter_id", userId);
  if (error) throw error;
}

/** Reposts of a post (the owner sees all of them; others only what RLS allows). */
export async function listReposts(originalPostId: string): Promise<Repost[]> {
  const { data, error } = await supabase
    .from("post_reposts")
    .select(REPOST_SELECT)
    .eq("original_post_id", originalPostId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return toReposts(data);
}

/** Reposts by these people, newest first; for the feed (same cursor as posts). */
export async function fetchRepostsBy(reposterIds: string[], before: string | null, limit: number): Promise<Repost[]> {
  if (reposterIds.length === 0) return [];
  let query = supabase
    .from("post_reposts")
    .select(REPOST_SELECT)
    .in("reposter_id", reposterIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before !== null) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return toReposts(data);
}

export async function getMyRepost(originalPostId: string): Promise<Repost | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("post_reposts")
    .select(REPOST_SELECT)
    .eq("original_post_id", originalPostId)
    .eq("reposter_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data === null ? null : ((await toReposts([data]))[0] ?? null);
}
