import { describe, expect, it } from "@jest/globals";

import { backgroundUriOrNull, chatBackgroundPath, chatBackgroundUserFolder, fitWithin } from "@/lib/chatBackgroundPaths";

const USER = "6f1c2b3a-1111-4c2d-9e8f-0123456789ab";
const CHAT = "a0b1c2d3-2222-4e5f-8a9b-abcdefabcdef";

describe("chatBackgroundPath", () => {
  it("is one file per user and chat", () => {
    expect(chatBackgroundPath(USER, CHAT)).toBe(`chat-backgrounds/${USER}/${CHAT}.jpg`);
    expect(chatBackgroundUserFolder(USER)).toBe(`chat-backgrounds/${USER}`);
  });

  it("refuses ids that could point elsewhere", () => {
    expect(() => chatBackgroundPath("../other", CHAT)).toThrow("invalid_id");
    expect(() => chatBackgroundPath(USER, "a/b")).toThrow("invalid_id");
    expect(() => chatBackgroundPath("", CHAT)).toThrow("invalid_id");
  });
});

describe("fitWithin", () => {
  it("scales the longest side down to 1600", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(5000, 5000)).toEqual({ width: 1600, height: 1600 });
  });

  it("keeps small pictures as they are", () => {
    expect(fitWithin(1600, 900)).toBeNull();
    expect(fitWithin(800, 600)).toBeNull();
    expect(fitWithin(0, 600)).toBeNull();
  });

  it("never gets a side of 0 for extreme panoramas", () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 1600, height: 1 });
  });
});

describe("backgroundUriOrNull", () => {
  it("falls back to the normal background when the file is missing or empty", () => {
    expect(backgroundUriOrNull(null)).toBeNull();
    expect(backgroundUriOrNull({ exists: false, size: null, uri: "file:///x.jpg" })).toBeNull();
    expect(backgroundUriOrNull({ exists: true, size: 0, uri: "file:///x.jpg" })).toBeNull();
    expect(backgroundUriOrNull({ exists: true, size: 2048, uri: "file:///x.jpg" })).toBe("file:///x.jpg");
  });
});
