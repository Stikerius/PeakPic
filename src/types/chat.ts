import type { PublicProfile } from "@/types/social";

/** Preview of a post shared into a chat. */
export type SharedPost = {
  id: string;
  author: PublicProfile;
  photoUrl: string | null;
  caption: string | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  /** The shared post, "deleted" if it no longer exists, null for plain text messages. */
  post: SharedPost | "deleted" | null;
  createdAt: string;
  /** Optimistic message that the server hasn't confirmed yet. */
  pending?: boolean;
};

export type ConversationSummary = {
  id: string;
  partner: PublicProfile;
  lastMessage: { text: string; fromMe: boolean; createdAt: string } | null;
  unreadCount: number;
  /** Last message time, or creation time for empty chats; used for sorting. */
  updatedAt: string;
};
