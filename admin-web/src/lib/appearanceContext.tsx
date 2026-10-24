import { createContext, use, useCallback, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  LEGACY_THEME_KEY,
  STORAGE_KEY,
  parseAppearance,
  resolveMode,
  serializeAppearance,
  type Appearance,
} from "./appearance";
import type { BrandMode } from "./brand";
import { applyTokens, tokensFor } from "./tokens";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStored(): Appearance {
  try {
    return parseAppearance(window.localStorage.getItem(STORAGE_KEY), window.localStorage.getItem(LEGACY_THEME_KEY));
  } catch {
    return parseAppearance(null);
  }
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Puts the look on the document: data attributes for the layout rules, tokens for the colours. */
function applyToDocument(appearance: Appearance, mode: BrandMode): void {
  const root = document.documentElement;
  root.dataset.style = appearance.style;
  root.dataset.theme = mode;
  root.dataset.palette = appearance.palette;
  root.dataset.ambient = appearance.ambient;
  root.style.colorScheme = mode;
  applyTokens(root, tokensFor(appearance.style, mode, appearance.palette));
}

/** Before React renders the first time (no flash in the wrong colours). */
export function applyInitialAppearance(): void {
  const appearance = readStored();
  applyToDocument(appearance, resolveMode(appearance.mode, window.matchMedia(DARK_QUERY).matches));
}

type AppearanceContextValue = {
  appearance: Appearance;
  /** The mode actually shown (System resolved). */
  mode: BrandMode;
  update: (change: Partial<Appearance>) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readStored);
  const systemDark = useSyncExternalStore(subscribeSystem, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const mode = resolveMode(appearance.mode, systemDark);

  useLayoutEffect(() => {
    applyToDocument(appearance, mode);
  }, [appearance, mode]);

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

  return <AppearanceContext value={{ appearance, mode, update }}>{children}</AppearanceContext>;
}

export function useAppearance(): AppearanceContextValue {
  const value = use(AppearanceContext);
  if (value === null) throw new Error("useAppearance must be used inside <AppearanceProvider>");
  return value;
}
