import { describe, expect, it } from "@jest/globals";

import { MAX_COUNT_PER_EVENT, MAX_EVENTS_PER_CALL, toBatches } from "@/lib/usageBatches";

describe("toBatches", () => {
  it("sends small counts in one call", () => {
    expect(toBatches(new Map([["screen_feed", 3], ["screen_chat", 1]]))).toEqual([{ screen_feed: 3, screen_chat: 1 }]);
  });

  it("splits a count above the server limit", () => {
    const batches = toBatches(new Map([["screen_feed", 120]]));
    expect(batches).toEqual([{ screen_feed: 50 }, { screen_feed: 50 }, { screen_feed: 20 }]);
    batches.forEach((batch) => Object.values(batch).forEach((n) => expect(n).toBeLessThanOrEqual(MAX_COUNT_PER_EVENT)));
  });

  it("never puts more than 40 events into one call", () => {
    const counts = new Map(Array.from({ length: 45 }, (_, i) => [`screen_${i}`, 1] as [string, number]));
    const batches = toBatches(counts);
    expect(batches).toHaveLength(2);
    expect(Object.keys(batches[0])).toHaveLength(MAX_EVENTS_PER_CALL);
    expect(Object.keys(batches[1])).toHaveLength(5);
  });

  it("drops zero, negative and fractional parts", () => {
    expect(toBatches(new Map([["a", 0], ["b", -2], ["c", 2.7]]))).toEqual([{ c: 2 }]);
  });

  it("returns nothing for nothing", () => {
    expect(toBatches(new Map())).toEqual([]);
  });
});
