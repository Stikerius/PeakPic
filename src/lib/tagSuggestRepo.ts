import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { listConnections, searchProfiles } from "@/lib/socialRepo";
import { supabase } from "@/lib/supabase";
import type { PublicProfile } from "@/types/social";

const SUGGESTION_LIMIT = 8;

export type HashtagSuggestion = { tag: string; useCount: number };

/** People for "@…": my connections while nothing is typed, otherwise username search. */
export async function suggestPeople(query: string): Promise<PublicProfile[]> {
  const people = query.length === 0 ? await listConnections() : await searchProfiles(query);
  return people.slice(0, SUGGESTION_LIMIT);
}

/** Existing hashtags starting with `query`, most used first. */
export async function suggestHashtags(query: string): Promise<HashtagSuggestion[]> {
  let request = supabase.from("hashtags").select("tag, use_count").order("use_count", { ascending: false }).limit(SUGGESTION_LIMIT);
  if (query.length > 0) request = request.like("tag", `${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await request;
  if (error) throw error;
  return data.map((row) => ({ tag: row.tag, useCount: row.use_count }));
}

// Mentions in texts only carry usernames; links always go by user id, resolved here.
const usernameCache = new Map<string, PublicProfile | null>();

/** Profiles for @usernames (cached); unknown usernames map to null. */
export async function resolveUsernames(usernames: string[]): Promise<Map<string, PublicProfile | null>> {
  const missing = [...new Set(usernames)].filter((name) => !usernameCache.has(name));
  if (missing.length > 0) {
    const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).in("username", missing);
    if (error) throw error;
    const profiles = await toPublicProfiles(data);
    for (const name of missing) usernameCache.set(name, null);
    for (const profile of profiles.values()) usernameCache.set(profile.username, profile);
  }
  return new Map(usernames.map((name) => [name, usernameCache.get(name) ?? null]));
}

export function cachedProfile(username: string): PublicProfile | null | undefined {
  return usernameCache.get(username);
}
