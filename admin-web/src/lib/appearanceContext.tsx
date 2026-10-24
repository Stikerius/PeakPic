import { createContext, use, useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  LEGACY_THEME_KEY,
  STORAGE_KEY,
  parseAppearance,
  resolveMode,
  serializeAppearance,
  type Appearance,
} from "./appearance";
import { DEFAULT_COLOR_SET, colorSetToPublic, parseColorSet, type BrandMode, type ColorSet } from "./brand";
import { supabase } from "./supabase";
import { applyTokens, tokensFor } from "./tokens";

const DARK_QUERY = "(prefers-color-scheme: dark)";
/** Last known active colour set of the dashboard (public values only), so nothing flashes. */
const COLORS_KEY = "peakpic-admin-colors";

function readStored(): Appearance {
  try {
    return parseAppearance(window.localStorage.getItem(STORAGE_KEY), window.localStorage.getItem(LEGACY_THEME_KEY));
  } catch {
    return parseAppearance(null);
  }
}

function readStoredColors(): ColorSet {
  try {
    const stored = window.localStorage.getItem(COLORS_KEY);
    return (stored !== null ? parseColorSet(JSON.parse(stored)) : null) ?? DEFAULT_COLOR_SET;
  } catch {
    return DEFAULT_COLOR_SET;
  }
}

/** The dashboard's active colour set from the public design config (checked; "Orange" on any problem). */
async function fetchDashboardColors(): Promise<ColorSet> {
  const { data, error } = await supabase.rpc("get_public_design_config");
  if (error || typeof data !== "object" || data === null) return DEFAULT_COLOR_SET;
  return parseColorSet((data as Record<string, unknown>).dashboard_colors) ?? DEFAULT_COLOR_SET;
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Puts the look on the document: data attributes for the layout rules, tokens for the colours. */
function applyToDocument(appearance: Appearance, mode: BrandMode, colorSet: ColorSet): void {
  const root = document.documentElement;
  root.dataset.style = appearance.style;
  root.dataset.theme = mode;
  root.dataset.palette = appearance.palette;
  root.dataset.ambient = appearance.ambient;
  root.style.colorScheme = mode;
  applyTokens(root, tokensFor(appearance.style, mode, appearance.palette, colorSet));
}

/** Before React renders the first time (no flash in the wrong colours). */
export function applyInitialAppearance(): void {
  const appearance = readStored();
  applyToDocument(appearance, resolveMode(appearance.mode, window.matchMedia(DARK_QUERY).matches), readStoredColors());
}

type AppearanceContextValue = {
  appearance: Appearance;
  /** The mode actually shown (System resolved). */
  mode: BrandMode;
  /** The dashboard's active colour set ("Hauptfarbe"). */
  colorSet: ColorSet;
  update: (change: Partial<Appearance>) => void;
  /** Load the active colour set again (after activating another one). */
  reloadColors: () => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readStored);
  const [colorSet, setColorSet] = useState<ColorSet>(readStoredColors);
  const [colorsVersion, setColorsVersion] = useState(0);
  const systemDark = useSyncExternalStore(subscribeSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const mode = resolveMode(appearance.mode, systemDark);

  useLayoutEffect(() => {
    applyToDocument(appearance, mode, colorSet);
  }, [appearance, mode, colorSet]);

  useEffect(() => {
    let active = true;
    void fetchDashboardColors().then((set) => {
      if (!active) return;
      setColorSet(set);
      try {
        window.localStorage.setItem(COLORS_KEY, JSON.stringify(colorSetToPublic(set)));
      } catch {
        // Only a convenience against flashing colours.
      }
    });
    return () => {
      active = false;
    };
  }, [colorsVersion]);

  const update = useCallback((change: Partial<Appearance>) => {
    setAppearance((current) => {
      const next = { ...current, ...change };
      try {
        // Only the look is stored, nothing about the person or the dashboard's data.
        window.localStorage.setItem(STORAGE_KEY, serializeAppearance(next));
        window.localStorage.removeItem(LEGACY_THEME_KEY);
      } catch {
        // Private mode or blocked storage: the choice lasts until the tab is closed.
      }
      return next;
    });
  }, []);

  const reloadColors = useCallback(() => setColorsVersion((v) => v + 1), []);

  return <AppearanceContext value={{ appearance, mode, colorSet, update, reloadColors }}>{children}</AppearanceContext>;
}

export function useAppearance(): AppearanceContextValue {
  const value = use(AppearanceContext);
  if (value === null) throw new Error("useAppearance must be used inside <AppearanceProvider>");
  return value;
}
