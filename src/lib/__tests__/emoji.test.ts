import { describe, expect, it } from "@jest/globals";

import { QUICK_REACTIONS, isSingleEmoji } from "@/lib/emoji";

describe("isSingleEmoji", () => {
  it.each([...QUICK_REACTIONS, "😀", "🏋️‍♀️", "👍🏽", "👨‍👩‍👧", "🇨🇭", "1️⃣", "❤️‍🔥", "🏳️‍🌈", "©️", " 🎉 "])(
    "accepts %s",
    (emoji) => {
      expect(isSingleEmoji(emoji)).toBe(true);
    },
  );

  it.each(["", "a", "ab", "😀😀", "😀a", "🇨", "🇨🇭🇩🇪", "1", "👍‍", "hi 👋", "‍😀"])("rejects %j", (text) => {
    expect(isSingleEmoji(text)).toBe(false);
  });
});
