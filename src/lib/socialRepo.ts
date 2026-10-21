import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";

const SEARCH_LIMIT = 20;

/** My relation to someone: not following, requested (private profile) or following. */
export type FollowStatus = "none" | "pending" | "accepted";

/** People I follow (accepted). Requests don't count anywhere. */
export async function getFollowingIds(): Promise<string[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId)
    .eq("status", "accepted");
  if (error) throw error;
  return data.map((row) => row.following_id);
}

/** Profiles I follow (accepted), alphabetically. */
export async function listFollowing(): Promise<PublicProfile[]> {
  return listFollowingOf(await requireUserId());
}

/** People I follow or who follow me (accepted), alphabetically: who I can usually tag. */
export async function listConnections(): Promise<PublicProfile[]> {
  const userId = await requireUserId();
  const [following, followers] = await Promise.all([listFollowingOf(userId), listFollowersOf(userId)]);
  const byId = new Map([...following, ...followers].map((p) => [p.id, p]));
  return [...byId.values()].sort((a, b) => a.username.localeCompare(b.username));
}

/** My follow status towards each of `userIds`. */
export async function getMyFollowStatuses(userIds: string[]): Promise<Map<string, FollowStatus>> {
  const result = new Map<string, FollowStatus>(userIds.map((id) => [id, "none"]));
  if (userIds.length === 0) return result;
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("follows")
    .select("following_id, status")
    .eq("follower_id", userId)
    .in("following_id", userIds);
  if (error) throw error;
  for (const row of data) result.set(row.following_id, row.status);
  return result;
}

/**
 * Follows someone. Returns the status the database decided: "accepted" for public
 * profiles, "pending" (a request) for private ones.
 */
export async function followUser(targetId: string): Promise<FollowStatus> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("follows")
    .upsert({ follower_id: userId, following_id: targetId }, { ignoreDuplicates: true });
  if (error) throw error;
  return (await getMyFollowStatuses([targetId])).get(targetId) ?? "none";
}

/** Unfollows, or withdraws a pending request. */
export async function unfollowUser(targetId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("follows").delete().eq("follower_id", userId).eq("following_id", targetId);
  if (error) throw error;
}

/** Removes someone who follows me (or declines their request). */
export async function removeFollower(followerId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("follows").delete().eq("follower_id", followerId).eq("following_id", userId);
  if (error) throw error;
}

function sortByName(profiles: Map<string, PublicProfile>): PublicProfile[] {
  return [...profiles.values()].sort((a, b) => a.username.localeCompare(b.username));
}

/** Accepted followers of `userId`, alphabetically (RLS: own, public profile or I follow them). */
export async function listFollowersOf(userId: string): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from("follows")
    .select(`profile:profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`)
    .eq("following_id", userId)
    .eq("status", "accepted");
  if (error) throw error;
  return sortByName(await toPublicProfiles(data.map((row) => row.profile)));
}

/** People `userId` follows (accepted), alphabetically. */
export async function listFollowingOf(userId: string): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from("follows")
    .select(`profile:profiles!follows_following_id_fkey(${PROFILE_COLUMNS})`)
    .eq("follower_id", userId)
    .eq("status", "accepted");
  if (error) throw error;
  return sortByName(await toPublicProfiles(data.map((row) => row.profile)));
}

export type FollowRequest = { profile: PublicProfile; createdAt: string };

/** Open requests to follow me, newest first. */
export async function listFollowRequests(): Promise<FollowRequest[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("follows")
    .select(`created_at, profile:profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`)
    .eq("following_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const profiles = await toPublicProfiles(data.map((row) => row.profile));
  return data.flatMap((row) => {
    const profile = profiles.get(row.profile.id);
    return profile !== undefined ? [{ profile, createdAt: row.created_at }] : [];
  });
}

export async function countFollowRequests(): Promise<number> {
  const userId = await requireUserId();
  const { count, error } = await supabase
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("following_id", userId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/** Only the followed person can do this; the database rejects anything else. */
export async function acceptFollowRequest(followerId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("follows")
    .update({ status: "accepted" })
    .eq("follower_id", followerId)
    .eq("following_id", userId)
    .eq("status", "pending");
  if (error) throw error;
}

export const declineFollowRequest = removeFollower;

/** Accepted follower and following counts; readable for every profile. */
export async function fetchFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const { data, error } = await supabase.rpc("follow_counts", { target: userId });
  if (error) throw error;
  const row = data[0];
  return { followers: Number(row?.followers ?? 0), following: Number(row?.following ?? 0) };
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Other users whose username or display name contains `query` (case-insensitive). */
export async function searchProfiles(query: string): Promise<PublicProfile[]> {
  const raw = query.trim().replace(/^@/, "");
  if (raw.length === 0) return [];
  const pattern = `%${escapeLike(raw)}%`;
  const userId = await requireUserId();
  // Two simple queries instead of one or() filter, so any input is matched literally.
  const [byUsername, byDisplayName] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).ilike("username", pattern).neq("id", userId).limit(SEARCH_LIMIT),
    supabase.from("profiles").select(PROFILE_COLUMNS).ilike("display_name", pattern).neq("id", userId).limit(SEARCH_LIMIT),
  ]);
  if (byUsername.error) throw byUsername.error;
  if (byDisplayName.error) throw byDisplayName.error;
  const rows = new Map([...byUsername.data, ...byDisplayName.data].map((row) => [row.id, row]));
  const profiles = await toPublicProfiles([...rows.values()]);
  const term = raw.toLowerCase();
  // Usernames starting with the query first, then alphabetically by display name.
  const rank = (p: PublicProfile) => (p.username.startsWith(term) ? 0 : p.displayName.toLowerCase().startsWith(term) ? 1 : 2);
  return [...profiles.values()]
    .sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName, "de"))
    .slice(0, SEARCH_LIMIT);
}
