/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Project URL (public). */
  readonly VITE_SUPABASE_URL?: string;
  /** Anon key (public). Never put the service_role key into admin-web. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
