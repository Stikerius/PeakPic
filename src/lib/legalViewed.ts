import { useSyncExternalStore } from "react";

import type { LegalDocType } from "@/types/database";

/**
 * Which legal texts were opened in the reader during this app session (in memory only). The
 * sign-up form lets the privacy checkbox be ticked only after the privacy policy was opened.
 */
const viewed = new Set<LegalDocType>();
const listeners = new Set<() => void>();

export function markLegalViewed(type: LegalDocType): void {
  if (viewed.has(type)) return;
  viewed.add(type);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLegalViewed(type: LegalDocType): boolean {
  return useSyncExternalStore(subscribe, () => viewed.has(type));
}
