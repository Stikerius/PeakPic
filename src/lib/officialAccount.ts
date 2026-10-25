import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * The official account (surveys, results): only its id, loaded once per app start and shared.
 * The app uses it to hide "Folgen", "Nachricht" and "Blockieren" there; the database refuses
 * all three anyway.
 */
let request: Promise<string | null> | null = null;

export function fetchOfficialAccountId(): Promise<string | null> {
  request ??= Promise.resolve(supabase.rpc("get_official_account_id", {}))
    .then(({ data, error }) => {
      if (error) throw error;
      return typeof data === "string" ? data : null;
    })
    .catch(() => {
      // A failed load is tried again next time; "there is none" is kept.
      request = null;
      return null;
    });
  return request;
}

/** The official account's id; null when there is none, undefined until it is known. */
export function useOfficialAccountId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void fetchOfficialAccountId().then((value) => {
      if (active) setId(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return id;
}
