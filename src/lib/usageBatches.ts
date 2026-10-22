/** Server limits of track_events(): at most 50 per event and call, at most 40 events per call. */
export const MAX_COUNT_PER_EVENT = 50;
export const MAX_EVENTS_PER_CALL = 40;

/** Splits counts into server-sized calls (≤ 40 events, each count ≤ 50). Pure. */
export function toBatches(counts: ReadonlyMap<string, number>): Record<string, number>[] {
  const batches: Record<string, number>[] = [];
  let current: Record<string, number> = {};
  let size = 0;
  for (const [event, total] of counts) {
    let left = Math.floor(total);
    while (left > 0) {
      const amount = Math.min(left, MAX_COUNT_PER_EVENT);
      if (event in current || size >= MAX_EVENTS_PER_CALL) {
        batches.push(current);
        current = {};
        size = 0;
      }
      current[event] = amount;
      size += 1;
      left -= amount;
    }
  }
  if (size > 0) batches.push(current);
  return batches;
}
