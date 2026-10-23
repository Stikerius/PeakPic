import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  addDays,
  currentPlanStreak,
  currentStreak,
  longestStreak,
  planRound,
  plannedRestDue,
  type DayKey,
  type PlanEntry,
  type PlanProof,
} from "@/lib/streak";

// The figures promised for supabase/seed-testaccount.sql, checked with the app's own streak and
// plan rules. The schedule is read from the script itself, so both can't drift apart.
const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "seed-testaccount.sql"), "utf8");

function match(pattern: RegExp): string {
  const found = pattern.exec(sql);
  if (found?.[1] === undefined) throw new Error(`not found in seed-testaccount.sql: ${pattern}`);
  return found[1];
}

const tokens = match(/v_schedule\s+text := '([^']*)'/).trim().split(/\s+/);
const planDay = Number(match(/v_plan_day\s+integer := (\d+)/));
const changeDay = Number(match(/v_change_day\s+integer := (\d+)/));
const deviationDays = match(/v_dev_days\s+integer\[\] := array\[([^\]]*)\]/).split(",").map(Number);
const deviationExpected = match(/v_dev_expect\s+text\[\] := array\[([^\]]*)\]/)
  .split(",")
  .map((s) => s.trim().replace(/'/g, ""));

const TODAY: DayKey = "2026-10-23";
/** Day number 1 = 60 days ago, 60 = yesterday. */
const dayKey = (n: number): DayKey => addDays(TODAY, n - 61);

type Day = { n: number; day: DayKey; token: string };
const days: Day[] = tokens.map((token, i) => ({ n: i + 1, day: dayKey(i + 1), token }));
const isTraining = (t: string) => /^[GCPLB][wxf]$/.test(t);
const isRest = (t: string) => t === "Ra" || t === "Rb";

const trainingDays = new Set(days.filter((d) => isTraining(d.token)).map((d) => d.day));
const restDays = new Set(days.filter((d) => isRest(d.token)).map((d) => d.day));

const ENTRIES_BEFORE: PlanEntry[] = [
  { id: "P", type: "training" },
  { id: "L", type: "training" },
  { id: "B", type: "training" },
  { id: "Ra", type: "rest" },
];
// The change on day 45 adds a rest day (Rb) between Pull and Beine.
const ENTRIES_AFTER: PlanEntry[] = [
  { id: "P", type: "training" },
  { id: "L", type: "training" },
  { id: "Rb", type: "rest" },
  { id: "B", type: "training" },
  { id: "Ra", type: "rest" },
];

/** Plan proofs from day `from` (inclusive) up to day `to` (exclusive), like plan_progress(). */
function proofs(from: number, to: number): PlanProof[] {
  return days
    .filter((d) => d.n >= from && d.n < to && (isTraining(d.token) || isRest(d.token)))
    .map((d) => {
      if (isRest(d.token)) return { day: d.day, createdAt: `${d.day}T18:00:00Z`, planDayId: d.token, kind: "rest" as const };
      const unit = d.token[0] ?? "";
      return { day: d.day, createdAt: `${d.day}T16:00:00Z`, planDayId: "PLB".includes(unit) ? unit : null };
    });
}

describe("seed-testaccount.sql schedule", () => {
  it("covers 60 days with 35 training days", () => {
    expect(tokens).toHaveLength(60);
    expect(trainingDays.size).toBe(35);
    expect(restDays.size).toBe(8);
    expect(tokens.every((t) => t === "-" || isRest(t) || isTraining(t) || t === "Mw")).toBe(true);
  });

  it("has no plan units before the plan exists and no rest days on training days", () => {
    expect(days.filter((d) => d.n < planDay && /^[PLBR]/.test(d.token))).toEqual([]);
    expect(days.filter((d) => d.n < changeDay && d.token === "Rb")).toEqual([]);
    expect([...restDays].filter((d) => trainingDays.has(d))).toEqual([]);
  });

  it("gives different current and longest streaks", () => {
    expect(longestStreak(trainingDays, restDays)).toBe(9);
    expect(currentStreak(trainingDays, TODAY, restDays)).toBe(5);
    // The 3 own photos uploaded today make today a training day as well.
    expect(currentStreak(new Set([...trainingDays, TODAY]), TODAY, restDays)).toBe(6);
  });

  it("has several runs between 3 and 9 training days", () => {
    const runs: number[] = [];
    let run = 0;
    for (const d of days) {
      if (isTraining(d.token)) run += 1;
      else if (!isRest(d.token) && run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    if (run > 0) runs.push(run);
    expect(runs).toEqual([3, 3, 4, 9, 5, 6, 5]);
  });

  it("ends with a plan streak of 4 and a planned rest day due today", () => {
    const sinceChange = proofs(changeDay, 61);
    const input = {
      planDayIds: ENTRIES_AFTER.map((e) => e.id),
      proofs: sinceChange,
      trainingDays,
      restDays,
      today: TODAY,
      restIds: new Set(["Ra", "Rb"]),
    };
    expect(currentPlanStreak(input)).toBe(4);
    // A photo without a plan unit today breaks the plan streak.
    expect(
      currentPlanStreak({
        ...input,
        proofs: [...sinceChange, { day: TODAY, createdAt: `${TODAY}T08:00:00Z`, planDayId: null }],
        trainingDays: new Set([...trainingDays, TODAY]),
      }),
    ).toBe(0);
    const round = planRound(ENTRIES_AFTER, sinceChange);
    expect(ENTRIES_AFTER[round.nextIndex]?.id).toBe("Ra");
    expect(round.lastDay).toBe(dayKey(60));
    expect(plannedRestDue({ entries: ENTRIES_AFTER, proofs: sinceChange, today: TODAY, trainingDays, restDays })?.day).toBe(TODAY);
  });

  it("marks exactly the days where another unit than the due one was trained as deviations", () => {
    const offPlan: { n: number; expected: string }[] = [];
    for (const d of days) {
      if (d.n < planDay || !/^[PLB]/.test(d.token)) continue;
      const after = d.n >= changeDay;
      const entries = after ? ENTRIES_AFTER : ENTRIES_BEFORE;
      const round = planRound(entries, proofs(after ? changeDay : planDay, d.n));
      const unit = d.token[0];
      const open = entries.filter((e) => !round.done.has(e.id));
      const firstTraining = open.find((e) => e.type === "training");
      if (firstTraining !== undefined && firstTraining.id !== unit) {
        offPlan.push({ n: d.n, expected: firstTraining.id });
      }
    }
    expect(offPlan).toEqual(deviationDays.map((n, i) => ({ n, expected: deviationExpected[i] })));
  });
});
