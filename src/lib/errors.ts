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

/** Neutral texts for codes the database answers with (e.g. around the official account). */
const KNOWN_CODES: Record<string, string> = {
  chat_not_possible: "Diesem Konto kann man nicht schreiben.",
  follow_not_possible: "Diesem Konto kann man nicht folgen.",
  block_not_possible: "Dieses Konto lässt sich nicht blockieren.",
};

/** Best-effort human readable message for anything thrown (Error, Supabase errors, strings). */
export function describeError(error: unknown): string {
  let message: string = String(error);
  if (error instanceof Error) message = error.message;
  else if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") message = error.message;
  return KNOWN_CODES[message] ?? message;
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
