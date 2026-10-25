import { useEffect, useState } from "react";

import { BrandLogo } from "../BrandLogo";
import { addSurveyLogo, fetchLogos, removeSurveyMedia, signSurveyImages, updateSurveyMedia, uploadSurveyImage, type LogoRow, type SurveyMediaRow } from "../../lib/api";
import { prepareSurveyImage } from "../../lib/imageResize";
import { useDashboardBrand } from "../../lib/dashboardBrand";

type Props = {
  surveyId: string;
  scope: "survey" | "results";
  media: SurveyMediaRow[];
  /** After any change (the list must be loaded again). */
  onChanged: () => void;
  /** A note shown above (e.g. that the survey already has answers). */
  note?: string;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Fehler");

/**
 * Images (scaled and re-encoded in the browser, then checked again by the Edge Function) and
 * logos from the logo library; every one needs an alt text. At most 4 images and 3 logos.
 */
export function SurveyMediaManager({ surveyId, scope, media, onChanged, note }: Props) {
  const brand = useDashboardBrand();
  const mine = media.filter((m) => m.scope === scope).sort((a, b) => a.position - b.position);
  const images = mine.filter((m) => m.kind === "image");
  const logos = mine.filter((m) => m.kind === "logo");
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [library, setLibrary] = useState<LogoRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [imageAlt, setImageAlt] = useState("");
  const [logoId, setLogoId] = useState("");
  const [logoAlt, setLogoAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paths = images.map((m) => m.path ?? "").join("|");

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

  useEffect(() => {
    fetchLogos()
      .then(setLibrary)
      .catch(() => setLibrary([]));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function move(item: SurveyMediaRow, delta: number) {
    const target = mine[mine.indexOf(item) + delta];
    if (target === undefined) return;
    void run(() => updateSurveyMedia(item.id, item.altText, target.position));
  }

  return (
    <div className="media-manager">
      {note !== undefined && <p className="notice">{note}</p>}
      {mine.length === 0 && <p className="muted">Noch keine Bilder oder Logos (optional).</p>}
      <ul className="media-list">
        {mine.map((m, i) => (
          <li key={m.id} className="media-item">
            <div className="media-thumb">
              {m.kind === "image" ? (
                urls.get(m.path ?? "") !== undefined ? <img src={urls.get(m.path ?? "")} alt={m.altText} /> : <span className="muted">Bild</span>
              ) : (
                <BrandLogo spec={m.logo} animation={brand.animation} palette="color" mode={brand.mode} size={56} dots={false} />
              )}
            </div>
            <label className="field grow">
              <span>Alternativtext ({m.kind === "image" ? "Bild" : "Logo"}, Pflicht)</span>
              <input
                defaultValue={m.altText}
                maxLength={140}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value !== "" && value !== m.altText) void run(() => updateSurveyMedia(m.id, value, m.position));
                }}
              />
            </label>
            <div className="action-row">
              <button type="button" className="button small" disabled={busy || i === 0} onClick={() => move(m, -1)} aria-label="Nach vorne">
                ↑
              </button>
              <button type="button" className="button small" disabled={busy || i === mine.length - 1} onClick={() => move(m, 1)} aria-label="Nach hinten">
                ↓
              </button>
              <button type="button" className="button small danger" disabled={busy} onClick={() => void run(() => removeSurveyMedia(m.id))}>
                Entfernen
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="media-add">
        <fieldset className="panel">
          <legend>Bild hinzufügen ({images.length} von 4)</legend>
          <label className="field">
            <span>Datei (PNG, JPEG oder WebP; wird auf höchstens 1600 Pixel verkleinert, Metadaten werden entfernt)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || images.length >= 4} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="field">
            <span>Alternativtext (Pflicht, 1 bis 140 Zeichen)</span>
            <input value={imageAlt} maxLength={140} onChange={(e) => setImageAlt(e.target.value)} />
          </label>
          <button
            type="button"
            className="button"
            disabled={busy || file === null || imageAlt.trim() === "" || images.length >= 4}
            onClick={() =>
              void run(async () => {
                if (file === null) return;
                const prepared = await prepareSurveyImage(file);
                await uploadSurveyImage(surveyId, scope, imageAlt.trim(), prepared.base64);
                setFile(null);
                setImageAlt("");
              })
            }
          >
            {busy ? "Bitte warten …" : "Hochladen"}
          </button>
        </fieldset>
        <fieldset className="panel">
          <legend>Logo aus der Bibliothek ({logos.length} von 3)</legend>
          <label className="field">
            <span>Logo</span>
            <select value={logoId} onChange={(e) => setLogoId(e.target.value)} disabled={busy || logos.length >= 3}>
              <option value="">Logo wählen …</option>
              {library.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Alternativtext (Pflicht)</span>
            <input value={logoAlt} maxLength={140} onChange={(e) => setLogoAlt(e.target.value)} />
          </label>
          <button
            type="button"
            className="button"
            disabled={busy || logoId === "" || logoAlt.trim() === "" || logos.length >= 3}
            onClick={() =>
              void run(async () => {
                await addSurveyLogo(surveyId, scope, logoId, logoAlt.trim());
                setLogoId("");
                setLogoAlt("");
              })
            }
          >
            Hinzufügen
          </button>
        </fieldset>
      </div>
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}
