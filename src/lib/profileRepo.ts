import { normalizeUsername } from "@/lib/auth";
import { displayNameError, usernameFormatError, usernameLockedMessage } from "@/lib/names";
import { getSignedPhotoUrl, removePhotos, uploadPhoto } from "@/lib/photoUpload";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { TagPermission, Visibility } from "@/types/database";

export type Profile = {
  id: string;
  username: string;
  displayName: string;
  /** Last username change (the database allows the next one 14 days later). */
  usernameChangedAt: string | null;
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
    .select("id, username, display_name, username_changed_at, avatar_path, is_private, story_visibility, post_visibility")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    usernameChangedAt: data.username_changed_at,
    avatarPath: data.avatar_path,
    avatarUrl: data.avatar_path !== null ? await getSignedPhotoUrl(data.avatar_path) : null,
    isPrivate: data.is_private,
    storyVisibility: data.story_visibility,
    postVisibility: data.post_visibility,
  };
}

/** A rename the database refused, with a message for the user. */
export class NameChangeError extends Error {
  constructor(
    message: string,
    readonly field: "username" | "displayName",
  ) {
    super(message);
    this.name = "NameChangeError";
  }
}

type PostgrestErrorLike = { code?: string; message?: string; hint?: string | null };

function toNameChangeError(error: PostgrestErrorLike): Error {
  if (error.message === "username_change_too_soon" && typeof error.hint === "string") {
    return new NameChangeError(usernameLockedMessage(new Date(error.hint), new Date()), "username");
  }
  if (error.code === "23505") return new NameChangeError("Username vergeben.", "username");
  if (error.code === "23514") {
    return error.message?.includes("display_name") === true
      ? new NameChangeError("Der Anzeigename muss 1 bis 30 Zeichen lang sein.", "displayName")
      : new NameChangeError("Dieser Username ist ungültig.", "username");
  }
  return new Error(error.message ?? "Speichern fehlgeschlagen.");
}

/**
 * Changes username and/or display name. The database enforces uniqueness (also for former
 * names of other people) and the 14-day limit for usernames; this only maps its errors.
 */
export async function updateMyNames(change: { username?: string; displayName?: string }): Promise<Profile> {
  const userId = await requireUserId();
  const username = change.username !== undefined ? normalizeUsername(change.username) : undefined;
  const displayName = change.displayName?.trim();
  if (username !== undefined) {
    const formatError = usernameFormatError(username);
    if (formatError !== null) throw new NameChangeError(formatError, "username");
  }
  if (displayName !== undefined) {
    const nameError = displayNameError(displayName);
    if (nameError !== null) throw new NameChangeError(nameError, "displayName");
  }
  const { error } = await supabase
    .from("profiles")
    .update({
      ...(username !== undefined ? { username } : {}),
      ...(displayName !== undefined ? { display_name: displayName } : {}),
    })
    .eq("id", userId);
  if (error) throw toNameChangeError(error);
  return getMyProfile();
}

/** Whether a username is free (case-insensitive; your own names count as free). */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("username_available", { name: normalizeUsername(username) });
  if (error) throw error;
  return data;
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
