import { useEffect, useState } from "react";

import { fetchOverview, type Overview } from "../lib/api";
import { formatAge, formatDateTime } from "../lib/format";
import { href } from "../lib/router";

export function OverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverview()
      .then(setOverview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, []);

  return (
    <>
      <h1>Übersicht</h1>
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
        </div>
      )}
    </>
  );
}
