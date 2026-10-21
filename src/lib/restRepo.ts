import { requireUserId } from "@/lib/session";
import type { DayKey, RestBudget } from "@/lib/streak";
import { supabase } from "@/lib/supabase";

export type MyRestDays = {
  /** null: never set up (the feature stays hidden). */
  budget: RestBudget | null;
  uses: DayKey[];
};

/** My rest day budget and the rest days I used (only I can read them). */
export async function fetchMyRestDays(): Promise<MyRestDays> {
  const userId = await requireUserId();
  const [budget, uses] = await Promise.all([
    supabase.from("rest_budgets").select("rests_per_cycle, cycle_start").eq("user_id", userId).maybeSingle(),
    supabase.from("rest_day_uses").select("day").eq("user_id", userId).order("day"),
  ]);
  if (budget.error) throw budget.error;
  if (uses.error) throw uses.error;
  return {
    budget:
      budget.data !== null ? { restsPerWeek: budget.data.rests_per_cycle, cycleStart: budget.data.cycle_start } : null,
    uses: uses.data.map((row) => row.day),
  };
}

type RpcError = { message?: string; hint?: string | null };

/** User-facing text for the errors of the rest day functions. */
function restErrorMessage(error: RpcError): string {
  switch (error.message) {
    case "rest_budget_locked": {
      const until = typeof error.hint === "string" ? error.hint.split("-").reverse().join(".") : null;
      return until !== null
        ? `Die Anzahl lässt sich erst ab ${until} wieder ändern.`
        : "Die Anzahl lässt sich erst 3 Wochen nach der letzten Änderung wieder ändern.";
    }
    case "rest_day_no_budget":
      return "Diese Woche sind keine Ruhetage mehr übrig.";
    case "rest_day_is_training_day":
      return "An diesem Tag hast du schon trainiert.";
    case "rest_day_not_allowed":
      return "Ruhetage gehen nur für heute oder gestern.";
    default:
      return error.message ?? "Etwas ist schiefgelaufen.";
  }
}

async function call(result: PromiseLike<{ error: RpcError | null }>): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(restErrorMessage(error));
}

/** "n rest days per week"; the database refuses a new number within 21 days of the last one. */
export function setRestBudget(n: number): Promise<void> {
  return call(supabase.rpc("set_rest_budget", { n }));
}

export function applyRestDay(day: DayKey): Promise<void> {
  return call(supabase.rpc("use_rest_day", { d: day }));
}

export function undoRestDay(day: DayKey): Promise<void> {
  return call(supabase.rpc("undo_rest_day", { d: day }));
}
