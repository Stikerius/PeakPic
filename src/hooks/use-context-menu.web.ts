import { useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";

/**
 * Web: a right click on this element opens the app's own menu (like a long press) instead of the
 * browser's. Only here; everywhere else the browser menu stays.
 */
export function useContextMenu(ref: RefObject<View | null>, onMenu: (pageY: number) => void): void {
  const latest = useRef(onMenu);
  useEffect(() => {
    latest.current = onMenu;
  });
  useEffect(() => {
    // react-native-web renders a View as a DOM element.
    const element = ref.current as unknown as HTMLElement | null;
    if (element === null || typeof element.addEventListener !== "function") return;
    const handler = (event: MouseEvent) => {
      event.preventDefault();
      latest.current(event.pageY);
    };
    element.addEventListener("contextmenu", handler);
    return () => element.removeEventListener("contextmenu", handler);
  }, [ref]);
}
