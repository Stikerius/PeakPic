import { describe, expect, it } from "@jest/globals";

import { combineTrainingDays, computeStreakStatsFromDays } from "@/lib/streak";
import {
  activeMs,
  completeSet,
  exerciseDurationMs,
  exercisesFromPlan,
  finishDraft,
  formatDuration,
  isStale,
  isWorkoutDraft,
  newDraft,
  newExercise,
  pauseDraft,
  reopenDraft,
  restRemaining,
  resumeDraft,
  streakVerdict,
  summarize,
  toWorkoutPayload,
  totalMs,
  volumeKg,
  workoutDay,
  type DraftExercise,
  type WorkoutDraft,
} from "@/lib/workout";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 16, 0, 0); // 18:00 in Zurich

let counter = 0;
const key = () => `k${(counter += 1)}`;

function draft(exercises: DraftExercise[] = []): WorkoutDraft {
  return newDraft({ clientId: "c1", now: T0, planId: null, planDayId: null, planDayTitle: null, exercises });
}

function exercise(sets: { reps: string; weight?: string; seconds?: string; done?: boolean; at?: number }[], timed = false): DraftExercise {
  const e = newExercise(key(), "Bankdrücken", key);
  return {
    ...e,
    timed,
    sets: sets.map((s) => ({
      key: key(),
      reps: s.reps,
      weight: s.weight ?? "",
      seconds: s.seconds ?? "",
      done: s.done ?? true,
      completedAt: s.at ?? null,
      restSeconds: null,
    })),
  };
}

describe("time from timestamps", () => {
  it("leaves pauses out of the active time", () => {
    let d = draft();
    d = pauseDraft(d, T0 + 10 * MIN);
    d = resumeDraft(d, T0 + 15 * MIN);
    expect(activeMs(d, T0 + 30 * MIN)).toBe(25 * MIN);
    expect(totalMs(d, T0 + 30 * MIN)).toBe(30 * MIN);
  });

  it("counts an open pause until now and stops the clock while paused", () => {
    const d = pauseDraft(draft(), T0 + 10 * MIN);
    expect(activeMs(d, T0 + 20 * MIN)).toBe(10 * MIN);
    expect(activeMs(d, T0 + 60 * MIN)).toBe(10 * MIN);
  });

  it("stays right when the app was in the background (no ticks needed)", () => {
    // Nothing happened between start and two hours later: the time comes from the timestamps.
    expect(activeMs(draft(), T0 + 120 * MIN)).toBe(120 * MIN);
  });

  it("is not changed by the switch to winter time", () => {
    // 25 Oct 2026, 02:30 summer time to 02:30 winter time is two real hours.
    const start = Date.UTC(2026, 9, 25, 0, 30);
    const d = newDraft({ clientId: "c", now: start, planId: null, planDayId: null, planDayTitle: null, exercises: [] });
    expect(activeMs(d, start + 120 * MIN)).toBe(120 * MIN);
    expect(workoutDay(start)).toBe("2026-10-25");
  });

  it("ends a paused training at the start of the pause and can be reopened", () => {
    let d = pauseDraft(draft(), T0 + 20 * MIN);
    d = finishDraft(d, T0 + 50 * MIN);
    expect(d.endedAt).toBe(T0 + 20 * MIN);
    expect(activeMs(d, T0 + 90 * MIN)).toBe(20 * MIN);
    d = reopenDraft(d, T0 + 25 * MIN);
    expect(activeMs(d, T0 + 30 * MIN)).toBe(25 * MIN);
  });

  it("formats durations and the rest timer", () => {
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_665_000)).toBe("1:01:05");
    expect(restRemaining({ startedAt: T0, seconds: 90 }, T0 + 30_000)).toBe(60);
    expect(restRemaining({ startedAt: T0, seconds: 90 }, T0 + 100_000)).toBe(0);
    expect(restRemaining(null, T0)).toBe(0);
  });

  it("knows stale drafts", () => {
    expect(isStale(draft(), T0 + 11 * 60 * MIN)).toBe(false);
    expect(isStale(draft(), T0 + 13 * 60 * MIN)).toBe(true);
  });
});

