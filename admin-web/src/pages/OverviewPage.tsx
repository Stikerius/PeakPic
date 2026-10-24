import { useEffect, useState } from "react";

import { fetchLegalOverview, fetchOverview, type Overview } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAge, formatDateTime } from "../lib/format";
import { href } from "../lib/router";
import { PageHeader } from "../components/ui";

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state } = useAuth();
  const isAdmin = state.step === "ready" && state.role === "admin";
  const [legal, setLegal] = useState<{ overdue: number; oldestDueAt: string | null } | null>(null);

  useEffect(() => {
    fetchOverview()
      .then(setOverview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchLegalOverview()
      .then(setLegal)
      .catch(() => setLegal(null));
  }, [isAdmin]);

  return (
    <>
      <PageHeader title="Übersicht">Offene Arbeit auf einen Blick.</PageHeader>
      {error !== null && <p className="error">{error}</p>}
      {overview !== null && (
        <div className="cards">
          <a className="card" href={href({ page: "queue" })}>
            <span className="card-value">{overview.openReports}</span>
            <span className="card-label">Offene Meldungen</span>
          </a>
          <a className="card" href={href({ page: "queue" })}>
            <span className="card-value">{overview.inReviewReports}</span>
            <span className="card-label">In Prüfung</span>
          </a>
          <div className="card">
            <span className="card-value">{formatAge(overview.oldestOpenAt)}</span>
            <span className="card-label">Älteste offene Meldung ({formatDateTime(overview.oldestOpenAt)})</span>
          </div>
          <div className="card">
            <span className="card-value">{overview.quarantined}</span>
            <span className="card-label">Inhalte in Quarantäne</span>
          </div>
          {legal !== null && (
            <a className="card" href={href({ page: "pending" })}>
              <span className="card-value">{legal.overdue}</span>
              <span className="card-label">
                Konten überfällig (Rechtstexte){legal.oldestDueAt !== null ? `, älteste seit ${formatAge(legal.oldestDueAt)}` : ""}
              </span>
            </a>
          )}
        </div>
      )}
    </>
  );
}
