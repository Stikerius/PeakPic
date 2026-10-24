import { describe, expect, it } from "@jest/globals";

import { showInChatList } from "@/lib/chatList";

describe("showInChatList", () => {
  it("shows chats I never deleted, also without messages", () => {
    expect(showInChatList(false, false)).toBe(true);
    expect(showInChatList(false, true)).toBe(true);
  });

  it("hides a chat I deleted for me until someone writes again", () => {
    expect(showInChatList(true, false)).toBe(false);
    expect(showInChatList(true, true)).toBe(true);
  });
});
