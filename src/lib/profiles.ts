import { getSignedPhotoUrls } from "@/lib/photoUpload";
import type { PublicProfile } from "@/types/social";

export type ProfileRow = { id: string; username: string; display_name: string; avatar_path: string | null };

/** Columns to select for embedding a profile, e.g. `author:profiles!fk(${PROFILE_COLUMNS})`. */
export const PROFILE_COLUMNS = "id, username, display_name, avatar_path";

/**
 * Stand-in for someone whose profile I can't see (blocked in either direction, suspended,
 * or deleted), e.g. as the partner of an existing chat.
 */
export function unavailableProfile(id: string): PublicProfile {
  return { id, username: "", displayName: "Konto nicht verfügbar", avatarUrl: null };
}

/** Turns profile rows into PublicProfiles with signed avatar URLs (one batch request). */
export async function toPublicProfiles(rows: ProfileRow[]): Promise<Map<string, PublicProfile>> {
  const avatarPaths = rows.flatMap((r) => (r.avatar_path !== null ? [r.avatar_path] : []));
  const urls = await getSignedPhotoUrls(avatarPaths);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        avatarUrl: r.avatar_path !== null ? (urls.get(r.avatar_path) ?? null) : null,
      },
    ]),
  );
}
