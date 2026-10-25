import type { RefObject } from "react";
import type { View } from "react-native";

/** Native: no right click (long press opens the menu). The web version listens to "contextmenu". */
export function useContextMenu(_ref: RefObject<View | null>, _onMenu: (pageY: number) => void): void {}
