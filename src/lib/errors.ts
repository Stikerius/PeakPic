/** Error with the step it happened in, so the UI can tell the user what went wrong. */
export class StepError extends Error {
  constructor(
    readonly step: string,
    readonly detail: string,
  ) {
    super(`${step}: ${detail}`);
    this.name = "StepError";
  }
}

/** Best-effort human readable message for anything thrown (Error, Supabase errors, strings). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/** Runs `action`; wraps any failure in a StepError labelled with `step`. */
export async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StepError) throw error;
    throw new StepError(name, describeError(error));
  }
}
