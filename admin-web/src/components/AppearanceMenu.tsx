import { useEffect, useRef, useState } from "react";

import { SegmentedChoice } from "./ui";
import { MODE_LABELS, type ModePreference } from "../lib/appearance";
import { useAppearance } from "../lib/appearanceContext";
import { BRAND_PALETTE_LABELS, type BrandPaletteName } from "../lib/brand";

const MODES = (["system", "light", "dark"] as const).map((m) => [m, MODE_LABELS[m]] as const);
const PALETTES = (["color", "bw"] as const).map((p) => [p, BRAND_PALETTE_LABELS[p]] as const);

/** Small menu on the login page: mode and colour before signing in. */
export function AppearanceMenu() {
  const { appearance, update } = useAppearance();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  // Escape closes the menu and returns to its button.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="appearance-menu">
      <button ref={button} type="button" className="button small" aria-expanded={open} aria-controls="appearance-menu-panel" onClick={() => setOpen(!open)}>
        Darstellung
      </button>
      {open && (
        <div id="appearance-menu-panel" className="appearance-panel">
          <SegmentedChoice<ModePreference> small label="Modus" value={appearance.mode} options={MODES} onChange={(mode) => update({ mode })} />
          <SegmentedChoice<BrandPaletteName> small label="Farbe" value={appearance.palette} options={PALETTES} onChange={(palette) => update({ palette })} />
        </div>
      )}
    </div>
  );
}
