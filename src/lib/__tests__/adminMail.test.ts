import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import * as preview from "../../../admin-web/src/lib/adminMail";
import {
  ADMIN_MAIL_LIMITS,
  buildAdminMail,
  checkMailContent,
  MAIL_CATEGORIES,
  testSubject,
} from "../../../supabase/functions/_shared/adminMail";
import {
  attachmentPathAllowed,
  detectFileType,
  sanitizeFilename,
  toBase64,
} from "../../../supabase/functions/_shared/mailAttachments";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const OWNER = "a0000000-0000-0000-0000-000000000001";
const DRAFT = "11111111-2222-3333-4444-555555555555";

describe("content rules", () => {
  it("requires a category and has none for advertising", () => {
    expect(checkMailContent("", "Betreff", "Text")).toEqual({ ok: false, error: "invalid_category" });
    expect(checkMailContent("advertising", "Betreff", "Text")).toEqual({ ok: false, error: "invalid_category" });
    expect(MAIL_CATEGORIES.map(([key]) => key)).toEqual(["account", "legal", "operations", "personal"]);
  });

  it("limits the subject to one line of 150 characters", () => {
    expect(checkMailContent("legal", "a\nb", "Text")).toEqual({ ok: false, error: "invalid_subject" });
    expect(checkMailContent("legal", "x".repeat(151), "Text")).toEqual({ ok: false, error: "invalid_subject" });
    expect(checkMailContent("legal", "x".repeat(150), "Text").ok).toBe(true);
    expect(checkMailContent("legal", "Betreff", " ")).toEqual({ ok: false, error: "invalid_body" });
  });

  it("adds why the mail comes and the contact, no links", () => {
    const mail = buildAdminMail({ category: "operations", subject: " Wartung ", body: "Hallo,\r\n\r\n<b>Text</b>" }, "<SUPPORT>");
    expect(mail.subject).toBe("Wartung");
    expect(mail.text).toContain("<b>Text</b>");
    expect(mail.text).toContain("Art der Mitteilung: Betrieb und Wartung");
    expect(mail.text).toContain("Du erhältst diese Nachricht, weil du ein PeakPic-Konto hast.");
    expect(mail.text).toContain("schreib an <SUPPORT>");
    expect(mail.text).not.toMatch(/https?:\/\//);
    expect(testSubject("x".repeat(150))).toHaveLength(150);
  });

  it("the dashboard preview is the same mail", () => {
    const content = { category: "account" as const, subject: "Neues Passwort", body: "Hallo,\n\nbitte prüfe dein Konto." };
    expect(preview.buildAdminMail(content, null)).toEqual(buildAdminMail(content, null));
    expect(preview.ADMIN_MAIL_LIMITS).toEqual(ADMIN_MAIL_LIMITS);
    expect(preview.MAIL_CATEGORIES).toEqual(MAIL_CATEGORIES);
    expect(preview.checkMailContent("x", "y", "z")).toEqual(checkMailContent("x", "y", "z"));
    for (const name of ["Rechnung März.pdf", "../../a b.exe.pdf", "....", "Bild.JPEG"]) {
      expect(preview.sanitizeFilename(name, "pdf")).toBe(sanitizeFilename(name, "pdf"));
    }
  });

  it("matches the limits of the database", () => {
    const schema = readFileSync(join(__dirname, "../../../supabase/schema.sql"), "utf8");
    const limits = /function public\.mail_limits\(\)[\s\S]*?\$\$;/.exec(schema)?.[0] ?? "";
    expect(limits).toContain(`'max_recipients', ${ADMIN_MAIL_LIMITS.maxRecipients}`);
    expect(limits).toContain(`'confirm_count_above', ${ADMIN_MAIL_LIMITS.confirmCountAbove}`);
    expect(limits).toContain(`'subject_max', ${ADMIN_MAIL_LIMITS.subjectMax}`);
    expect(limits).toContain(`'max_files', ${ADMIN_MAIL_LIMITS.maxFiles}`);
    expect(limits).toContain(`'max_total_bytes', ${ADMIN_MAIL_LIMITS.maxTotalBytes}`);
  });
});

describe("attachments", () => {
  it("decides the type by the first bytes", () => {
    expect(detectFileType(text("%PDF-1.7 ..."))?.ext).toBe("pdf");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.ext).toBe("png");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0))?.ext).toBe("jpg");
    expect(detectFileType(text("Hallo Welt, äöü\n"))?.ext).toBe("txt");
  });

  it("refuses executables, archives and binary data, also when named .pdf or .txt", () => {
    expect(detectFileType(text("MZ\x90\x00 this program"))).toBeNull();
    expect(detectFileType(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1))).toBeNull();
    expect(detectFileType(text("#!/bin/sh\nrm -rf /"))).toBeNull();
    expect(detectFileType(bytes(0x50, 0x4b, 3, 4))).toBeNull();
    expect(detectFileType(bytes(0x41, 0x00, 0x42))).toBeNull();
    expect(detectFileType(bytes(0xc3, 0x28))).toBeNull();
    expect(detectFileType(bytes())).toBeNull();
  });

  it("cleans names: no folders, no second extension, the detected extension", () => {
    expect(sanitizeFilename("../../etc/passwd", "txt")).toBe("passwd.txt");
    expect(sanitizeFilename("Rechnung.pdf.exe", "txt")).toBe("Rechnung_pdf.txt");
    expect(sanitizeFilename("Größe & Maße.PDF", "pdf")).toBe("Groesse_Masse.pdf");
    expect(sanitizeFilename("<script>.png", "png")).toBe("script.png");
    expect(sanitizeFilename("...", "jpg")).toBe("anhang.jpg");
    expect(sanitizeFilename(`${"a".repeat(200)}.pdf`, "pdf")).toHaveLength(84);
  });

  it("only paths in the admin's own draft folder", () => {
    expect(attachmentPathAllowed(`${OWNER}/${DRAFT}/info.pdf`, OWNER)).toBe(true);
    expect(attachmentPathAllowed(`d0000000-0000-0000-0000-00000000000a/${DRAFT}/info.pdf`, OWNER)).toBe(false);
    expect(attachmentPathAllowed(`${OWNER}/${DRAFT}/../x.pdf`, OWNER)).toBe(false);
    expect(attachmentPathAllowed(`${OWNER}/info.pdf`, OWNER)).toBe(false);
    expect(attachmentPathAllowed(42, OWNER)).toBe(false);
  });

  it("dashboard checks before uploading: count, size, extension", () => {
    const mb = 1024 * 1024;
    expect(preview.attachmentProblem([{ name: "a.pdf", size: mb }])).toBeNull();
    expect(preview.attachmentProblem([1, 2, 3, 4].map((i) => ({ name: `${i}.pdf`, size: 10 })))).toMatch(/Höchstens 3/);
    expect(preview.attachmentProblem([{ name: "a.pdf", size: 3 * mb }, { name: "b.png", size: 3 * mb }])).toMatch(/5 MB/);
    expect(preview.attachmentProblem([{ name: "setup.exe", size: 10 }])).toMatch(/PDF, PNG, JPG und TXT/);
    expect(preview.attachmentProblem([{ name: "a.docx", size: 10 }])).not.toBeNull();
    expect(preview.claimedExtension("Foto.JPEG")).toBe("jpg");
  });

  it("base64 of large files", () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(Buffer.from(toBase64(big), "base64").equals(Buffer.from(big))).toBe(true);
  });
});
