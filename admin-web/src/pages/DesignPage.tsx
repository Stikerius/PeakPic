import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandLogo } from "../components/BrandLogo";
import { EmptyState, PageHeader, SegmentedChoice, Skeleton } from "../components/ui";
import { AMBIENT_LABELS, MODE_LABELS, STYLES, type Ambient, type ModePreference, type StyleId } from "../lib/appearance";
import { useAppearance } from "../lib/appearanceContext";
import { fetchAppLoginDesign, saveAppLoginDesign, type AppLoginDesign } from "../lib/api";
import { BRAND_PALETTE_LABELS, type BrandMode, type BrandPaletteName } from "../lib/brand";
import { useDashboardBrand } from "../lib/dashboardBrand";
import { href } from "../lib/router";
import { applyTokens, tokensFor } from "../lib/tokens";

const STYLE_OPTIONS = STYLES.map((s) => [s.id, s.label] as const);
const MODE_OPTIONS = (["system", "light", "dark"] as const).map((m) => [m, MODE_LABELS[m]] as const);
const PALETTE_OPTIONS = (["color", "bw"] as const).map((p) => [p, BRAND_PALETTE_LABELS[p]] as const);
const AMBIENT_OPTIONS = (["on", "calm", "off"] as const).map((a) => [a, AMBIENT_LABELS[a]] as const);
const ANIMATION_OPTIONS = [
  ["on", "Ein"],
  ["off", "Aus"],
] as const;

/** A box that shows its content with the tokens of another style, mode and palette. */
function TokenPreview({ style, mode, palette, children, className }: { style: StyleId; mode: BrandMode; palette: BrandPaletteName; children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current !== null) applyTokens(ref.current, tokensFor(style, mode, palette));
  }, [style, mode, palette]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** "Design" (admins only): the dashboard's look in this browser, and the app's login screen. */
