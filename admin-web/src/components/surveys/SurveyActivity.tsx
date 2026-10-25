import { useEffect, useState } from "react";

import { BarChart, LineChart } from "../Charts";
import { SegmentedChoice, Skeleton } from "../ui";
import { fetchSurveyStats, type SurveyStats } from "../../lib/api";
import { href } from "../../lib/router";
import { percent, rate, stateLabel } from "../../lib/surveyAdmin";
import { remainingText } from "../../lib/surveys";

type Period = "7" | "30" | "90" | "all";
const PERIODS: readonly (readonly [Period, string])[] = [
  ["7", "7 Tage"],
  ["30", "30 Tage"],
  ["90", "90 Tage"],
  ["all", "Alles"],
];

/** "YYYY-MM-DD" in Europe/Zurich, `days` before today. */
function dayKey(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Overview, "Umfragen und Aktivität" (admins): running surveys, participations, participation and
 * completion rate, how often cards were hidden, results views, participations per day, a table per
 * survey with its reach, and the time of day (hourly, only from 30 participations on).
 */
export function SurveyActivity() {
  const [period, setPeriod] = useState<Period>("30");
  const [stats, setStats] = useState<SurveyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const from = period === "all" ? "2000-01-01" : dayKey(Number(period) - 1);
    fetchSurveyStats(from, dayKey(0))
      .then((s) => {
        if (active) setStats(s);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Fehler");
      });
    return () => {
      active = false;
    };
  }, [period]);

  const c = stats?.counters ?? {};
  const now = new Date();

  return (
    <section className="panel" aria-labelledby="survey-activity">
      <div className="panel-head">
        <h2 id="survey-activity">Umfragen und Aktivität</h2>
        <SegmentedChoice<Period> label="Zeitraum" value={period} options={PERIODS} onChange={setPeriod} small />
      </div>
      {error !== null && <p className="error">{error}</p>}
      {stats === null && error === null && <Skeleton lines={4} label="Umfragen laden" />}
      {stats !== null && (
        <>
          <div className="cards">
            <a className="card" href={href({ page: "surveys" })}>
              <span className="card-value">{stats.active}</span>
              <span className="card-label">Aktive Umfragen</span>
            </a>
            <div className="card">
              <span className="card-value">{stats.participations}</span>
              <span className="card-label">Teilnahmen im Zeitraum</span>
            </div>
            <div className="card">
              <span className="card-value">{percent(rate(stats.runningParticipants, stats.runningEligible))}</span>
              <span className="card-label">Teilnahmequote der laufenden</span>
            </div>
            <div className="card">
              <span className="card-value">{percent(rate(stats.participations, c.started ?? 0))}</span>
              <span className="card-label">Abschlussquote (abgeschickt von begonnenen)</span>
            </div>
            <div className="card">
              <span className="card-value">{percent(rate(c.dismissed ?? 0, c.card_shown ?? 0))}</span>
              <span className="card-label">Ausblend-Quote (ausgeblendet von gesehenen Karten)</span>
            </div>
            <div className="card">
              <span className="card-value">{c.results_opened ?? 0}</span>
              <span className="card-label">Aufrufe der Auswertungen</span>
            </div>
          </div>
          {stats.perDay.length > 0 ? (
            <LineChart title="Teilnahmen pro Tag" bucket="day" points={stats.perDay.map((d) => ({ bucket: d.day, value: d.count }))} />
          ) : (
            <p className="muted">Keine Teilnahmen im Zeitraum.</p>
          )}
          {stats.surveys.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Umfrage</th>
                  <th>Status</th>
                  <th>Restzeit</th>
                  <th className="numeric">Antworten</th>
                  <th className="numeric">Quote</th>
                  <th className="numeric">Reichweite</th>
                </tr>
              </thead>
              <tbody>
                {stats.surveys.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a href={href({ page: "survey-results", id: s.id })}>{s.title}</a>
                    </td>
                    <td>{stateLabel(s.state)}</td>
                    <td>{s.state === "active" ? remainingText(s.endsAt, now) : "–"}</td>
                    <td className="numeric">{s.responses}</td>
                    <td className="numeric">{percent(rate(s.responses, s.eligibleStart))}</td>
                    <td className="numeric">
                      {percent(rate(s.reach, s.eligibleStart))} ({s.reach})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>Tageszeit der Teilnahmen</h3>
          {stats.hours === null ? (
            <p className="muted">Erst ab 30 Teilnahmen im Zeitraum (nur stündlich zusammengefasst).</p>
          ) : (
            <BarChart rows={stats.hours.map((value, h) => ({ label: `${String(h).padStart(2, "0")} Uhr`, value }))} />
          )}
          <p className="muted">
            Reichweite: Konten, die die Karte mindestens eine Sekunde gesehen haben, geteilt durch die erreichbaren Konten beim Start. Weitere Zahlen
            unter <a href={href({ page: "usage" })}>Nutzung</a>.
          </p>
        </>
      )}
    </section>
  );
}
