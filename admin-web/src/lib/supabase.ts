import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configError =
  typeof url !== "string" || url === "" || typeof anonKey !== "string" || anonKey === ""
    ? "VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen in admin-web/.env (siehe .env.example)."
    : null;

/**
 * Public anon key and the signed-in admin's session only. The session lives in memory
 * (persistSession: false): nothing is written to localStorage, a reload signs out.
 */
export const supabase = createClient(url ?? "http://invalid.local", anonKey ?? "invalid", {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** Signed URLs for photos live this long (seconds). */
export const SIGNED_URL_SECONDS = 60;
