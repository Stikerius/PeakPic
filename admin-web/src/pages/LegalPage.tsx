import { useCallback, useEffect, useState } from "react";

import { fetchLegalDocumentBody, fetchLegalList, saveLegalDraft, type LegalDocType, type LegalVersionRow } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { href, navigate } from "../lib/router";

export const LEGAL_LABELS: Record<LegalDocType, string> = {
  terms: "Nutzungsbedingungen",
  privacy: "Datenschutzerklärung",
  guidelines: "Community-Richtlinien",
};

const STATUS: Record<string, string> = { draft: "Entwurf", published: "Veröffentlicht", archived: "Archiviert" };
const TYPES: LegalDocType[] = ["terms", "privacy", "guidelines"];

/** Legal texts per type with versions, status and confirmation numbers. Admins only. */
export function LegalPage() {
  const [rows, setRows] = useState<LegalVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<LegalDocType | null>(null);

  const load = useCallback(() => {
    fetchLegalList()
      .then((result) => {
        setError(null);
        setRows(result);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, []);

  useEffect(load, [load]);

  /** New draft, copied from the newest version of the type (or empty). */
  async function newDraft(type: LegalDocType) {
    setBusy(type);
    setError(null);
    try {
      const latest = rows?.find((row) => row.docType === type);
      const base = latest !== undefined ? (await fetchLegalDocumentBody(latest.id)).draft : null;
      const id = await saveLegalDraft({
        id: null,
        docType: type,
        title: base?.title ?? LEGAL_LABELS[type],
        bodyMd: base?.bodyMd ?? `# ${LEGAL_LABELS[type]}\n\n> ENTWURF\n`,
        changeSummary: "",
        confirmationType: base?.confirmationType ?? (type === "terms" ? "accept" : "acknowledge"),
        requiresConfirmation: base?.requiresConfirmation ?? true,
        blocking: false,
        graceDays: base?.graceDays ?? 5,
      });
      navigate({ page: "legal-edit", id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>Rechtstexte</h1>
      <p className="muted">
        Nutzungsbedingungen werden akzeptiert, Datenschutzerklärung und Richtlinien nur zur Kenntnis genommen.
        Veröffentlichte Versionen sind unveränderlich; Korrekturen sind immer eine neue Version.
      </p>
      {error !== null && <p className="error">{error}</p>}
      {rows !== null &&
        TYPES.map((type) => {
          const versions = rows.filter((row) => row.docType === type);
          const hasDraft = versions.some((row) => row.status === "draft");
          return (
            <section key={type} className="panel">
              <h3>
                {LEGAL_LABELS[type]}
                <button
                  type="button"
                  className="button small"
                  disabled={busy !== null || hasDraft}
                  onClick={() => void newDraft(type)}
                  title={hasDraft ? "Es gibt schon einen Entwurf" : undefined}
                >
                  Neuer Entwurf
                </button>
              </h3>
              {versions.length === 0 ? (
                <p className="muted">Noch keine Version. Entwürfe aus docs/legal kannst du mit supabase/seed-legal.sql anlegen.</p>
              ) : (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Veröffentlicht</th>
                      <th>Bestätigung</th>
                      <th className="numeric">Bestätigt</th>
                      <th className="numeric">Ausstehend</th>
                      <th className="numeric">Überfällig</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <a href={href({ page: "legal-edit", id: row.id })}>Version {row.version}</a>
                        </td>
                        <td>{STATUS[row.status]}</td>
                        <td>{formatDateTime(row.publishedAt)}</td>
                        <td>
                          {row.confirmationType === "accept" ? "Akzeptieren" : "Zur Kenntnis"}
                          {row.requiresConfirmation ? "" : " · keine Bestätigung"}
                          {row.blocking ? " · blockierend" : ""}
                        </td>
                        <td className="numeric">{row.confirmed}</td>
                        <td className="numeric">{row.status === "published" ? row.pending : "–"}</td>
                        <td className="numeric">{row.status === "published" ? row.overdue : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
    </>
  );
}
