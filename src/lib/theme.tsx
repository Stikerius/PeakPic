import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";

import {
  fontSize,
  palettes,
  radius,
  spacing,
  typography,
  type ColorScheme,
  type Palette,
  type ThemePreference,
} from "@/constants/theme";

const STORAGE_KEY = "peakpic.themePreference";

export type Theme = {
  /** The scheme actually shown right now. */
  scheme: ColorScheme;
  /** What the user picked (System / Hell / Dunkel). */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  typography: typeof typography;
};

const ThemeContext = createContext<Theme | null>(null);

function isPreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Applies the stored appearance. The native override (Appearance.setColorScheme)
 * makes alerts, keyboards, pickers and native headers follow the app's choice;
 * with "system" it is cleared so the app follows iOS live.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [loaded, setLoaded] = useState(false);
  const systemScheme = useColorScheme();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isPreference(stored)) setPreferenceState(stored);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  }, [preference]);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }

  const scheme: ColorScheme =
    preference === "system" ? (systemScheme === "light" ? "light" : "dark") : preference;

  const theme: Theme = {
    scheme,
    preference,
    setPreference,
    colors: palettes[scheme],
    spacing,
    radius,
    fontSize,
    typography,
  };

  // Render nothing (the splash screen stays up) until the stored choice is
  // known, so the app doesn't flash in the wrong scheme.
  if (!loaded) return null;
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

/**
 * Forces the dark palette for everything inside, whatever the app setting.
 * Used for UI that sits on photos (camera, story viewer, editors, photo
 * viewer), which stays dark like the iOS camera. Screens set their own
 * status bar style.
 */
export function DarkScheme({ children }: { children: ReactNode }) {
  const parent = useTheme();
  const theme: Theme = { ...parent, scheme: "dark", colors: palettes.dark };
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  const theme = use(ThemeContext);
  if (theme === null) throw new Error("useTheme must be used inside <ThemeProvider>");
  return theme;
}

/**
 * Defines a stylesheet that depends on the active palette. The sheet is built
 * once per scheme up front, so calling the returned hook is cheap.
 *
 *   const useStyles = makeStyles(({ colors }) => StyleSheet.create({ … }));
 *   function Screen() { const styles = useStyles(); … }
 */
export function makeStyles<T>(factory: (theme: { colors: Palette; scheme: ColorScheme }) => T): () => T {
  const sheets: Record<ColorScheme, T> = {
    light: factory({ colors: palettes.light, scheme: "light" }),
    dark: factory({ colors: palettes.dark, scheme: "dark" }),
  };
  return function useStyles() {
    return sheets[useTheme().scheme];
  };
}
