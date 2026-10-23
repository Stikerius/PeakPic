/**
 * Chat partners who are no longer in a chat, the pure part (unit tested): which stand-in to show.
 */
import type { PublicProfile } from "@/types/social";

/** Stand-in for a chat partner whose account no longer exists (no member row left). */
export function deletedProfile(): PublicProfile {
  return { id: "", username: "", displayName: "Gelöschtes Konto", avatarUrl: null };
}

/** Stand-in for a chat partner who left the chat while the account still exists. */
export function leftChatProfile(): PublicProfile {
  return { id: "", username: "", displayName: "Nicht mehr im Chat", avatarUrl: null };
}

/**
 * Stand-in for a chat without another member, by what the server says (get_chat_partner_states):
 * "Gelöschtes Konto" only when the account is really gone, otherwise "Nicht mehr im Chat". No
 * name, avatar or link either way.
 */
export function absentPartner(state: string | undefined): PublicProfile {
  return state === "left" ? leftChatProfile() : deletedProfile();
}
