import { useEffect, useState } from "react";

import { listConversations, subscribeToMessages } from "@/lib/chatRepo";
import { onAppEvent } from "@/lib/events";

/** Number of chats with unread messages; updates on new messages and when a chat is read. */
export function useUnreadChatCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const reload = () => {
      listConversations()
        .then((conversations) => {
          if (active) setCount(conversations.filter((c) => c.unreadCount > 0).length);
        })
        .catch(() => undefined);
    };
    reload();
    const unsubscribeRealtime = subscribeToMessages(reload);
    const unsubscribeRead = onAppEvent("chatRead", reload);
    return () => {
      active = false;
      unsubscribeRealtime();
      unsubscribeRead();
    };
  }, []);

  return count;
}