describe("sets and volume", () => {
  it("sums weight × reps of done sets", () => {
    const e = exercise([
      { reps: "10", weight: "60" },
      { reps: "8", weight: "62,5" },
      { reps: "8", weight: "62,5", done: false },
    ]);
    expect(volumeKg([e])).toBe(1100);
  });

  it("has no volume without weights", () => {
    expect(volumeKg([exercise([{ reps: "20" }, { reps: "15" }])])).toBeNull();
  });

  it("ignores empty and invalid sets", () => {
    const e = exercise([{ reps: "" }, { reps: "abc" }, { reps: "12" }]);
    const s = summarize(draft([e]), T0 + 30 * MIN);
    expect(s.sets).toBe(1);
    expect(s.exercises).toBe(1);
    expect(summarize(draft([exercise([{ reps: "" }])]), T0).exercises).toBe(0);
  });

  it("measures an exercise from its first to its last set", () => {
    const e = exercise([
      { reps: "10", at: T0 + MIN },
      { reps: "10", at: T0 + 4 * MIN },
      { reps: "10", at: T0 + 7 * MIN },
    ]);
    expect(exerciseDurationMs(e)).toBe(6 * MIN);
    expect(exerciseDurationMs(exercise([{ reps: "10", at: T0 }]))).toBe(0);
  });

  it("records time exercises", () => {
    const plank = exercise([{ reps: "", seconds: "1:00" }], true);
    expect(summarize(draft([plank]), T0).sets).toBe(1);
  });

  it("marks a set done with the rest taken before it", () => {
    let d = draft([exercise([{ reps: "10", done: false }])]);
    d = { ...d, rest: { startedAt: T0 + MIN, seconds: 90 } };
    const ex = d.exercises[0];
    const set = ex?.sets[0];
    if (ex === undefined || set === undefined) throw new Error("setup");
    d = completeSet(d, ex.key, set.key, T0 + MIN + 75_000);
    expect(d.exercises[0]?.sets[0]).toMatchObject({ done: true, completedAt: T0 + MIN + 75_000, restSeconds: 75 });
    expect(d.rest).toBeNull();
  });

  it("builds exercises from a plan day with prefilled sets", () => {
    const [bench, plank] = exercisesFromPlan(
      [
        { id: "p1", name: "Bankdrücken", sets: 3, repsMin: 8, repsMax: 12, targetSeconds: null, targetWeightKg: 60 },
        { id: "p2", name: "Plank", sets: 2, repsMin: null, repsMax: null, targetSeconds: 60, targetWeightKg: null },
      ],
      key,
    );
    expect(bench?.sets).toHaveLength(3);
    expect(bench?.sets[0]).toMatchObject({ reps: "12", weight: "60", done: false });
    expect(plank?.timed).toBe(true);
  });
});

describe("payload", () => {
  it("only sends done, valid sets and named exercises", () => {
    const named = exercise([{ reps: "10", weight: "50", at: T0 + MIN }, { reps: "10", done: false }]);
    const unnamed = { ...exercise([{ reps: "10" }]), name: " " };
    const d = finishDraft(draft([named, unnamed]), T0 + 40 * MIN);
    const payload = toWorkoutPayload(d, T0 + 41 * MIN, { title: " ", note: "", visibility: "private", shareWithPost: false });
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises[0]?.sets).toEqual([
      { reps: 10, weight_kg: 50, seconds: null, rest_seconds: null, completed_at: new Date(T0 + MIN).toISOString() },
    ]);
    expect(payload.active_seconds).toBe(40 * 60);
    expect(payload.title).toBeNull();
  });

  it("checks stored drafts", () => {
    expect(isWorkoutDraft(draft())).toBe(true);
    expect(isWorkoutDraft({ version: 2 })).toBe(false);
    expect(isWorkoutDraft(null)).toBe(false);
  });
});

describe("streak rules", () => {
  const base = { workoutDay: "2026-10-22", today: "2026-10-22", countingThatDay: 0 };

  it("counts a plausible training without a photo", () => {
    expect(streakVerdict({ ...base, activeSeconds: 1800, sets: 9 })).toEqual({ counts: true, reason: null });
  });

  it("doesn't count a training under 10 minutes or with fewer than 3 sets", () => {
    expect(streakVerdict({ ...base, activeSeconds: 599, sets: 9 }).reason).toBe("too_short");
    expect(streakVerdict({ ...base, activeSeconds: 1800, sets: 2 }).reason).toBe("too_few_sets");
  });

  it("allows yesterday but not earlier, and at most 2 counting trainings per day", () => {
    expect(streakVerdict({ ...base, workoutDay: "2026-10-21", activeSeconds: 1800, sets: 9 }).counts).toBe(true);
    expect(streakVerdict({ ...base, workoutDay: "2026-10-20", activeSeconds: 1800, sets: 9 }).reason).toBe("too_old");
    expect(streakVerdict({ ...base, countingThatDay: 2, activeSeconds: 1800, sets: 9 }).reason).toBe("daily_limit");
  });

  it("counts a day once, whatever proofs it has", () => {
    // Two trainings, a post and its slideshow photos on the 22nd, one training on the 21st.
    const days = combineTrainingDays(["2026-10-22", "2026-10-22", "2026-10-22", "2026-10-21"], ["2026-10-22"]);
    const stats = computeStreakStatsFromDays(days, "2026-10-22");
    expect(stats.current).toBe(2);
    expect(stats.trainingDays.size).toBe(2);
  });
});
