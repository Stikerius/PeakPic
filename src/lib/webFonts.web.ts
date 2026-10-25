import Ionicons from "@expo/vector-icons/Ionicons";
import { Asset } from "expo-asset";

/**
 * Web: expo-font would add the icon font as a <style> with text, which the web app's strict
 * Content-Security-Policy (no 'unsafe-inline') blocks. Instead the @font-face rules go into the
 * same style element through the CSSOM (allowed); expo-font then finds them and adds nothing.
 * Runs once, before the first icon renders.
 */
export function registerWebFonts(): void {
  if (typeof document === "undefined" || document.getElementById("expo-generated-fonts") !== null) return;
  const style = document.createElement("style");
  style.id = "expo-generated-fonts";
  document.head.appendChild(style);
  const sheet = style.sheet;
  if (sheet === null) return;
  for (const [family, source] of Object.entries(Ionicons.font as Record<string, number>)) {
    const uri = Asset.fromModule(source).uri;
    if (typeof uri !== "string" || uri === "") continue;
    sheet.insertRule(`@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(uri)});font-display:auto}`, sheet.cssRules.length);
  }
}
