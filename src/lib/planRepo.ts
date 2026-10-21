import { requireUserId } from "@/lib/session";
import type { PlanProof } from "@/lib/streak";
import { supabase } from "@/lib/supabase";

/** Same limits as the database (training_plans, plan_days, save_training_plan). */
export const PLAN_NAME_MAX_LENGTH = 40;
export const PLAN_DAY_TITLE_MAX_LENGTH = 30;
export const PLAN_DAY_NOTES_MAX_LENGTH = 300;
export const PLAN_MAX_DAYS = 21;

export type PlanDay = {
  id: string;
  /** 0-based place in the cycle. */
  position: number;
  title: string;
  notes: string | null;
};

export type TrainingPlan = {
  id: string;
  userId: string;
  name: string;
  showInProfile: boolean;
  /** When units were last added, removed or reordered (the plan streak restarts there). */
  sequenceChangedAt: string;
  updatedAt: string;
  /** In cycle order. */
  days: PlanDay[];
};

/** A unit while editing: `id` is null for new units. */
export type PlanDayDraft = { id: string | null; title: string; notes: string };

const PLAN_SELECT =
  "id, user_id, name, show_in_profile, sequence_changed_at, updated_at, days:plan_days(id, position, title, notes)";

/**
 * The plan of `userId`, or null if there is none or the caller may not see it
 * (the database decides: owner, or the audience of their posts while the plan is shown).
 */
export async function fetchPlan(userId: string): Promise<TrainingPlan | null> {
  const { data, error } = await supabase.from("training_plans").select(PLAN_SELECT).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    showInProfile: data.show_in_profile,
    sequenceChangedAt: data.sequence_changed_at,
    updatedAt: data.updated_at,
    days: [...data.days].sort((a, b) => a.position - b.position),
  };
}

export async function fetchMyPlan(): Promise<TrainingPlan | null> {
  return fetchPlan(await requireUserId());
}

/** Error text for a draft, or null if it can be saved. */
export function planDraftError(name: string, days: PlanDayDraft[]): string | null {
  if (name.trim().length === 0) return "Gib dem Plan einen Namen.";
  if (days.length === 0) return "Ein Plan braucht mindestens eine Einheit.";
  if (days.length > PLAN_MAX_DAYS) return `Höchstens ${PLAN_MAX_DAYS} Einheiten.`;
  const unnamed = days.findIndex((d) => d.title.trim().length === 0);
  if (unnamed !== -1) return `Einheit ${unnamed + 1} braucht einen Namen.`;
  return null;
}

/** Creates or replaces my plan; existing units keep their id. */
export async function saveMyPlan(name: string, showInProfile: boolean, days: PlanDayDraft[]): Promise<TrainingPlan> {
  const { error } = await supabase.rpc("save_training_plan", {
    p_name: name.trim(),
    p_show_in_profile: showInProfile,
    p_days: days.map((d) => ({ id: d.id, title: d.title.trim(), notes: d.notes.trim() })),
  });
  if (error) throw error;
  const plan = await fetchMyPlan();
  if (plan === null) throw new Error("Plan wurde nicht gespeichert.");
  return plan;
}

/** My training proofs since my plan's order last changed (empty without a plan). */
export async function fetchPlanProofs(): Promise<PlanProof[]> {
  const { data, error } = await supabase.rpc("plan_proofs", {});
  if (error) throw error;
  return data.map((row) => ({ day: row.day, createdAt: row.created_at, planDayId: row.plan_day_id }));
}

/**
 * Assigns a unit to a post that has none yet (e.g. today's slideshow when more photos are
 * added). The database checks that it is my unit and the day is today or yesterday.
 */
export async function assignPlanDayIfEmpty(postId: string, planDayId: string): Promise<void> {
  const { error } = await supabase.from("posts").update({ plan_day_id: planDayId }).eq("id", postId).is("plan_day_id", null);
  if (error) throw error;
}

/** "Pull · Einheit 2 von 6" from the label columns copied onto a post. */
export function formatPlanLabel(title: string | null, position: number | null, length: number | null): string | null {
  if (title === null) return null;
  return position !== null && length !== null ? `${title} · Einheit ${position + 1} von ${length}` : title;
}

export async function deleteMyPlan(): Promise<void> {
  const { error } = await supabase.rpc("delete_training_plan", {});
  if (error) throw error;
}
