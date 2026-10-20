import { getSignedPhotoUrl, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { TagPermission, Visibility } from "@/types/database";

export type Profile = {
  id: string;
  username: string;
  avatarPath: string | null;
  /** Signed URL for the avatar, null if there is none. */
  avatarUrl: string | null;
  isPrivate: boolean;
  storyVisibility: Visibility;
  postVisibility: Visibility;
};

export type PrivacySettings = { isPrivate: boolean; storyVisibility: Visibility; postVisibility: Visibility };

export type TagSettings = { tagPermission: TagPermission; tagNotifications: boolean; tagChatMessages: boolean };

export async function getMyTagSettings(): Promise<TagSettings> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("tag_permission, tag_notifications, tag_chat_messages")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    tagPermission: data.tag_permission,
    tagNotifications: data.tag_notifications,
    tagChatMessages: data.tag_chat_messages,
  };
}

/** Who may tag me, and whether tags notify me / show up in chats. The database enforces it. */
export async function updateTagSettings(change: Partial<TagSettings>): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...(change.tagPermission !== undefined ? { tag_permission: change.tagPermission } : {}),
      ...(change.tagNotifications !== undefined ? { tag_notifications: change.tagNotifications } : {}),
      ...(change.tagChatMessages !== undefined ? { tag_chat_messages: change.tagChatMessages } : {}),
    })
    .eq("id", userId);
  if (error) throw error;
}

export async function getMyProfile(): Promise<Profile> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_path, is_private, story_visibility, post_visibility")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    username: data.username,
    avatarPath: data.avatar_path,
    avatarUrl: data.avatar_path !== null ? await getSignedPhotoUrl(data.avatar_path) : null,
    isPrivate: data.is_private,
    storyVisibility: data.story_visibility,
    postVisibility: data.post_visibility,
  };
}

/**
 * Saves privacy settings. Going from private to public makes the database accept all
 * open follow requests.
 */
export async function updatePrivacy(change: Partial<PrivacySettings>): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("profiles")
    .update({
      ...(change.isPrivate !== undefined ? { is_private: change.isPrivate } : {}),
      ...(change.storyVisibility !== undefined ? { story_visibility: change.storyVisibility } : {}),
      ...(change.postVisibility !== undefined ? { post_visibility: change.postVisibility } : {}),
    })
    .eq("id", userId);
  if (error) throw error;
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
