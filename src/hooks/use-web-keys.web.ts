import { useEffect, useRef } from "react";

import { keyAction, type KeyMap } from "@/lib/webKeys";

/** Web: runs the action of a pressed key while `enabled` (e.g. arrows and Escape in the story viewer). */
export function useWebKeys(map: KeyMap, enabled: boolean): void {
  const latest = useRef(map);
  useEffect(() => {
    latest.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target !== null && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const action = keyAction({ key: event.key, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, editable }, latest.current);
      if (action === null) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
