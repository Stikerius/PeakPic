import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";

import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type {
  ChatMessage,
  ConversationSummary,
  MessageReaction,
  ReplyPreview,
  SharedComment,
  SharedPost,
} from "@/types/chat";
import type { Tables } from "@/types/database";
import type { PublicProfile } from "@/types/social";

export const MESSAGE_PAGE_SIZE = 30;
export const MESSAGE_MAX_LENGTH = 2000;

type MessageRow = Pick<
  Tables<"messages">,
  | "id"
  | "conversation_id"
  | "sender_id"
  | "body"
  | "post_id"
  | "comment_id"
  | "reply_to_id"
  | "pinned_at"
  | "kind"
  | "story_id"
  | "created_at"
>;

const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, body, post_id, comment_id, reply_to_id, pinned_at, kind, story_id, created_at";

/** Returns the 1:1 conversation with `otherUserId`, creating it if needed (must follow them). */
export async function getOrCreateDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    other_user: otherUserId,
  });
  if (error) throw error;
  return data;
}

/** Optional text sent along with a shared post or comment; shown below the card. */
function noteBody(note: string | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Sends a post (with an optional note) into the direct chat with `otherUserId`. */
export async function sharePostWithUser(postId: string, otherUserId: string, note?: string): Promise<void> {
  const userId = await requireUserId();
  const conversationId = await getOrCreateDirectConversation(otherUserId);
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, post_id: postId, body: noteBody(note) });
  if (error) throw error;
}

/** Sends a comment (as a card linking to its post, with an optional note) into the direct chat with `otherUserId`. */
export async function shareCommentWithUser(
  comment: { id: string; postId: string },
  otherUserId: string,
  note?: string,
): Promise<void> {
  const userId = await requireUserId();
  const conversationId = await getOrCreateDirectConversation(otherUserId);
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: userId,
    post_id: comment.postId,
    comment_id: comment.id,
    body: noteBody(note),
  });
  if (error) throw error;
}

/** Short text for quotes, banners and previews of an already loaded message. */
export function messagePreview(message: ChatMessage): string {
  if (message.tag !== null) return "Markierung";
  if (message.body !== null) return message.body;
  if (message.comment !== null) return "Kommentar geteilt";
  return message.post !== null && message.post !== "deleted" ? "Post geteilt" : "Post nicht mehr verfügbar";
}

function previewText(row: MessageRow): string {
  if (row.kind === "tag") return "Markierung";
  if (row.body !== null) return row.body;
  if (row.comment_id !== null) return "Kommentar geteilt";
  return row.post_id !== null ? "Post geteilt" : "Post nicht mehr verfügbar";
}

