import { describe, expect, it } from "@jest/globals";

import { messageDeleteOptions, restoreMessage, withoutMessage } from "@/lib/chatDelete";
import type { ChatMessage } from "@/types/chat";

function message(id: string, senderId: string, createdAt: string, replyToId: string | null = null): ChatMessage {
  return {
    id,
    conversationId: "c1",
    senderId,
    body: `Text ${id}`,
    post: null,
    comment: null,
    replyTo: replyToId !== null ? { id: replyToId, senderId: "a", text: "Zitat" } : null,
    pinnedAt: null,
    reactions: [],
    tag: null,
    createdAt,
  };
}

// Newest first, like the chat.
const list = [
  message("m3", "b", "2026-10-23T10:03:00Z", "m1"),
  message("m2", "a", "2026-10-23T10:02:00Z"),
  message("m1", "a", "2026-10-23T10:01:00Z"),
];

describe("messageDeleteOptions", () => {
  it("offers 'für alle' only to the sender", () => {
    expect(messageDeleteOptions(message("m1", "a", "x"), "a")).toEqual({ forMe: true, forAll: true });
    expect(messageDeleteOptions(message("m1", "a", "x"), "b")).toEqual({ forMe: true, forAll: false });
  });

  it("offers nothing for a message that isn't sent yet", () => {
    expect(messageDeleteOptions({ senderId: "a", pending: true }, "a")).toEqual({ forMe: false, forAll: false });
    expect(messageDeleteOptions({ senderId: "a" }, undefined)).toEqual({ forMe: false, forAll: false });
  });
});

describe("withoutMessage", () => {
  it("deleted for everyone: the message and the quote in replies disappear", () => {
    const result = withoutMessage(list, "m1", true);
    expect(result.map((m) => m.id)).toEqual(["m3", "m2"]);
    expect(result[0]?.replyTo).toBeNull();
  });

  it("hidden for me: the reply keeps its quote", () => {
    const result = withoutMessage(list, "m1", false);
    expect(result.map((m) => m.id)).toEqual(["m3", "m2"]);
    expect(result[0]?.replyTo).not.toBeNull();
  });

  it("an unknown id changes nothing", () => {
    expect(withoutMessage(list, "x", true)).toEqual(list);
  });
});

describe("restoreMessage", () => {
  it("puts a hidden message back in its place (rollback)", () => {
    const hidden = withoutMessage(list, "m2", false);
    const removed = list[1];
    if (removed === undefined) throw new Error("missing");
    expect(restoreMessage(hidden, removed).map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
    expect(restoreMessage(list, removed)).toHaveLength(3);
  });
});
