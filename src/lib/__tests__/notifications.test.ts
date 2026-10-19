import { describe, expect, it } from "@jest/globals";

import {
  groupNotifications,
  joinNames,
  notificationText,
  type ActivityEvent,
} from "@/lib/notifications";

const today = "2026-10-19";

describe("joinNames", () => {
  it("joins one to many names in German", () => {
    expect(joinNames(["lena"])).toBe("lena");
    expect(joinNames(["lena", "marco"])).toBe("lena und marco");
    expect(joinNames(["lena", "marco", "sara"])).toBe("lena, marco und sara");
    expect(joinNames(["lena", "marco", "sara", "mia", "jonas"])).toBe("lena, marco und 3 weitere");
  });
});

describe("groupNotifications", () => {
  it("merges friends' stories into one notification, newest actor first", () => {
    const events: ActivityEvent[] = [
      { kind: "story", actorId: "lena", at: "2026-10-19T08:00:00Z" },
      { kind: "story", actorId: "marco", at: "2026-10-19T10:00:00Z" },
      { kind: "story", actorId: "lena", at: "2026-10-19T09:00:00Z" },
    ];
    const groups = groupNotifications(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.actorIds).toEqual(["marco", "lena"]);
    expect(groups[0]?.latestAt).toBe("2026-10-19T10:00:00Z");
    expect(groups[0]?.target).toEqual({ type: "stories", userId: "marco" });
  });

  it("groups workouts per day and links to the feed when several people trained", () => {
    const events: ActivityEvent[] = [
      { kind: "workout", actorId: "lena", at: "2026-10-19T16:00:00Z", day: "2026-10-19", postId: "p1" },
      { kind: "workout", actorId: "marco", at: "2026-10-19T17:00:00Z", day: "2026-10-19", postId: "p2" },
      { kind: "workout", actorId: "lena", at: "2026-10-18T16:00:00Z", day: "2026-10-18", postId: "p3" },
    ];
    const groups = groupNotifications(events);
    expect(groups.map((g) => g.key)).toEqual(["workout:2026-10-19", "workout:2026-10-18"]);
    expect(groups[0]?.target).toEqual({ type: "feed" });
    expect(groups[1]?.target).toEqual({ type: "profile", userId: "lena" });
  });

  it("keeps likes on different posts apart", () => {
    const events: ActivityEvent[] = [
      { kind: "post_like", actorId: "lena", at: "2026-10-19T10:00:00Z", postId: "a" },
      { kind: "post_like", actorId: "marco", at: "2026-10-19T11:00:00Z", postId: "a" },
      { kind: "post_like", actorId: "lena", at: "2026-10-19T12:00:00Z", postId: "b" },
    ];
    const groups = groupNotifications(events);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key === "post_like:a")?.actorIds).toEqual(["marco", "lena"]);
  });

  it("keeps the newest comment as preview", () => {
    const groups = groupNotifications([
      { kind: "comment", actorId: "lena", at: "2026-10-19T10:00:00Z", postId: "a", text: "alt" },
      { kind: "comment", actorId: "lena", at: "2026-10-19T11:00:00Z", postId: "a", text: "neu" },
    ]);
    expect(groups[0]?.preview).toBe("neu");
    expect(groups[0]?.actorIds).toEqual(["lena"]);
  });
});

describe("notificationText", () => {
  it("uses singular and plural verbs", () => {
    const [single] = groupNotifications([{ kind: "story", actorId: "lena", at: "2026-10-19T08:00:00Z" }]);
    const [several] = groupNotifications([
      { kind: "follow", actorId: "lena", at: "2026-10-19T08:00:00Z" },
      { kind: "follow", actorId: "marco", at: "2026-10-19T09:00:00Z" },
    ]);
    expect(single && notificationText(single, today)).toBe("hat eine Story gepostet");
    expect(several && notificationText(several, today)).toBe("folgen dir jetzt");
  });

  it("says today, yesterday or the date for workouts", () => {
    const workout = (day: string): ActivityEvent => ({
      kind: "workout",
      actorId: "lena",
      at: `${day}T16:00:00Z`,
      day,
      postId: day,
    });
    const texts = groupNotifications([workout("2026-10-19"), workout("2026-10-18"), workout("2026-10-14")]).map(
      (g) => notificationText(g, today),
    );
    expect(texts).toEqual(["war heute im Gym 💪", "war gestern im Gym 💪", "war am 14.10. im Gym 💪"]);
  });
});