/** My conversations with partner, last message and unread count, most recent first. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const userId = await requireUserId();
  const { data: memberships, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at, conversation:conversations!conversation_members_conversation_id_fkey(created_at)")
    .eq("user_id", userId);
  if (error) throw error;
  if (memberships.length === 0) return [];

  const conversationIds = memberships.map((m) => m.conversation_id);
  const { data: partners, error: partnersError } = await supabase
    .from("conversation_members")
    .select(`conversation_id, profile:profiles!conversation_members_user_id_fkey(${PROFILE_COLUMNS})`)
    .in("conversation_id", conversationIds)
    .neq("user_id", userId);
  if (partnersError) throw partnersError;
  const profiles = await toPublicProfiles(partners.map((p) => p.profile));
  const partnerByConversation = new Map(partners.map((p) => [p.conversation_id, profiles.get(p.profile.id)]));

  // One small query per chat; fine for the number of chats a person has.
  const details = await Promise.all(
    memberships.map(async (membership) => {
      const [last, unread] = await Promise.all([
        supabase
          .from("messages")
          .select(MESSAGE_COLUMNS)
          .eq("conversation_id", membership.conversation_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", membership.conversation_id)
          .neq("sender_id", userId)
          .gt("created_at", membership.last_read_at),
      ]);
      if (last.error) throw last.error;
      if (unread.error) throw unread.error;
      return { membership, last: last.data, unreadCount: unread.count ?? 0 };
    }),
  );

  return details
    .flatMap(({ membership, last, unreadCount }): ConversationSummary[] => {
      const partner = partnerByConversation.get(membership.conversation_id);
      if (partner === undefined) return []; // partner deleted their account
      return [
        {
          id: membership.conversation_id,
          partner,
          lastMessage:
            last === null
              ? null
              : { text: previewText(last), fromMe: last.sender_id === userId, createdAt: last.created_at },
          unreadCount,
          updatedAt: last?.created_at ?? membership.conversation.created_at,
        },
      ];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversationPartner(conversationId: string): Promise<PublicProfile | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("conversation_members")
    .select(`profile:profiles!conversation_members_user_id_fkey(${PROFILE_COLUMNS})`)
    .eq("conversation_id", conversationId)
    .neq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return (await toPublicProfiles([data.profile])).get(data.profile.id) ?? null;
}

/** Resolves shared posts (author, signed photo) for a batch of message rows. */
async function hydrateMessages(rows: MessageRow[]): Promise<ChatMessage[]> {
  const postIds = [...new Set(rows.flatMap((r) => (r.post_id !== null ? [r.post_id] : [])))];
  const posts = new Map<string, SharedPost>();
  if (postIds.length > 0) {
    const { data, error } = await supabase
      .from("posts")
      .select(`id, photo_path, caption, author:profiles!posts_user_id_fkey(${PROFILE_COLUMNS})`)
      .in("id", postIds);
    if (error) throw error;
    const [photoUrls, authors] = await Promise.all([
      getSignedPhotoUrls(data.map((p) => p.photo_path)),
      toPublicProfiles(data.map((p) => p.author)),
    ]);
    for (const p of data) {
      posts.set(p.id, {
        id: p.id,
        author: authors.get(p.author.id) ?? { id: p.author.id, username: p.author.username, avatarUrl: null },
        photoUrl: photoUrls.get(p.photo_path) ?? null,
        caption: p.caption,
      });
    }
  }
  const commentIds = [...new Set(rows.flatMap((r) => (r.comment_id !== null ? [r.comment_id] : [])))];
  const comments = new Map<string, SharedComment>();
  if (commentIds.length > 0) {
    const { data, error } = await supabase
      .from("comments")
      .select(`id, post_id, body, author:profiles!comments_user_id_fkey(${PROFILE_COLUMNS})`)
      .in("id", commentIds);
    if (error) throw error;
    const authors = await toPublicProfiles(data.map((c) => c.author));
    for (const c of data) {
      comments.set(c.id, {
        id: c.id,
        postId: c.post_id,
        body: c.body,
        author: authors.get(c.author.id) ?? { id: c.author.id, username: c.author.username, avatarUrl: null },
      });
    }
  }
  // Quotes for replies; the quoted message is often not in this batch.
  const quotes = new Map<string, ReplyPreview>();
  for (const r of rows) quotes.set(r.id, { id: r.id, senderId: r.sender_id, text: previewText(r) });
  const missingQuoteIds = [
    ...new Set(rows.flatMap((r) => (r.reply_to_id !== null && !quotes.has(r.reply_to_id) ? [r.reply_to_id] : []))),
  ];
  if (missingQuoteIds.length > 0) {
    const { data, error } = await supabase.from("messages").select(MESSAGE_COLUMNS).in("id", missingQuoteIds);
    if (error) throw error;
    for (const q of data) quotes.set(q.id, { id: q.id, senderId: q.sender_id, text: previewText(q) });
  }

  const reactions = await fetchReactions(rows.map((r) => r.id));

  // Story photos for tag cards (readable while the story is visible to the reader).
  const storyIds = [...new Set(rows.flatMap((r) => (r.story_id !== null ? [r.story_id] : [])))];
  const storyPhotos = new Map<string, string>();
  if (storyIds.length > 0) {
    const { data, error } = await supabase.from("stories").select("id, photo_path").in("id", storyIds);
    if (error) throw error;
    const urls = await getSignedPhotoUrls(data.map((s) => s.photo_path));
    for (const s of data) {
      const url = urls.get(s.photo_path);
      if (url !== undefined) storyPhotos.set(s.id, url);
    }
  }
  const tagCard = (r: MessageRow): ChatMessage["tag"] => {
    if (r.kind !== "tag") return null;
    if (r.story_id !== null) return { on: "story", storyId: r.story_id, photoUrl: storyPhotos.get(r.story_id) ?? null };
    return r.comment_id !== null ? { on: "comment" } : { on: "post" };
  };

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    post:
      r.post_id !== null
        ? (posts.get(r.post_id) ?? "deleted")
        : r.body === null && r.kind !== "tag"
          ? "deleted"
          : null,
    comment: r.comment_id !== null ? (comments.get(r.comment_id) ?? null) : null,
    replyTo: r.reply_to_id !== null ? (quotes.get(r.reply_to_id) ?? "deleted") : null,
    pinnedAt: r.pinned_at,
    reactions: reactions.get(r.id) ?? [],
    tag: tagCard(r),
    createdAt: r.created_at,
  }));
}

