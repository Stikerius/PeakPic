/**
 * Deleting chat messages, the pure part (unit tested). "Für mich löschen" hides a message for me
 * only; "Für alle löschen" removes it for good, without a trace, and only the sender may do that
 * (the database checks the same, see delete_message_for_everyone()).
 */
import type { ChatMessage } from "@/types/chat";

export type DeleteOptions = { forMe: boolean; forAll: boolean };

/** Every member may hide any message for themself; only the sender may delete it for everyone. */
export function messageDeleteOptions(message: Pick<ChatMessage, "senderId" | "pending">, myId: string | undefined): DeleteOptions {
  if (message.pending === true || myId === undefined) return { forMe: false, forAll: false };
  return { forMe: true, forAll: message.senderId === myId };
}

/**
 * The list without the message. `dropQuotes` (deleted for everyone): replies to it lose the quote
 * completely, as in the database (reply_to_id is set to null), so nothing points at it any more.
 */
export function withoutMessage(messages: readonly ChatMessage[], messageId: string, dropQuotes: boolean): ChatMessage[] {
  return messages.flatMap((m): ChatMessage[] => {
    if (m.id === messageId) return [];
    if (dropQuotes && m.replyTo !== null && m.replyTo !== "deleted" && m.replyTo.id === messageId) {
      return [{ ...m, replyTo: null }];
    }
    return [m];
  });
}

/** Puts a message back (after a refused "Für mich löschen"), newest first like the chat list. */
export function restoreMessage(messages: readonly ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((m) => m.id === message.id)) return [...messages];
  return [...messages, message].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
