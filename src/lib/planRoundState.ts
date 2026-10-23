/**
 * The stored round of the active plan (get_my_plan_round()), the pure part (unit tested): what is
 * due next, which planned rest day can be confirmed, and the proposal when another unit was
 * trained. The database keeps the round; nothing here decides on its own.
 */
import { addDays, type DayKey, type PlanEntry } from "@/lib/streak";

export type PlanDeviation = {
  id: string;
  doneDayId: string | null;
  expectedDayId: string | null;
  doneTitle: string;
  expectedTitle: string;
  createdAt: string;
};

export type PlanRoundState = {
  planId: string;
  /** Day ids of the current round in its order. */
  dayOrder: string[];
  /** Everything before this index is done; dayOrder[nextIndex] is due next. */
  nextIndex: number;
  lastDay: DayKey | null;
  pending: PlanDeviation | null;
};

export type RoundStep = { id: string; status: "done" | "next" | "open" };

/** The round as a list with done / next / open. */
export function roundSteps(state: PlanRoundState): RoundStep[] {
  return state.dayOrder.map((id, index) => ({
    id,
    status: index < state.nextIndex ? "done" : index === state.nextIndex ? "next" : "open",
  }));
}

/**
 * Indexes (in the plan's own order) of the unit due next and of the next training day of the
 * round; the first training day if the round only has rest days left.
 */
export function roundNext(state: PlanRoundState | null, entries: readonly PlanEntry[]): { nextIndex: number; nextTrainingIndex: number } {
  const indexOf = (id: string | undefined) => (id === undefined ? -1 : entries.findIndex((e) => e.id === id));
  const firstTraining = Math.max(0, entries.findIndex((e) => e.type === "training"));
  if (state === null) return { nextIndex: 0, nextTrainingIndex: firstTraining };
  const nextIndex = indexOf(state.dayOrder[state.nextIndex]);
  const open = state.dayOrder.slice(state.nextIndex);
  const training = open.map(indexOf).find((i) => i !== -1 && entries[i]?.type === "training");
  return { nextIndex: nextIndex === -1 ? 0 : nextIndex, nextTrainingIndex: training ?? firstTraining };
}

/**
 * The planned rest day that can be confirmed now (same rule as use_planned_rest_day): the unit due
 * next is a rest day, the last completed plan entry was on the day before, and that day is today
 * or yesterday, without training and not already a rest day.
 */
export function plannedRestDueFromRound(
  state: PlanRoundState | null,
  entries: readonly PlanEntry[],
  today: DayKey,
  trainingDays: ReadonlySet<DayKey>,
  restDays: ReadonlySet<DayKey>,
): { day: DayKey; entryId: string; index: number } | null {
  if (state === null || state.lastDay === null) return null;
  const id = state.dayOrder[state.nextIndex];
  const index = entries.findIndex((e) => e.id === id);
  if (id === undefined || entries[index]?.type !== "rest") return null;
  const day = addDays(state.lastDay, 1);
  if (day !== today && day !== addDays(today, -1)) return null;
  if (trainingDays.has(day) || restDays.has(day)) return null;
  return { day, entryId: id, index };
}

/**
 * "Reihenfolge anpassen": the trained unit counts as done, the other open units keep their order
 * (the proposal the person can then change). These ids go to resolve_plan_deviation.
 */
export function deviationProposal(state: PlanRoundState, doneDayId: string | null): string[] {
  return state.dayOrder.slice(state.nextIndex).filter((id) => id !== doneDayId);
}
