import type { PressableStateCallbackType } from "react-native";

/** Mouse over a Pressable: only react-native-web reports it (never on iOS/Android). */
export function isHovered(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}
