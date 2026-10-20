import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { AudienceScope } from "@/types/database";
import type { PublicProfile } from "@/types/social";

/** People who follow me, alphabetically: the audience of my posts and stories. */
export async function listFollowers(): Promise<PublicProfile[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("follows")
    .select(`profile:profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`)
    .eq("following_id", userId)
    .eq("status", "accepted");
  if (error) throw error;
  const profiles = await toPublicProfiles(data.map((row) => row.profile));
  return [...profiles.values()].sort((a, b) => a.username.localeCompare(b.username));
}

/** Ids of the people my `scope` is hidden from. */
export async function listHiddenUserIds(scope: AudienceScope): Promise<Set<string>> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("audience_restrictions")
    .select("hidden_user_id")
    .eq("owner_id", userId)
    .eq("scope", scope);
  if (error) throw error;
  return new Set(data.map((row) => row.hidden_user_id));
}

export async function setHiddenFrom(
  hiddenUserId: string,
  scope: AudienceScope,
  hidden: boolean,
): Promise<void> {
  const userId = await requireUserId();
  const { error } = hidden
    ? await supabase
        .from("audience_restrictions")
        .upsert({ owner_id: userId, hidden_user_id: hiddenUserId, scope }, { ignoreDuplicates: true })
    : await supabase
        .from("audience_restrictions")
        .delete()
        .eq("owner_id", userId)
        .eq("hidden_user_id", hiddenUserId)
        .eq("scope", scope);
  if (error) throw error;
}
