import type { KeyMap } from "@/lib/webKeys";

/** Native: no hardware keyboard shortcuts (the web version listens to the keyboard). */
export function useWebKeys(_map: KeyMap, _enabled: boolean): void {}
