import Constants from "expo-constants";

import { supabase } from "@/lib/supabase";
import type { LegalConfirmationType, LegalDocType } from "@/types/database";

export type LegalDocument = {
  id: string;
  docType: LegalDocType;
  version: number;
  title: string;
  bodyMd: string;
  changeSummary: string | null;
  confirmationType: LegalConfirmationType;
  requiresConfirmation: boolean;
  blocking: boolean;
  publishedAt: string;
};

export type LegalStatus = {
  documentId: string;
  docType: LegalDocType;
  version: number;
  title: string;
  requiresConfirmation: boolean;
  confirmationType: LegalConfirmationType;
  /** This version, or null if not yet confirmed. */
  confirmedAt: string | null;
  lastConfirmedVersion: number | null;
  lastConfirmedAt: string | null;
  /** "Später" possible: an update of a text confirmed before, and not blocking. */
  canPostpone: boolean;
};

export type LegalVersion = { id: string; version: number; title: string; publishedAt: string; status: string };

export const LEGAL_TYPE_LABELS: Record<LegalDocType, string> = {
  terms: "Nutzungsbedingungen",
  privacy: "Datenschutzerklärung",
  guidelines: "Community-Richtlinien",
};

/** Button text: terms are accepted, the other texts only acknowledged (information, not consent). */
export function confirmLabel(type: LegalConfirmationType): string {
  return type === "accept" ? "Akzeptieren" : "Gelesen und zur Kenntnis genommen";
}

function appVersion(): string {
  return (Constants.expoConfig?.version ?? "").slice(0, 32);
}

/** Current published texts (also without login). */
export async function fetchCurrentLegalDocuments(): Promise<LegalDocument[]> {
  const { data, error } = await supabase.rpc("get_current_legal_documents", {});
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    docType: row.doc_type,
    version: row.version,
    title: row.title,
    bodyMd: row.body_md,
    changeSummary: row.change_summary,
    confirmationType: row.confirmation_type,
    requiresConfirmation: row.requires_confirmation,
    blocking: row.blocking,
    publishedAt: row.published_at,
  }));
}

export async function fetchLegalVersions(docType: LegalDocType): Promise<LegalVersion[]> {
  const { data, error } = await supabase.rpc("get_legal_document_versions", { p_doc_type: docType });
  if (error) throw error;
  return data.map((row) => ({ id: row.id, version: row.version, title: row.title, publishedAt: row.published_at, status: row.status }));
}

/** One published or archived version (read-only). */
export async function fetchLegalDocument(id: string): Promise<LegalDocument | null> {
  const { data, error } = await supabase.rpc("get_legal_document", { p_id: id });
  if (error) throw error;
  const row = data[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    docType: row.doc_type,
    version: row.version,
    title: row.title,
    bodyMd: row.body_md,
    changeSummary: row.change_summary,
    confirmationType: row.confirmation_type,
    requiresConfirmation: false,
    blocking: false,
    publishedAt: row.published_at,
  };
}

export async function fetchMyLegalStatus(): Promise<LegalStatus[]> {
  const { data, error } = await supabase.rpc("get_my_legal_status", {});
  if (error) throw error;
  return data.map((row) => ({
    documentId: row.document_id,
    docType: row.doc_type,
    version: row.version,
    title: row.title,
    requiresConfirmation: row.requires_confirmation,
    confirmationType: row.confirmation_type,
    confirmedAt: row.confirmed_at,
    lastConfirmedVersion: row.last_confirmed_version,
    lastConfirmedAt: row.last_confirmed_at,
    canPostpone: row.can_postpone,
  }));
}

/** Confirms exactly these versions; the server sets time, type and hash. */
export async function confirmLegalDocuments(documentIds: string[]): Promise<void> {
  const { error } = await supabase.rpc("confirm_legal_documents", {
    p_document_ids: documentIds,
    p_app_version: appVersion(),
  });
  if (error) {
    throw new Error(
      error.message === "documents_not_current"
        ? "Dieser Text wurde inzwischen aktualisiert. Bitte lade die neue Version."
        : "Bestätigung fehlgeschlagen. Prüfe deine Verbindung.",
    );
  }
}
