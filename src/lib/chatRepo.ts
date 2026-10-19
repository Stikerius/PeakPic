import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/** Returns the 1:1 conversation with `otherUserId`, creating it if needed (must follow them). */
export async function getOrCreateDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    other_user: otherUserId,
  });
  if (error) throw error;
  return data;
}

/** Sends a post into the direct chat with `otherUserId`. */
export async function sharePostWithUser(postId: string, otherUserId: string): Promise<void> {
  const userId = await requireUserId();
  const conversationId = await getOrCreateDirectConversation(otherUserId);
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, post_id: postId });
  if (error) throw error;
}
