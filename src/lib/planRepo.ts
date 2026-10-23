import { originLabel, toDayPayloads, type DayDraft } from "@/lib/planDraft";
import { requireUserId } from "@/lib/session";
import type { DayKey, PlanEntry, PlanProof } from "@/lib/streak";
import { supabase } from "@/lib/supabase";
import type { PlanDayType, PlanVisibility } from "@/types/database";

export {
  PLAN_DAY_NOTES_MAX_LENGTH,
  PLAN_DAY_TITLE_MAX_LENGTH,
  PLAN_MAX_DAYS,
  PLAN_MAX_PLANS,
  PLAN_NAME_MAX_LENGTH,
  planDraftError,
} from "@/lib/planDraft";

export type PlanExercise = {
  id: string;
  position: number;
  name: string;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  targetSeconds: number | null;
  targetWeightKg: number | null;
  notes: string | null;
};

export type PlanDay = {
  id: string;
  /** 0-based place in the cycle. */
  position: number;
  type: PlanDayType;
  title: string;
  notes: string | null;
  /** Empty for rest days. */
  exercises: PlanExercise[];
};

export type TrainingPlan = {
  id: string;
  userId: string;
  name: string;
  visibility: PlanVisibility;
  allowAdopt: boolean;
  isActive: boolean;
  adoptedFromPlanId: string | null;
  adoptedFromUserId: string | null;
  /** "Übernommen von @username", "Gelöschtes Konto" … for adopted copies, otherwise null. */
  origin: string | null;
  /** Removed by the moderation: only the owner still sees it. */
  removed: boolean;
  /** When the plan was last started at day 1 (activation); reordering doesn't change it. */
  sequenceChangedAt: string;
  /** Deactivated by me ("Plan deaktivieren"): can be resumed where I stopped. */
  deactivatedAt: string | null;
  updatedAt: string;
  /** In cycle order. */
  days: PlanDay[];
};

export const VISIBILITY_LABELS: Record<PlanVisibility, string> = {
  private: "Nur ich",
  followers: "Follower",
  public: "Alle",
};

const PLAN_SELECT =
  "id, user_id, name, visibility, allow_adopt, is_active, adopted_from_plan_id, adopted_from_user_id, adopted_at, moderation_state, sequence_changed_at, deactivated_at, updated_at, " +
  "origin:profiles!training_plans_adopted_from_user_id_fkey(username), " +
  "days:plan_days(id, position, day_type, title, notes, exercises:plan_exercises(id, position, name, sets, reps_min, reps_max, target_seconds, target_weight_kg, notes))";

type ExerciseRow = {
  id: string;
  position: number;
  name: string;
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  target_seconds: number | null;
  target_weight_kg: number | string | null;
  notes: string | null;
};

type PlanRow = {
  id: string;
  user_id: string;
  name: string;
  visibility: PlanVisibility;
  allow_adopt: boolean;
  is_active: boolean;
  adopted_from_plan_id: string | null;
  adopted_from_user_id: string | null;
  adopted_at: string | null;
  moderation_state: string | null;
  /** Hidden by RLS when that account isn't visible to me. */
  origin: { username: string } | null;
  sequence_changed_at: string;
  deactivated_at: string | null;
  updated_at: string;
  days: {
    id: string;
    position: number;
    day_type: PlanDayType;
    title: string;
    notes: string | null;
    exercises: ExerciseRow[];
  }[];
};

function toPlan(row: PlanRow): TrainingPlan {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    visibility: row.visibility,
    allowAdopt: row.allow_adopt,
    isActive: row.is_active,
    adoptedFromPlanId: row.adopted_from_plan_id,
    adoptedFromUserId: row.adopted_from_user_id,
    origin: originLabel(row.adopted_at, row.adopted_from_user_id, row.origin?.username ?? null),
    removed: row.moderation_state !== null,
    sequenceChangedAt: row.sequence_changed_at,
    deactivatedAt: row.deactivated_at,
    updatedAt: row.updated_at,
    days: [...row.days]
      .sort((a, b) => a.position - b.position)
      .map((d) => ({
        id: d.id,
        position: d.position,
        type: d.day_type,
        title: d.title,
        notes: d.notes,
        exercises: [...d.exercises]
          .sort((a, b) => a.position - b.position)
          .map((e) => ({
            id: e.id,
            position: e.position,
            name: e.name,
            sets: e.sets,
            repsMin: e.reps_min,
            repsMax: e.reps_max,
            targetSeconds: e.target_seconds,
            // numeric arrives as a string from PostgREST.
            targetWeightKg: e.target_weight_kg === null ? null : Number(e.target_weight_kg),
            notes: e.notes,
          })),
      })),
  };
}

