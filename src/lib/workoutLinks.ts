import { addDays, type DayKey } from "@/lib/streak";

/** Most people that can be tagged in one post or story (the database enforces the same). */
export const MAX_TAGS = 10;

/**
 * A workout link can be accepted until the end of the day after the workout (Europe/Zurich,
 * like all day keys); afterwards the request has expired. The database checks the same.
 */
export function isWorkoutLinkExpired(workoutDay: DayKey, today: DayKey): boolean {
  return today > addDays(workoutDay, 1);
}
