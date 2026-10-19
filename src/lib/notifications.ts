/**
 * Turns raw activity (stories, workouts, likes, …) into grouped notifications like
 * "lena, marco und 2 weitere waren heute im Gym". Pure functions, unit tested.
 */
import { addDays, toDayKey, type DayKey } from "@/lib/streak";

export type ActivityEvent =
  | { kind: "story"; actorId: string; at: string }
  | { kind: "workout"; actorId: string; at: string; day: DayKey; postId: string }
  | { kind: "post_like"; actorId: string; at: string; postId: string }
  | { kind: "comment"; actorId: string; at: string; postId: string; text: string }
  | { kind: "follow"; actorId: string; at: string }
  | { kind: "story_like"; actorId: string; at: string; storyId: string }
  | { kind: "mention"; actorId: string; at: string; storyId: string };

export type NotificationKind = ActivityEvent["kind"];

export type NotificationTarget =
  | { type: "stories"; userId: string }
  | { type: "own_story" }
  | { type: "post"; postId: string }
  | { type: "profile"; userId: string }
  | { type: "feed" };

export type NotificationGroup = {
  key: string;
  kind: NotificationKind;
  /** Unique actors, most recent first. */
  actorIds: string[];
  latestAt: string;
  /** Day of the workouts, for "workout" groups. */
  day?: DayKey;
  /** Latest comment text, for "comment" groups. */
  preview?: string;
  target: NotificationTarget;
};

/** Events in one group share this key. */
function groupKey(event: ActivityEvent): string {
  switch (event.kind) {
    case "story":
      return "story";
    case "workout":
      return `workout:${event.day}`;
    case "post_like":
      return `post_like:${event.postId}`;
    case "comment":
      return `comment:${event.postId}`;
    case "follow":
      return `follow:${toDayKey(new Date(event.at))}`;
    case "story_like":
      return `story_like:${event.storyId}`;
    case "mention":
      return `mention:${event.storyId}`;
  }
}

function targetFor(event: ActivityEvent, actorCount: number): NotificationTarget {
  switch (event.kind) {
    case "story":
    case "mention":
      return { type: "stories", userId: event.actorId };
    case "workout":
      return actorCount === 1 ? { type: "profile", userId: event.actorId } : { type: "feed" };
    case "post_like":
    case "comment":
      return { type: "post", postId: event.postId };
    case "follow":
      return { type: "profile", userId: event.actorId };
    case "story_like":
      return { type: "own_story" };
  }
}

export function groupNotifications(events: readonly ActivityEvent[]): NotificationGroup[] {
  const newestFirst = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const groups = new Map<string, { first: ActivityEvent; actorIds: string[] }>();
  for (const event of newestFirst) {
    const key = groupKey(event);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { first: event, actorIds: [event.actorId] });
    else if (!group.actorIds.includes(event.actorId)) group.actorIds.push(event.actorId);
  }
  return [...groups.entries()].map(([key, { first, actorIds }]) => ({
    key,
    kind: first.kind,
    actorIds,
    latestAt: first.at,
    ...(first.kind === "workout" ? { day: first.day } : {}),
    ...(first.kind === "comment" ? { preview: first.text } : {}),
    target: targetFor(first, actorIds.length),
  }));
}

/** "a", "a und b", "a, b und c", "a, b und 3 weitere". */
export function joinNames(names: readonly string[]): string {
  const [first, second, third] = names;
  if (first === undefined) return "";
  if (second === undefined) return first;
  if (names.length === 2) return `${first} und ${second}`;
  if (names.length === 3) return `${first}, ${second} und ${third ?? ""}`;
  return `${first}, ${second} und ${names.length - 2} weitere`;
}

function dayPhrase(day: DayKey, today: DayKey): string {
  if (day === today) return "heute";
  if (day === addDays(today, -1)) return "gestern";
  const [, month, date] = day.split("-");
  return `am ${Number(date)}.${Number(month)}.`;
}

/** The sentence after the names, e.g. "waren heute im Gym 💪". */
export function notificationText(group: NotificationGroup, today: DayKey): string {
  const plural = group.actorIds.length > 1;
  switch (group.kind) {
    case "story":
      return plural ? "haben eine Story gepostet" : "hat eine Story gepostet";
    case "workout":
      return `${plural ? "waren" : "war"} ${dayPhrase(group.day ?? today, today)} im Gym 💪`;
    case "post_like":
      return "gefällt dein Workout";
    case "comment":
      return plural
        ? "haben dein Workout kommentiert"
        : `hat kommentiert: „${group.preview ?? ""}“`;
    case "follow":
      return plural ? "folgen dir jetzt" : "folgt dir jetzt";
    case "story_like":
      return "gefällt deine Story";
    case "mention":
      return "hat dich in einer Story markiert";
  }
}
