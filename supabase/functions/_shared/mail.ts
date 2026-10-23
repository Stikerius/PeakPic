// Shared mail module for the Edge Functions. One interface, one implementation per provider
// (HTTPS APIs only: Edge Functions can't use the usual SMTP ports). Configuration from secrets:
//   EMAIL_API_KEY   provider key (never in the repository)
//   EMAIL_FROM      sender, e.g. "PeakPic <noreply@<DEINE-DOMAIN>>"
//   SUPPORT_EMAIL   reply-to and contact address in the texts (optional)
//   EMAIL_PROVIDER  optional, default "resend"; EMAIL_API_URL optional, other endpoint
// Another provider: write a function like resendProvider() and add it to PROVIDERS.
// Addresses and texts are never logged.

import { classifyMailError, type MailFailure } from "./mailErrors.ts";

export type MailAttachment = { filename: string; content: string /* base64 */; contentType?: string };

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
  /** Same key again within 24 hours: the provider sends only once (safe retries). */
  idempotencyKey?: string;
};

export type SendResult = { ok: true } | { ok: false; failure: MailFailure; status: number; code: string };

export interface MailProvider {
  readonly name: string;
  send(from: string, message: MailMessage): Promise<SendResult>;
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). */
export function resendProvider(apiKey: string, url = "https://api.resend.com/emails"): MailProvider {
  return {
    name: "resend",
    async send(from, message) {
      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      if (message.idempotencyKey !== undefined) headers["Idempotency-Key"] = message.idempotencyKey.slice(0, 256);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html !== undefined ? { html: message.html } : {}),
            ...(message.replyTo !== undefined ? { reply_to: message.replyTo } : {}),
            ...(message.attachments !== undefined && message.attachments.length > 0
              ? {
                  attachments: message.attachments.map((a) => ({
                    filename: a.filename,
                    content: a.content,
                    ...(a.contentType !== undefined ? { content_type: a.contentType } : {}),
                  })),
                }
              : {}),
          }),
        });
      } catch {
        return { ok: false, failure: "unavailable", status: 0, code: "network" };
      }
      if (response.ok) return { ok: true };
      let name: string | null = null;
      try {
        const body: unknown = await response.json();
        if (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).name === "string") {
          name = (body as Record<string, string>).name;
        }
      } catch {
        name = null;
      }
      return { ok: false, failure: classifyMailError(response.status, name), status: response.status, code: name ?? "unknown" };
    },
  };
}

type Env = (name: string) => string | undefined;

const PROVIDERS: Record<string, (env: Env) => MailProvider | null> = {
  resend: (env) => {
    const key = env("EMAIL_API_KEY");
    return key ? resendProvider(key, env("EMAIL_API_URL") || undefined) : null;
  },
};

// Resend allows a few requests per second; stay below it.
const MIN_INTERVAL_MS = 600;

/** Sends through one provider, from EMAIL_FROM, with SUPPORT_EMAIL as reply-to by default. */
export class Mailer {
  private last = 0;

  constructor(
    private readonly provider: MailProvider,
    readonly from: string,
    readonly supportEmail: string | null,
  ) {}

  private async pace(): Promise<void> {
    const wait = this.last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.last = Date.now();
  }

  /** One mail. A rate limit is retried once after a pause; every other failure is returned. */
  async send(
    to: string,
    subject: string,
    text: string,
    html?: string,
    attachments?: MailAttachment[],
    replyTo?: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<SendResult> {
    const message: MailMessage = {
      to,
      subject,
      text,
      html,
      attachments,
      replyTo: replyTo ?? this.supportEmail ?? undefined,
      idempotencyKey: options.idempotencyKey,
    };
    await this.pace();
    let result = await this.provider.send(this.from, message);
    if (!result.ok && result.failure === "rate_limit") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      this.last = Date.now();
      result = await this.provider.send(this.from, message);
    }
    return result;
  }
}

/** The mailer from the secrets, or null with the reason when it isn't set up. */
export function mailerFromEnv(env: Env = (name) => Deno.env.get(name)): { mailer: Mailer | null; reason: string | null } {
  const providerName = env("EMAIL_PROVIDER") || "resend";
  const make = PROVIDERS[providerName];
  if (make === undefined) return { mailer: null, reason: `Unbekannter Mail-Anbieter (EMAIL_PROVIDER=${providerName}).` };
  const provider = make(env);
  const from = env("EMAIL_FROM");
  if (provider === null || !from) return { mailer: null, reason: "Secrets EMAIL_API_KEY und EMAIL_FROM fehlen in Supabase." };
  return { mailer: new Mailer(provider, from, env("SUPPORT_EMAIL") || null), reason: null };
}
