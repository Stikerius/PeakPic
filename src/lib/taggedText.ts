/**
 * @mentions and #hashtags in user text: parsing for display, and the token being typed for
 * suggestions. Pure functions, unit tested. The database extracts hashtags with the same rule.
 */

export type TagTrigger = "@" | "#";

export type TextSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; username: string }
  | { kind: "hashtag"; value: string; tag: string };

/** Usernames: like profiles.username (a-z, 0-9, _ and .), 3–20 characters. */
const USERNAME_CHARS = "a-z0-9_.";
/** Hashtags: letters (incl. äöüß), digits and _, lowercase. Same rule as in schema.sql. */
const HASHTAG_CHARS = "a-z0-9_äöüß";
export const HASHTAG_MAX_LENGTH = 50;

const TOKEN_PATTERN = new RegExp(`([@#])([${USERNAME_CHARS}äöüß]+)`, "gi");

/** Lowercase, only letters/digits/_; null if nothing is left. */
export function normalizeHashtag(input: string): string | null {
  const tag = input
    .toLowerCase()
    .replace(/^#/, "")
    .replace(new RegExp(`[^${HASHTAG_CHARS}]`, "g"), "")
    .slice(0, HASHTAG_MAX_LENGTH);
  return tag.length > 0 ? tag : null;
}

function isBoundary(text: string, index: number): boolean {
  // A trigger counts at the start or after whitespace / punctuation, not inside a word or e-mail.
  return index === 0 || !/[a-z0-9_.@#äöüß]/i.test(text.charAt(index - 1));
}

/** Splits text into plain parts, @mentions and #hashtags. */
export function parseTaggedText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    const trigger = match[1];
    const body = match[2] ?? "";
    if (!isBoundary(text, index)) continue;
    let token: TextSegment | null = null;
    if (trigger === "@") {
      // Usernames can't contain umlauts and don't end with a dot ("@lena." ends a sentence).
      const username = body.toLowerCase().match(new RegExp(`^[${USERNAME_CHARS}]+`))?.[0]?.replace(/\.+$/, "") ?? "";
      if (username.length >= 3 && username.length <= 20) {
        token = { kind: "mention", value: `@${username}`, username };
      }
    } else {
      const tag = normalizeHashtag(body.replace(/\./g, ""));
      if (tag !== null && !body.startsWith(".")) {
        const raw = body.match(new RegExp(`^[${HASHTAG_CHARS}]+`, "i"))?.[0] ?? "";
        if (raw.length > 0) token = { kind: "hashtag", value: `#${raw}`, tag: raw.toLowerCase() };
      }
    }
    if (token === null) continue;
    if (index > last) segments.push({ kind: "text", value: text.slice(last, index) });
    segments.push(token);
    last = index + token.value.length;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  return segments;
}

/** Distinct hashtags in a text (normalized). */
export function extractHashtags(text: string): string[] {
  return [
    ...new Set(
      parseTaggedText(text).flatMap((segment) => (segment.kind === "hashtag" ? [segment.tag] : [])),
    ),
  ];
}

/** Distinct mentioned usernames in a text. */
export function extractMentions(text: string): string[] {
  return [
    ...new Set(
      parseTaggedText(text).flatMap((segment) => (segment.kind === "mention" ? [segment.username] : [])),
    ),
  ];
}

export type ActiveToken = { trigger: TagTrigger; query: string; start: number; end: number };

/**
 * The @ or # word the cursor is in (for suggestions), e.g. "Hallo @le|" → { "@", "le" }.
 * Null if the cursor is not right after/inside such a word.
 */
export function activeToken(text: string, cursor: number): ActiveToken | null {
  const before = text.slice(0, cursor);
  const match = before.match(new RegExp(`([@#])([${USERNAME_CHARS}äöüß]*)$`, "i"));
  if (match === null || match.index === undefined) return null;
  const start = match.index;
  if (!isBoundary(text, start)) return null;
  const trigger = match[1] === "@" ? "@" : "#";
  // The word may continue after the cursor ("@le|na").
  const after = text.slice(cursor).match(new RegExp(`^[${USERNAME_CHARS}äöüß]*`, "i"))?.[0] ?? "";
  return { trigger, query: (match[2] ?? "").toLowerCase(), start, end: cursor + after.length };
}

/** Replaces the active token with the chosen suggestion plus a space; returns text and cursor. */
export function applySuggestion(text: string, token: ActiveToken, value: string): { text: string; cursor: number } {
  const insert = `${token.trigger}${value} `;
  const rest = text.slice(token.end).replace(/^ /, "");
  return { text: text.slice(0, token.start) + insert + rest, cursor: token.start + insert.length };
}
