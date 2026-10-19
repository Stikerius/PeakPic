import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";

const SEARCH_LIMIT = 20;

export async function getFollowingIds(): Promise<string[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);
  if (error) throw error;
  return data.map((row) => row.following_id);
}

/** Profiles I follow, alphabetically. */
export async function listFollowing(): Promise<PublicProfile[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("follows")
    .select(`profile:profiles!follows_following_id_fkey(${PROFILE_COLUMNS})`)
    .eq("follower_id", userId);
  if (error) throw error;
  const profiles = await toPublicProfiles(data.map((row) => row.profile));
  return [...profiles.values()].sort((a, b) => a.username.localeCompare(b.username));
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Other users whose username contains `query` (case-insensitive). */
export async function searchProfiles(query: string): Promise<PublicProfile[]> {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return [];
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .ilike("username", `%${escapeLike(term)}%`)
    .neq("id", userId)
    .order("username")
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  const profiles = await toPublicProfiles(data);
  return data.flatMap((row) => {
    const profile = profiles.get(row.id);
    return profile !== undefined ? [profile] : [];
  });
}

export async function setFollowing(targetId: string, follow: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = follow
    ? await supabase
        .from("follows")
        .upsert({ follower_id: userId, following_id: targetId }, { ignoreDuplicates: true })
    : await supabase
        .from("follows")
        .delete()
        .eq("follower_id", userId)
        .eq("following_id", targetId);
  if (error) throw error;
}
