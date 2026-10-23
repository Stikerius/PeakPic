// Supabase Edge Function: sign in with username + password (the e-mail never leaves the server).
//
// Supabase Auth signs in with an e-mail only. This function looks up the e-mail of the CURRENT
// username (profiles.username) with the Auth admin API, signs in with it and returns only the
// session (access and refresh token); the app sets it with supabase.auth.setSession().
//
// No user is signed in yet, so there is no user JWT: the platform checks the anon key JWT of the
// app (verify_jwt stays on). Inputs are validated, unknown usernames and wrong passwords answer
// the same ("invalid_credentials"), and at most 10 failed attempts per username in 15 minutes
// are allowed (public.login_attempts, no client access, rows older than a day are removed).
//
// The service_role key (SUPABASE_SERVICE_ROLE_KEY, provided by Supabase) is used only for the
// Auth admin API (e-mail of a user) and login_attempts. Nothing about the user is logged.
//
// Deploy: npx supabase functions deploy login_with_username

import { createClient } from "npm:@supabase/supabase-js@2";

const USERNAME = /^[a-z0-9_.]{3,20}$/;
const MAX_FAILURES = 10;
const WINDOW_MINUTES = 15;

function json(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server_error" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_credentials" });
  }
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!USERNAME.test(username) || password.length < 1 || password.length > 200) {
    return json({ error: "invalid_credentials" });
  }

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error: countError } = await service
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("username_key", username)
    .gte("created_at", since);
  if (countError) return json({ error: "server_error" });
  if ((count ?? 0) >= MAX_FAILURES) return json({ error: "too_many_attempts" });

  async function fail(): Promise<Response> {
    await service.from("login_attempts").insert({ username_key: username });
    await service
      .from("login_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return json({ error: "invalid_credentials" });
  }

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (profileError) return json({ error: "server_error" });
  if (profile === null) return fail();

  const { data: userData, error: userError } = await service.auth.admin.getUserById(profile.id);
  const email = userData?.user?.email;
  if (userError || !email) return fail();

  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    // Auth only says "not confirmed" after the password was right.
    if (error?.code === "email_not_confirmed") return json({ error: "email_not_confirmed" });
    if (error?.code === "over_request_rate_limit") return json({ error: "too_many_attempts" });
    return fail();
  }
  await service.from("login_attempts").delete().eq("username_key", username);
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