export function DesignPage() {
  const { appearance, mode, update } = useAppearance();
  const brand = useDashboardBrand();
  const [previewMode, setPreviewMode] = useState<BrandMode | null>(null);
  const shownMode = previewMode ?? mode;

  const [app, setApp] = useState<(AppLoginDesign & { logo: unknown; preset: unknown }) | null>(null);
  const [saved, setSaved] = useState<AppLoginDesign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAppLoginDesign()
      .then((design) => {
        if (!active) return;
        setApp(design);
        setSaved({ palette: design.palette, mode: design.mode, animation: design.animation });
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Fehler");
      });
    return () => {
      active = false;
    };
  }, []);

  const appMode: BrandMode = app === null || app.mode === "system" ? mode : app.mode;
  const changed = app !== null && saved !== null && (app.palette !== saved.palette || app.mode !== saved.mode || app.animation !== saved.animation);

  async function saveApp() {
    if (app === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const design = { palette: app.palette, mode: app.mode, animation: app.animation };
      await saveAppLoginDesign(design);
      setSaved(design);
      setNotice("Gespeichert. Die App zeigt die Änderung beim nächsten Öffnen des Anmeldebildschirms.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Design">
        Logos wählst und lädst du unter <a href={href({ page: "logos" })}>Logos</a> hoch.
      </PageHeader>

      <section className="panel" aria-labelledby="design-dashboard">
        <h2 id="design-dashboard">Dashboard</h2>
        <p className="muted">Gilt nur in diesem Browser und wird nur hier gespeichert, ohne Bezug zu deinem Konto.</p>
        <div className="design-grid">
          <div className="design-choices">
            <SegmentedChoice<StyleId> label="Stil" value={appearance.style} options={STYLE_OPTIONS} onChange={(style) => update({ style })} />
            <SegmentedChoice<ModePreference> label="Modus" value={appearance.mode} options={MODE_OPTIONS} onChange={(m) => update({ mode: m })} />
            <SegmentedChoice<BrandPaletteName> label="Farbe" value={appearance.palette} options={PALETTE_OPTIONS} onChange={(palette) => update({ palette })} />
            <SegmentedChoice<Ambient> label="Hintergrundanimationen" value={appearance.ambient} options={AMBIENT_OPTIONS} onChange={(ambient) => update({ ambient })} />
          </div>
          <div>
            <TokenPreview style={appearance.style} mode={shownMode} palette={appearance.palette} className="design-preview">
              <div className="design-preview-head">
                <BrandLogo spec={brand.spec} params={brand.params} palette={appearance.palette} mode={shownMode} size={44} dots={false} />
                <strong>PeakPic Moderation</strong>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Meldung</th>
                    <th className="numeric">Alter</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Beitrag · Spam</td>
                    <td className="numeric">2 h</td>
                    <td>
                      <span className="pill">Offen</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Kommentar · Belästigung</td>
                    <td className="numeric">5 h</td>
                    <td>
                      <span className="pill warn">In Prüfung</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="action-row">
                <button type="button" className="button primary" tabIndex={-1}>
                  Hauptaktion
                </button>
                <button type="button" className="button" tabIndex={-1}>
                  Zweitaktion
                </button>
              </div>
              <p className="muted">Hilfstext in gedämpfter Farbe.</p>
            </TokenPreview>
            <div className="action-row">
              <button type="button" className="button small" onClick={() => setPreviewMode(shownMode === "dark" ? "light" : "dark")}>
                Vorschau in {shownMode === "dark" ? "Hell" : "Dunkel"}
              </button>
              {previewMode !== null && (
                <button type="button" className="button small" onClick={() => setPreviewMode(null)}>
                  Wie eingestellt
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="design-app">
        <h2 id="design-app">App-Anmeldebildschirm</h2>
        <p className="muted">
          Farbe, Modus und Animation des Anmeldebildschirms der App. Das Logo ist das aktive Logo des Ziels „App-Anmeldung“. Die Änderung wirkt beim
          nächsten Öffnen des Anmeldebildschirms der App.
        </p>
        {error !== null && <p className="error">{error}</p>}
        {notice !== null && <p className="success">{notice}</p>}
        {app === null && error === null && <Skeleton lines={4} label="Einstellungen der App laden" />}
        {app === null && error !== null && <EmptyState title="Keine Einstellungen geladen">Bitte die Seite neu laden.</EmptyState>}
        {app !== null && (
          <div className="design-grid">
            <div className="design-choices">
              <SegmentedChoice<BrandPaletteName> label="Farbe" value={app.palette} options={PALETTE_OPTIONS} onChange={(palette) => setApp({ ...app, palette })} />
              <SegmentedChoice<ModePreference> label="Modus" value={app.mode} options={MODE_OPTIONS} onChange={(m) => setApp({ ...app, mode: m })} />
              <SegmentedChoice<"on" | "off">
                label="Animation"
                value={app.animation ? "on" : "off"}
                options={ANIMATION_OPTIONS}
                onChange={(value) => setApp({ ...app, animation: value === "on" })}
              />
              {app.mode === "system" && <p className="muted">„System“ folgt dem Gerät; die Vorschau zeigt den Modus des Dashboards.</p>}
              <div className="action-row">
                <button type="button" className="button primary" disabled={busy || !changed} onClick={() => void saveApp()}>
                  {busy ? "Bitte warten …" : "Speichern"}
                </button>
              </div>
            </div>
            <TokenPreview style="new" mode={appMode} palette={app.palette} className="phone-preview">
              <BrandLogo spec={app.logo} params={app.preset} palette={app.palette} mode={appMode} size={200} playing={app.animation} />
              <p className="phone-title">PeakPic</p>
              <p className="muted">Willkommen zurück!</p>
              <span className="phone-field" />
              <span className="phone-field" />
              <span className="phone-button" />
            </TokenPreview>
          </div>
        )}
      </section>
    </>
  );
}
