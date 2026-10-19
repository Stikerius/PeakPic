import { getSignedPhotoUrl, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export type Profile = {
  id: string;
  username: string;
  avatarPath: string | null;
  /** Signed URL for the avatar, null if there is none. */
  avatarUrl: string | null;
};

export async function getMyProfile(): Promise<Profile> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_path")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    username: data.username,
    avatarPath: data.avatar_path,
    avatarUrl: data.avatar_path !== null ? await getSignedPhotoUrl(data.avatar_path) : null,
  };
}

/** Uploads a new avatar, points the profile at it and removes the previous file. */
export async function updateMyAvatar(sourceUri: string, previousPath: string | null): Promise<Profile> {
  const userId = await requireUserId();
  const path = await uploadPhoto(userId, "avatar", sourceUri);
  const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId);
  if (error) {
    await removePhotos([path]).catch(() => undefined);
    throw error;
  }
  if (previousPath !== null) await removePhotos([previousPath]).catch(() => undefined);
  return getMyProfile();
}
