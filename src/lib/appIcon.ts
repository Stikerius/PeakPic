import { requireOptionalNativeModule } from "expo";

type AppIconsLibrary = typeof import("expo-alternate-app-icons");

let library: Promise<AppIconsLibrary> | null = null;

/**
 * Loads expo-alternate-app-icons only if its native module is in the binary.
 * Importing it directly would throw at startup in Expo Go (the library calls
 * requireNativeModule when imported), taking the whole app down. Returns null there.
 */
export function loadAppIconLibrary(): Promise<AppIconsLibrary | null> {
  if (requireOptionalNativeModule("ExpoAlternateAppIcons") === null) return Promise.resolve(null);
  library ??= import("expo-alternate-app-icons");
  return library;
}
