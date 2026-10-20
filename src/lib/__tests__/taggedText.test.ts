import { describe, expect, it } from "@jest/globals";

import {
  activeToken,
  applySuggestion,
  extractHashtags,
  extractMentions,
  normalizeHashtag,
  parseTaggedText,
} from "@/lib/taggedText";

describe("parseTaggedText", () => {
  it("finds mentions and hashtags between text", () => {
    expect(parseTaggedText("Leg Day mit @lena.lifts #LegDay!")).toEqual([
      { kind: "text", value: "Leg Day mit " },
      { kind: "mention", value: "@lena.lifts", username: "lena.lifts" },
      { kind: "text", value: " " },
      { kind: "hashtag", value: "#LegDay", tag: "legday" },
      { kind: "text", value: "!" },
    ]);
  });

  it("ignores e-mails, too short names and a trailing dot", () => {
    expect(extractMentions("mail an a@b.ch oder @ab")).toEqual([]);
    expect(extractMentions("danke @marco_runs.")).toEqual(["marco_runs"]);
  });

  it("keeps umlauts in hashtags and lowercases them", () => {
    expect(extractHashtags("#Rückentag und #rückentag, #push_day")).toEqual(["rückentag", "push_day"]);
  });
});

describe("normalizeHashtag", () => {
  it("removes everything but letters, digits and _", () => {
    expect(normalizeHashtag("#Leg Day!")).toBe("legday");
    expect(normalizeHashtag("###")).toBeNull();
  });
});

describe("activeToken / applySuggestion", () => {
  it("detects the word being typed after @ or #", () => {
    expect(activeToken("Hallo @le", 9)).toEqual({ trigger: "@", query: "le", start: 6, end: 9 });
    expect(activeToken("#", 1)).toEqual({ trigger: "#", query: "", start: 0, end: 1 });
    expect(activeToken("Hallo le", 8)).toBeNull();
    expect(activeToken("mail@x", 6)).toBeNull();
  });

  it("replaces the word with the suggestion and moves the cursor behind it", () => {
    const text = "Training mit @le heute";
    const token = activeToken(text, 16);
    expect(token).not.toBeNull();
    if (token === null) return;
    expect(applySuggestion(text, token, "lena.lifts")).toEqual({
      text: "Training mit @lena.lifts heute",
      cursor: 25,
    });
  });
});
