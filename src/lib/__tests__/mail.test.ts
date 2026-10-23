import { describe, expect, it } from "@jest/globals";

import { buildResetMail as buildPreview } from "../../../admin-web/src/lib/resetMail";
import { classifyMailError, stopsBatch } from "../../../supabase/functions/_shared/mailErrors";
import { buildResetMail, escapeHtml, resetCategoryText, textToHtml, type ResetMailInput } from "../../../supabase/functions/_shared/resetMail";
import { absentPartner } from "@/lib/chatPartner";

const base: ResetMailInput = {
  role: "selected",
  mode: "categories",
  categories: ["posts", "chats"],
  reason: "Ende der Testphase",
  subject: "Neustart: {{kategorien}}",
  userMessage: "Hallo,\n\nwir haben gelöscht: {{kategorien}}. Grund: {{begruendung}}",
  supportEmail: "<SUPPORT>",
};

describe("mail failures (Resend answers)", () => {
  it("tells quota from rate limit", () => {
    expect(classifyMailError(429, "daily_quota_exceeded")).toBe("quota");
    expect(classifyMailError(429, "monthly_quota_exceeded")).toBe("quota");
    expect(classifyMailError(429, "rate_limit_exceeded")).toBe("rate_limit");
  });

  it("stops the batch for everything except a single bad mail", () => {
    expect(classifyMailError(422, "missing_required_field")).toBe("rejected");
    expect(classifyMailError(403, "validation_error")).toBe("config");
    expect(classifyMailError(500, "application_error")).toBe("unavailable");
    expect(classifyMailError(0, null)).toBe("unavailable");
    expect(stopsBatch("rejected")).toBe(false);
    for (const f of ["quota", "rate_limit", "config", "unavailable"] as const) expect(stopsBatch(f)).toBe(true);
  });
});

describe("reset mail", () => {
  it("fills placeholders and lists what was removed and what stays", () => {
    const mail = buildResetMail(base);
    expect(mail.subject).toBe("Neustart: Chats sowie Beiträge");
    expect(mail.text).toContain("wir haben gelöscht: Chats sowie Beiträge. Grund: Ende der Testphase");
    expect(mail.text).toContain("Gelöscht wurden: Chats sowie Beiträge.");
    expect(mail.text).toContain("Unverändert bleiben dein Konto");
    expect(mail.text).toContain("<SUPPORT>");
    expect(mail.text).toContain("weil du ein PeakPic-Konto hast");
  });

  it("has no links", () => {
    for (const input of [base, { ...base, role: "collateral" as const }, { ...base, mode: "full" as const }]) {
      expect(buildResetMail(input).text).not.toMatch(/https?:|www\./i);
    }
  });

  it("tells collateral accounts only that chats ended, without names", () => {
    const mail = buildResetMail({ ...base, role: "collateral", userMessage: "@jemand {{kategorien}}" });
    expect(mail.text).toContain("Eine oder mehrere deiner Unterhaltungen wurden im Rahmen einer Datenbereinigung beendet");
    expect(mail.text).toContain("Grund: Ende der Testphase");
    expect(mail.text).toContain("bleiben unverändert");
    expect(mail.text).not.toContain("@jemand");
  });

  it("says the account is gone for full deletion", () => {
    const mail = buildResetMail({ ...base, mode: "full" });
    expect(mail.text).toContain("Gelöscht wurde: dein PeakPic-Konto mit allen Daten.");
    expect(mail.text).toContain("PeakPic-Konto hattest");
  });

  it("falls back to the default subject and keeps the subject on one line", () => {
    expect(buildResetMail({ ...base, subject: "  " }).subject).toBe("PeakPic: Daten in deinem Konto wurden gelöscht");
    expect(buildResetMail({ ...base, subject: "a\nb" }).subject).toBe("a b");
  });

  it("escapes HTML and keeps paragraphs", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    expect(textToHtml("a <x>\nb\n\nc")).toBe('<!doctype html><html lang="de"><body><p>a &lt;x&gt;<br>b</p><p>c</p></body></html>');
  });

  it("is the same in the dashboard preview and on the server", () => {
    const inputs: ResetMailInput[] = [
      base,
      { ...base, role: "collateral" },
      { ...base, mode: "full", subject: null, userMessage: null },
      { ...base, categories: ["other", "social", "stories", "plans", "activities", "notifications"], supportEmail: null },
    ];
    for (const input of inputs) expect(buildPreview(input)).toEqual(buildResetMail(input));
    expect(resetCategoryText([])).toBe("");
  });
});

describe("chat partner label", () => {
  it("says 'Gelöschtes Konto' only when the account is gone", () => {
    expect(absentPartner("deleted").displayName).toBe("Gelöschtes Konto");
    expect(absentPartner("left").displayName).toBe("Nicht mehr im Chat");
    expect(absentPartner(undefined).displayName).toBe("Gelöschtes Konto");
    expect(absentPartner("left")).toMatchObject({ id: "", username: "", avatarUrl: null });
  });
});
