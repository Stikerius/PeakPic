/**
 * The chat list, the pure part (unit tested).
 */

/**
 * Whether a chat appears in my list: always, unless I deleted it for me ("Chat löschen") and
 * nobody has written since (then I see no message of it).
 */
export function showInChatList(clearedByMe: boolean, hasVisibleMessage: boolean): boolean {
  return !clearedByMe || hasVisibleMessage;
}
