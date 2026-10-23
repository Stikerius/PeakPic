// Shared by the Edge Functions: CORS for the dashboard, JSON answers, reading the JWT.

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": Deno.env.get("ADMIN_ORIGIN") ?? "http://127.0.0.1:5174",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

/** Payload of a JWT that auth.getUser() has already verified. */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (part === undefined) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const value: unknown = JSON.parse(atob(base64));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
