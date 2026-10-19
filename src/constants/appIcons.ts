import blueBlack from "../../assets/peakpic-icons/blue_black.png";
import coral from "../../assets/peakpic-icons/coral.png";
import defaultBw from "../../assets/peakpic-icons/default_bw.png";
import duotone from "../../assets/peakpic-icons/duotone.png";
import minimalTeal from "../../assets/peakpic-icons/minimal_teal.png";
import neonNavy from "../../assets/peakpic-icons/neon_navy.png";
import outline from "../../assets/peakpic-icons/outline.png";
import pastel from "../../assets/peakpic-icons/pastel.png";
import popart from "../../assets/peakpic-icons/popart.png";
import redBlack from "../../assets/peakpic-icons/red_black.png";
import sunset from "../../assets/peakpic-icons/sunset.png";

export type AppIconOption = {
  /** File name in assets/peakpic-icons without extension. */
  id: string;
  /**
   * Native name for setAlternateAppIcon(); null = default icon. expo-alternate-app-icons
   * turns names into PascalCase at prebuild, so these must match the names in app.json.
   */
  nativeName: string | null;
  label: string;
  preview: number;
};

export const DEFAULT_APP_ICON: AppIconOption = {
  id: "default_bw",
  nativeName: null,
  label: "Standard",
  preview: defaultBw,
};

export const APP_ICONS: readonly AppIconOption[] = [
  DEFAULT_APP_ICON,
  { id: "coral", nativeName: "Coral", label: "Koralle", preview: coral },
  { id: "blue_black", nativeName: "BlueBlack", label: "Blau-Schwarz", preview: blueBlack },
  { id: "red_black", nativeName: "RedBlack", label: "Rot-Schwarz", preview: redBlack },
  { id: "duotone", nativeName: "Duotone", label: "Duotone", preview: duotone },
  { id: "outline", nativeName: "Outline", label: "Outline", preview: outline },
  { id: "neon_navy", nativeName: "NeonNavy", label: "Neon Navy", preview: neonNavy },
  { id: "sunset", nativeName: "Sunset", label: "Sunset", preview: sunset },
  { id: "minimal_teal", nativeName: "MinimalTeal", label: "Minimal Teal", preview: minimalTeal },
  { id: "pastel", nativeName: "Pastel", label: "Pastell", preview: pastel },
  { id: "popart", nativeName: "Popart", label: "Pop-Art", preview: popart },
];

/** The option for a native icon name (null or unknown = default). */
export function appIconForNativeName(nativeName: string | null): AppIconOption {
  return APP_ICONS.find((icon) => icon.nativeName === nativeName) ?? DEFAULT_APP_ICON;
}