async function selectPlans(build: (query: ReturnType<typeof basePlanQuery>) => ReturnType<typeof basePlanQuery>) {
  const { data, error } = await build(basePlanQuery());
  if (error) throw error;
  return (data as unknown as PlanRow[]).map(toPlan);
}

function basePlanQuery() {
  return supabase.from("training_plans").select(PLAN_SELECT);
}

/** All plans of `userId` the caller may see (the database decides; the owner sees all). Active first. */
export async function fetchPlansOf(userId: string): Promise<TrainingPlan[]> {
  const plans = await selectPlans((q) => q.eq("user_id", userId).order("updated_at", { ascending: false }));
  return [...plans].sort((a, b) => Number(b.isActive) - Number(a.isActive));
}

export async function fetchMyPlans(): Promise<TrainingPlan[]> {
  return fetchPlansOf(await requireUserId());
}

/** The active plan of `userId` if the caller may see it, otherwise null. */
export async function fetchPlan(userId: string): Promise<TrainingPlan | null> {
  const plans = await selectPlans((q) => q.eq("user_id", userId).eq("is_active", true));
  return plans[0] ?? null;
}

/** My active plan (Home, camera, plan streak), or null. */
export async function fetchMyPlan(): Promise<TrainingPlan | null> {
  return fetchPlan(await requireUserId());
}

export async function fetchPlanById(planId: string): Promise<TrainingPlan | null> {
  const plans = await selectPlans((q) => q.eq("id", planId));
  return plans[0] ?? null;
}

/** The plan's days as cycle entries (training or rest). */
export function planEntries(plan: TrainingPlan): PlanEntry[] {
  return plan.days.map((d) => ({ id: d.id, type: d.type }));
}

type RpcError = { message?: string; hint?: string | null };

/** User-facing text for the errors of the plan functions. */
export function planErrorMessage(error: RpcError): string {
  switch (error.message) {
    case "plan_limit":
      return "Du kannst höchstens 10 Pläne haben. Lösche zuerst einen.";
    case "plan_length":
      return "Ein Plan hat 1 bis 30 Tage.";
    case "plan_needs_training_day":
      return "Ein Plan braucht mindestens einen Trainingstag.";
    case "too_many_exercises":
      return "Höchstens 20 Übungen pro Tag.";
    case "plan_not_found":
      return "Plan nicht gefunden.";
    case "plan_not_adoptable":
      return "Dieser Plan kann nicht übernommen werden.";
    case "adopt_limit":
      return "Du kannst höchstens 10 Pläne pro Tag übernehmen.";
    case "account_inactive":
      return "Dein Konto ist gerade gesperrt.";
    case "planned_rest_not_due":
      return "Der Ruhetag ist erst nach dem vorherigen Trainingstag dran.";
    case "planned_rest_already_used":
      return "Für diesen Tag ist schon ein Ruhetag gesetzt.";
    case "planned_rest_no_plan":
      return "Du hast keinen aktiven Plan.";
    case "rest_day_is_training_day":
      return "An diesem Tag hast du schon trainiert.";
    case "rest_day_not_allowed":
      return "Ruhetage gehen nur für heute oder gestern.";
    default:
      return error.message ?? "Etwas ist schiefgelaufen.";
  }
}

async function call<T>(result: PromiseLike<{ data: T | null; error: RpcError | null }>): Promise<T> {
  const { data, error } = await result;
  if (error) throw new Error(planErrorMessage(error));
  if (data === null) throw new Error("Keine Antwort vom Server.");
  return data;
}

async function callVoid(result: PromiseLike<{ error: RpcError | null }>): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(planErrorMessage(error));
}

