import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";

import { getSignedPhotoUrls } from "@/lib/photoUpload";
import { PROFILE_COLUMNS, toPublicProfiles } from "@/lib/profiles";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, ConversationSummary, SharedComment, SharedPost } from "@/types/chat";
import type { Tables } from "@/types/database";
import type { PublicProfile } from "@/types/social";

export const MESSAGE_PAGE_SIZE = 30;
export const MESSAGE_MAX_LENGTH = 2000;

type MessageRow = Pick<
  Tables<"messages">,
  "id" | "conversation_id" | "sender_id" | "body" | "post_id" | "comment_id" | "created_at"
>;

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, post_id, comment_id, created_at";

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

function previewText(row: MessageRow): string {
  if (row.body !== null) return row.body;
  if (row.comment_id !== null) return "💬 Kommentar geteilt";
  return row.post_id !== null ? "📷 Post geteilt" : "Post nicht mehr verfügbar";
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
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    body: r.body,
    post: r.post_id !== null ? (posts.get(r.post_id) ?? "deleted") : r.body === null ? "deleted" : null,
    comment: r.comment_id !== null ? (comments.get(r.comment_id) ?? null) : null,
    createdAt: r.created_at,
  }));
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

export async function sendTextMessage(conversationId: string, body: string): Promise<ChatMessage> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, body: body.trim() })
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
