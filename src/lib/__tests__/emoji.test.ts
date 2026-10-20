import { describe, expect, it } from "@jest/globals";

import { EMOJI_SECTIONS, QUICK_REACTIONS } from "@/lib/emoji";

describe("emoji picker data", () => {
  const all = EMOJI_SECTIONS.flatMap((s) => s.emojis);

  it("has no empty entries", () => {
    expect(all.every((emoji) => emoji.trim().length > 0)).toBe(true);
  });

  it("has no duplicates within a section", () => {
    for (const section of EMOJI_SECTIONS) {
      expect(new Set(section.emojis).size).toBe(section.emojis.length);
    }
  });

  it("fits the database limit of 32 characters per emoji", () => {
    expect([...all, ...QUICK_REACTIONS].every((emoji) => emoji.length <= 32)).toBe(true);
  });
});
