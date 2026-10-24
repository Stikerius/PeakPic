import { useEffect, useState } from "react";

import { BarChart, LineChart } from "../components/Charts";
import {
  fetchStatsAreas,
  fetchStatsFirstDay,
  fetchStatsOverview,
  fetchStatsPeriod,
  fetchStatsSeries,
  type AreaRow,
  type PeriodRow,
  type SeriesPoint,
  type StatsBucket,
  type StatsMetric,
  type StatsOverview,
} from "../lib/api";
import { BUCKETS, PERIODS, bucketLabel, changePercent, defaultBucket, periodRange, zurichToday, type PeriodKey } from "../lib/period";
import { PageHeader, Skeleton } from "../components/ui";

const SERIES: { metric: StatsMetric; label: string }[] = [
  { metric: "accounts", label: "Neue Konten" },
  { metric: "active_accounts", label: "Aktive Konten (Annäherung)" },
  { metric: "posts", label: "Beiträge" },
  { metric: "stories", label: "Storys" },
  { metric: "comments", label: "Kommentare" },
  { metric: "messages", label: "Nachrichten" },
  { metric: "workouts", label: "Trainings" },
];

const CARDS: { metric: string; label: string }[] = [
  { metric: "accounts", label: "Neue Konten" },
  { metric: "active_accounts", label: "Aktive Konten" },
  { metric: "posts", label: "Beiträge" },
  { metric: "stories", label: "Storys" },
  { metric: "comments", label: "Kommentare" },
  { metric: "messages", label: "Nachrichten" },
  { metric: "likes", label: "Likes" },
  { metric: "workouts", label: "Trainings" },
];

const PUBLISHED: { event: string; present: string | null; label: string }[] = [
  { event: "post_created", present: "posts", label: "Beiträge" },
  { event: "story_created", present: "stories", label: "Storys" },
  { event: "highlight_created", present: "highlights", label: "Highlights" },
  { event: "comment_created", present: "comments", label: "Kommentare" },
  { event: "message_created", present: "messages", label: "Nachrichten" },
  { event: "like_created", present: "likes", label: "Likes" },
  { event: "workout_completed", present: null, label: "Trainings" },
  { event: "plan_created", present: "plans", label: "Pläne" },
];

const AREA_LABELS: Record<string, string> = {
  home: "Home",
  feed: "Feed",
  stories: "Storys",
  camera: "Kamera",
  chat: "Chat",
  profile: "Profil",
  plans: "Pläne",
  workout: "Training",
  stats: "Statistik",
  search: "Suche",
  settings: "Einstellungen",
  notifications: "Mitteilungen",
  moderation: "Melden",
};

const numberFormat = new Intl.NumberFormat("de-CH");
const fmt = (n: number) => numberFormat.format(n);

type Data = {
  key: string;
  period: PeriodRow[];
  series: Record<string, SeriesPoint[]>;
  areas: AreaRow[];
};

function Change({ current, previous, show }: { current: number; previous: number; show: boolean }) {
  if (!show) return null;
  const change = changePercent(current, previous);
  if (change === null) return <span className="card-change muted">kein Vergleich</span>;
  const sign = change > 0 ? "+" : "";
  return <span className="card-change muted numeric">{`${sign}${change} % zur Vorperiode`}</span>;
}

