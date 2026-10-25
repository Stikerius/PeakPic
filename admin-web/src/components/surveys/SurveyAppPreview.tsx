import { useEffect, useState } from "react";

import { BrandLogo } from "../BrandLogo";
import { TokenPreview } from "../TokenPreview";
import { SegmentedChoice } from "../ui";
import { signSurveyImages, type SurveyMediaRow } from "../../lib/api";
import { DEFAULT_COLOR_SET, type BrandMode } from "../../lib/brand";
import { useDashboardBrand } from "../../lib/dashboardBrand";
import { draftToServer, durationInfo, fromLocalInput, type SurveyDraft } from "../../lib/surveyAdmin";
import { remainingText, type ResultsSnapshot } from "../../lib/surveys";

const MODES = [
  ["light", "Hell"],
  ["dark", "Dunkel"],
] as const;

/** Signed links for the images of a preview. */
function useImageUrls(media: readonly { path: string | null }[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const paths = media.flatMap((m) => (m.path !== null ? [m.path] : [])).join("|");
  useEffect(() => {
    if (paths === "") return;
    let active = true;
    void signSurveyImages(paths.split("|")).then((result) => {
      if (active) setUrls(result);
    });
    return () => {
      active = false;
    };
  }, [paths]);
  return urls;
}

function MediaStrip({ media }: { media: readonly { kind: "image" | "logo"; path: string | null; logo: unknown; altText: string }[] }) {
  const brand = useDashboardBrand();
  const urls = useImageUrls(media);
  if (media.length === 0) return null;
  return (
    <div className="app-media">
      {media.map((m, i) =>
        m.kind === "image" ? (
          urls.get(m.path ?? "") !== undefined ? <img key={i} src={urls.get(m.path ?? "")} alt={m.altText} /> : <span key={i} className="app-media-placeholder" />
        ) : (
          <BrandLogo key={i} spec={m.logo} animation={brand.animation} palette="color" mode={brand.mode} size={48} dots={false} colorSet={DEFAULT_COLOR_SET} />
        ),
      )}
    </div>
  );
}

/**
 * How a survey looks in the app (feed card and the question screens), in light and dark. A close
 * picture with the dashboard's tokens; the app itself draws it with its own components.
 */
export function SurveyAppPreview({ draft, media }: { draft: SurveyDraft; media: SurveyMediaRow[] }) {
  const [mode, setMode] = useState<BrandMode>("light");
  const [question, setQuestion] = useState(0);
  const server = draftToServer(draft);
  const ends = server.ends_at as string | null;
  const remaining = ends !== null ? remainingText(ends, new Date(Date.parse(fromLocalInput(draft.startsAt) ?? new Date().toISOString()))) : "";
  const survey = media.filter((m) => m.scope === "survey").sort((a, b) => a.position - b.position);
  const q = draft.questions[Math.min(question, draft.questions.length - 1)];
  const total = draft.questions.length;
  const scaleBounds = q?.scale === "0-10" ? [0, 10] : q?.scale === "1-10" ? [1, 10] : [1, 5];

  return (
    <div className="app-previews">
      <div className="action-row">
        <SegmentedChoice<BrandMode> label="Darstellung" value={mode} options={MODES} onChange={setMode} small />
        {total > 1 && (
          <label className="field">
            <span>Frage</span>
            <select value={question} onChange={(e) => setQuestion(Number(e.target.value))}>
              {draft.questions.map((_, i) => (
                <option key={i} value={i}>
                  Frage {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="app-preview-row">
        <TokenPreview style="new" mode={mode} palette="color" colorSet={DEFAULT_COLOR_SET} className="app-phone">
          <p className="app-caption">Karte im Feed</p>
          <div className="app-card">
            <div className="app-card-head">
              <span className="app-badge">✓ Offiziell</span>
              <span className="app-meta">Umfrage</span>
              <span className="app-meta">{remaining || durationInfo(null, ends, new Date()).text}</span>
            </div>
            <p className="app-title">{draft.title || "Titel der Umfrage"}</p>
            <p className="app-text">{draft.topic || "Worum es geht …"}</p>
            <MediaStrip media={survey} />
            <div className="app-actions">
              <span className="app-button primary">Teilnehmen</span>
              <span className="app-button ghost">Später</span>
            </div>
          </div>
        </TokenPreview>
        <TokenPreview style="new" mode={mode} palette="color" colorSet={DEFAULT_COLOR_SET} className="app-phone">
          <p className="app-caption">Teilnahme</p>
          {q === undefined ? (
            <p className="app-text">Noch keine Fragen.</p>
          ) : (
            <>
              <p className="app-meta">
                Frage {Math.min(question, total - 1) + 1} von {total}
              </p>
              <span className="app-progress">
                <span className={`app-progress-fill w${Math.round(((Math.min(question, total - 1) + 1) / total) * 10)}`} />
              </span>
              <p className="app-meta">{q.required ? "Pflichtfrage" : "Freiwillig"}</p>
              <p className="app-title">{q.prompt || "Frage …"}</p>
              {(q.kind === "single" || q.kind === "multiple") &&
                q.options.map((o, i) => (
                  <span key={i} className="app-option">
                    {q.kind === "single" ? "○" : "☐"} {o || `Antwort ${i + 1}`}
                  </span>
                ))}
              {q.kind === "multiple" && q.maxChoices < q.options.length && <p className="app-meta">Bis zu {q.maxChoices} Antworten</p>}
              {q.kind === "yes_no" && (
                <>
                  <span className="app-option">○ Ja</span>
                  <span className="app-option">○ Nein</span>
                </>
              )}
              {q.kind === "scale" && (
                <div className="app-scale">
                  {Array.from({ length: (scaleBounds[1] ?? 5) - (scaleBounds[0] ?? 1) + 1 }, (_, i) => (
                    <span key={i} className="app-scale-item">
                      {(scaleBounds[0] ?? 1) + i}
                    </span>
                  ))}
                </div>
              )}
              {q.kind === "text" && <span className="app-textarea">Deine Antwort (bis {q.textMax} Zeichen)</span>}
              <div className="app-actions">
                {question > 0 && <span className="app-button ghost">Zurück</span>}
                <span className="app-button primary">{question >= total - 1 ? "Abschicken" : "Weiter"}</span>
              </div>
            </>
          )}
        </TokenPreview>
      </div>
    </div>
  );
}

/** A results post as the app shows it, from the snapshot. */
export function ResultsAppPreview({ snapshot }: { snapshot: ResultsSnapshot }) {
  const [mode, setMode] = useState<BrandMode>("light");
  return (
    <div className="app-previews">
      <SegmentedChoice<BrandMode> label="Darstellung" value={mode} options={MODES} onChange={setMode} small />
      <TokenPreview style="new" mode={mode} palette="color" colorSet={DEFAULT_COLOR_SET} className="app-phone wide">
        <span className="app-badge">✓ Offiziell</span>
        <p className="app-title">{snapshot.title}</p>
        <p className="app-meta">
          {snapshot.participants} Teilnahmen
          {snapshot.participationRate !== null ? ` · Teilnahmequote ${Math.round(snapshot.participationRate * 1000) / 10} %` : ""}
        </p>
        <p className="app-meta">Fazit</p>
        <p className="app-text">{snapshot.conclusion}</p>
        <MediaStrip media={snapshot.media} />
        {snapshot.questions.map((q, i) => (
          <div key={i} className="app-result">
            <p className="app-strong">
              {i + 1}. {q.prompt}
            </p>
            <p className="app-meta">{q.answered} Antworten</p>
            {q.options.map((o, j) => (
              <div key={j} className="app-bar-row">
                <span className="app-bar-label">
                  <span>{o.label}</span>
                  <span className="numeric">{o.percent} %</span>
                </span>
                <span className="app-bar">
                  <span className={`app-bar-fill w${Math.round(o.percent / 10)}`} />
                </span>
              </div>
            ))}
            {(q.mean !== null || q.median !== null || q.nps !== null) && (
              <p className="app-meta">
                {[q.mean !== null ? `Mittelwert ${q.mean}` : null, q.median !== null ? `Median ${q.median}` : null, q.nps !== null ? `NPS ${q.nps}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {q.quotes.map((t, j) => (
              <p key={j} className="app-quote">
                „{t}“
              </p>
            ))}
          </div>
        ))}
      </TokenPreview>
    </div>
  );
}
