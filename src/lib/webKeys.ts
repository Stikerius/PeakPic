// Keyboard shortcuts for the web build (story viewer and similar), the pure part (tested).

export type KeyMap = Partial<Record<string, () => void>>;
export type KeyInfo = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; editable: boolean };

/**
 * The action for a key press, or null. Never while typing in a field, never with Ctrl, Cmd or
 * Alt (browser shortcuts stay as they are).
 */
export function keyAction(info: KeyInfo, map: KeyMap): (() => void) | null {
  if (info.editable || info.ctrlKey || info.metaKey || info.altKey) return null;
  return map[info.key] ?? null;
}