/** Anonymous usage numbers (admins only). Only totals, never single people. */
export function UsagePage() {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [bucket, setBucket] = useState<StatsBucket>("day");
  const [showTable, setShowTable] = useState(false);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [firstDay, setFirstDay] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fixed for the visit (the counters are daily anyway).
  const [today] = useState(zurichToday);

  useEffect(() => {
    Promise.all([fetchStatsOverview(), fetchStatsFirstDay()])
      .then(([o, first]) => {
        setOverview(o);
        setFirstDay(first);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Fehler"));
  }, []);

  const range = firstDay === undefined ? null : periodRange(period, today, firstDay);
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const key = `${from}|${to}|${bucket}`;

  useEffect(() => {
    if (from === null || to === null) return;
    let active = true;
    const requestKey = `${from}|${to}|${bucket}`;
    Promise.all([
      fetchStatsPeriod(from, to),
      Promise.all(SERIES.map((s) => fetchStatsSeries(s.metric, from, to, bucket))),
      fetchStatsAreas(from, to),
    ])
      .then(([periodRows, seriesList, areas]) => {
        if (!active) return;
        setError(null);
        setData({
          key: requestKey,
          period: periodRows,
          series: Object.fromEntries(SERIES.map((s, i) => [s.metric, seriesList[i] ?? []])),
          areas,
        });
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Fehler");
      });
    return () => {
      active = false;
    };
  }, [from, to, bucket]);

  const loading = data === null || data.key !== key;
  const periodByMetric = new Map((data?.period ?? []).map((r) => [r.metric, r]));
  const areaTotals = new Map<string, number>();
  for (const row of data?.areas ?? []) areaTotals.set(row.area, (areaTotals.get(row.area) ?? 0) + row.total);
  const areaRows = [...areaTotals.entries()]
    .map(([area, value]) => ({ label: AREA_LABELS[area] ?? area, value }))
    .sort((a, b) => b.value - a.value);
  const topScreens = (data?.areas ?? []).slice(0, 10);
  const compare = period !== "all";

  return (
    <>
      <PageHeader title="Nutzung">
        Nur Tagessummen ohne Bezug zu Personen. Bereiche zählen nur Geräte, auf denen die anonyme Statistik eingeschaltet
        ist. „Aktive Konten“ ist eine Annäherung: Konten, die an einem Tag etwas erstellt haben (Beitrag, Story,
        Kommentar, Nachricht, Like, Follow); reines Lesen ist darin nicht enthalten.
      </PageHeader>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Zeitraum">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={p.key === period ? "button small primary" : "button small"}
              aria-pressed={p.key === period}
              onClick={() => {
                setPeriod(p.key);
                setBucket(defaultBucket(p.key));
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Auflösung">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              type="button"
              className={b.key === bucket ? "button small primary" : "button small"}
              aria-pressed={b.key === bucket}
              onClick={() => setBucket(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <label className="field inline">
          <input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} />
          <span>Als Tabelle</span>
        </label>
      </div>

      {error !== null && <p className="error">{error}</p>}

      {overview !== null && (
        <div className="cards">
          <div className="card">
            <span className="card-value numeric">{fmt(overview.accounts.total)}</span>
            <span className="card-label">
              Konten gesamt: {fmt(overview.accounts.active)} aktiv, {fmt(overview.accounts.suspended)} gesperrt,{" "}
              {fmt(overview.accounts.banned)} gebannt
            </span>
          </div>
          {CARDS.map((c) => {
            const row = periodByMetric.get(c.metric);
            return (
              <div key={c.metric} className="card">
                <span className="card-value numeric">{row === undefined ? "…" : fmt(row.current)}</span>
                <span className="card-label">{c.label} im Zeitraum</span>
                {row !== undefined && <Change current={row.current} previous={row.previous} show={compare} />}
              </div>
            );
          })}
        </div>
      )}

      {overview !== null && (
        <section className="panel">
          <h3>Bisher veröffentlicht</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Inhalt</th>
                <th className="numeric">Bisher veröffentlicht</th>
                <th className="numeric">Aktuell vorhanden</th>
              </tr>
            </thead>
            <tbody>
              {PUBLISHED.map((row) => (
                <tr key={row.event}>
                  <td>{row.label}</td>
                  <td className="numeric">{fmt(overview.published[row.event] ?? 0)}</td>
                  <td className="numeric">{row.present === null ? "–" : fmt(overview.present[row.present] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">„Bisher veröffentlicht“ zählt auch gelöschte Inhalte; Zahlen vor der Installation der Zähler stammen aus dem einmaligen Nachtragen.</p>
        </section>
      )}

      {loading && error === null && <Skeleton lines={5} label="Zahlen laden" />}

      {!loading && data !== null && (
        <>
          <section className="chart-grid-layout">
            {SERIES.map((s) =>
              showTable ? (
                <section key={s.metric} className="panel">
                  <h3>{s.label}</h3>
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Zeitraum</th>
                        <th className="numeric">Anzahl</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.series[s.metric] ?? []).map((p) => (
                        <tr key={p.bucket}>
                          <td>{bucketLabel(p.bucket, bucket)}</td>
                          <td className="numeric">{fmt(p.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : (
                <section key={s.metric} className="panel">
                  <LineChart title={s.label} points={data.series[s.metric] ?? []} bucket={bucket} />
                </section>
              ),
            )}
          </section>

          <section className="panel">
            <h3>Nutzung nach Bereich</h3>
            {areaRows.length === 0 ? (
              <p className="muted">Für diesen Zeitraum gibt es keine Daten.</p>
            ) : showTable ? (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Bereich</th>
                    <th className="numeric">Aufrufe</th>
                    <th className="numeric">Anteil</th>
                  </tr>
                </thead>
                <tbody>
                  {areaRows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="numeric">{fmt(r.value)}</td>
                      <td className="numeric">
                        {Math.round((r.value / areaRows.reduce((sum, x) => sum + x.value, 0)) * 100)} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <BarChart rows={areaRows} />
            )}
            {topScreens.length > 0 && (
              <>
                <h4>Meistgenutzte Ansichten</h4>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Ansicht</th>
                      <th>Bereich</th>
                      <th className="numeric">Aufrufe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topScreens.map((r) => (
                      <tr key={r.event}>
                        <td>
                          <code>{r.event}</code>
                        </td>
                        <td>{AREA_LABELS[r.area] ?? r.area}</td>
                        <td className="numeric">{fmt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