/** Creates (planId null) or updates one of my plans; existing days and exercises keep their id. */
export async function savePlan(
  planId: string | null,
  name: string,
  visibility: PlanVisibility,
  allowAdopt: boolean,
  days: readonly DayDraft[],
): Promise<string> {
  return call(
    supabase.rpc("save_plan", {
      p_plan_id: planId,
      p_name: name.trim(),
      p_visibility: visibility,
      p_allow_adopt: allowAdopt,
      p_days: toDayPayloads(days),
    }),
  );
}

/**
 * Makes the plan active. Normally the order starts again at day 1 and the plan streak runs anew;
 * `resume` continues a plan I deactivated myself where I stopped.
 */
export async function activatePlan(planId: string, resume = false): Promise<void> {
  await callVoid(supabase.rpc("activate_plan", { p_plan_id: planId, p_resume: resume }));
}

/** "Plan deaktivieren": afterwards no plan is active, the app works as without a plan. */
export async function deactivatePlan(): Promise<void> {
  await callVoid(supabase.rpc("deactivate_plan"));
}

/** New order of a plan's days (exactly its day ids). Resets nothing. */
export async function reorderPlanDays(planId: string, orderedIds: string[]): Promise<void> {
  await callVoid(supabase.rpc("reorder_plan_days", { p_plan_id: planId, p_ordered_ids: orderedIds }));
}

/** New order of a training day's exercises (exactly its exercise ids). */
export async function reorderPlanExercises(dayId: string, orderedIds: string[]): Promise<void> {
  await callVoid(supabase.rpc("reorder_plan_exercises", { p_day_id: dayId, p_ordered_ids: orderedIds }));
}

/**
 * Copies a plan I may see into my plans (without target weights and notes, private). The
 * server checks visibility, "Übernehmen erlauben" and the limits.
 */
export async function adoptPlan(planId: string, activate: boolean): Promise<string> {
  return call(supabase.rpc("adopt_plan", { p_plan_id: planId, p_activate: activate }));
}

export async function duplicatePlan(planId: string): Promise<string> {
  return call(supabase.rpc("duplicate_plan", { p_plan_id: planId }));
}

export async function deletePlan(planId: string): Promise<void> {
  await callVoid(supabase.rpc("delete_plan", { p_plan_id: planId }));
}

/** Exercise names I used before (suggestions while typing). */
export async function fetchExerciseNames(): Promise<string[]> {
  const rows = await call(supabase.rpc("my_exercise_names", {}));
  return rows.map((r) => r.name);
}

/** Confirms the planned rest day of my active plan for today or yesterday (checked by the server). */
export async function confirmPlannedRestDay(day: DayKey): Promise<void> {
  await callVoid(supabase.rpc("use_planned_rest_day", { d: day }));
}

/** My completed plan entries since my active plan's order last changed (empty without a plan). */
export async function fetchPlanProofs(): Promise<PlanProof[]> {
  const rows = await call(supabase.rpc("plan_proofs", {}));
  return rows.map((row) => ({ day: row.day, createdAt: row.created_at, planDayId: row.plan_day_id, kind: row.kind }));
}

/** Planned rest days I confirmed (for taking one back in the calendar). */
export async function fetchMyPlannedRestDays(): Promise<DayKey[]> {
  const { data, error } = await supabase.from("planned_rest_uses").select("day").order("day");
  if (error) throw error;
  return data.map((row) => row.day);
}

/**
 * Assigns a unit to a post that has none yet (e.g. today's slideshow when more photos are
 * added). The database checks that it is my training day and the day is today or yesterday.
 */
export async function assignPlanDayIfEmpty(postId: string, planDayId: string): Promise<void> {
  const { error } = await supabase.from("posts").update({ plan_day_id: planDayId }).eq("id", postId).is("plan_day_id", null);
  if (error) throw error;
}

/** "Pull · Tag 2 von 6" from the label columns copied onto a post. */
export function formatPlanLabel(title: string | null, position: number | null, length: number | null): string | null {
  if (title === null) return null;
  return position !== null && length !== null ? `${title} · Tag ${position + 1} von ${length}` : title;
}