async function fetchReactions(messageIds: string[]): Promise<Map<string, MessageReaction[]>> {
  const byMessage = new Map<string, MessageReaction[]>();
  if (messageIds.length === 0) return byMessage;
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds)
    .not("emoji", "is", null)
    .order("updated_at", { ascending: true });
  if (error) throw error;
  for (const row of data) {
    if (row.emoji === null) continue;
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), { userId: row.user_id, emoji: row.emoji }]);
  }
  return byMessage;
}

/** Newest first. Pass the createdAt of the oldest loaded message to page backwards. */
export async function fetchMessages(conversationId: string, before: string | null): Promise<ChatMessage[]> {
  let query = supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (before !== null) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return hydrateMessages(data);
}

/** Pinned messages of a chat, most recently pinned first. */
export async function fetchPinnedMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .not("pinned_at", "is", null)
    .order("pinned_at", { ascending: false });
  if (error) throw error;
  return hydrateMessages(data);
}

export async function setMessagePinned(messageId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_message_pinned", { message: messageId, pinned });
  if (error) throw error;
}

/** Sets my reaction on a message; null removes it. */
export async function setReaction(
  message: { id: string; conversationId: string },
  emoji: string | null,
): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("message_reactions").upsert({
    message_id: message.id,
    user_id: userId,
    conversation_id: message.conversationId,
    emoji,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function sendTextMessage(
  conversationId: string,
  body: string,
  replyToId: string | null = null,
): Promise<ChatMessage> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, body: body.trim(), reply_to_id: replyToId })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  const [message] = await hydrateMessages([data]);
  if (message === undefined) throw new Error("Nachricht konnte nicht gelesen werden.");
  return message;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Live inserts into my chats. RLS makes Realtime deliver only messages of conversations
 * I'm a member of; `conversationId` narrows it to one chat.
 */
export function subscribeToMessages(
  onMessage: (message: ChatMessage) => void,
  conversationId?: string,
): () => void {
  const channel = supabase
    .channel(`messages:${conversationId ?? "all"}:${Date.now()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        ...(conversationId !== undefined ? { filter: `conversation_id=eq.${conversationId}` } : {}),
      },
      (payload: RealtimePostgresInsertPayload<Tables<"messages">>) => {
        hydrateMessages([payload.new])
          .then(([message]) => {
            if (message !== undefined) onMessage(message);
          })
          .catch((error: unknown) => console.warn("[chat] Nachricht konnte nicht geladen werden:", error));
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export type ChatChange =
  | { kind: "pin"; messageId: string; pinnedAt: string | null }
  | { kind: "reaction"; messageId: string; userId: string; emoji: string | null };

/** Live pins and reactions in one chat (RLS limits both to chats I'm a member of). */
export function subscribeToChatChanges(conversationId: string, onChange: (change: ChatChange) => void): () => void {
  const filter = `conversation_id=eq.${conversationId}`;
  const onReaction = (row: Tables<"message_reactions">) =>
    onChange({ kind: "reaction", messageId: row.message_id, userId: row.user_id, emoji: row.emoji });
  const channel = supabase
    .channel(`chat-changes:${conversationId}:${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter },
      (payload: RealtimePostgresUpdatePayload<Tables<"messages">>) =>
        onChange({ kind: "pin", messageId: payload.new.id, pinnedAt: payload.new.pinned_at }),
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_reactions", filter },
      (payload: RealtimePostgresInsertPayload<Tables<"message_reactions">>) => onReaction(payload.new),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "message_reactions", filter },
      (payload: RealtimePostgresUpdatePayload<Tables<"message_reactions">>) => onReaction(payload.new),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
