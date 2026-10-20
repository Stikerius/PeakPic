/** Quick reactions offered in the chat; any other single emoji can be typed in. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "💪"] as const;

const ZWJ = 0x200d;
const VARIATION_SELECTORS = [0xfe0e, 0xfe0f];
const KEYCAP = 0x20e3;

function inRange(cp: number, from: number, to: number): boolean {
  return cp >= from && cp <= to;
}

function isRegionalIndicator(cp: number): boolean {
  return inRange(cp, 0x1f1e6, 0x1f1ff);
}

/** Code points that can start an emoji (pictographs, symbols, dingbats, ...). */
function isEmojiBase(cp: number): boolean {
  return (
    inRange(cp, 0x1f000, 0x1faff) ||
    inRange(cp, 0x2600, 0x27bf) ||
    inRange(cp, 0x2300, 0x23ff) ||
    inRange(cp, 0x2b00, 0x2bff) ||
    inRange(cp, 0x2190, 0x21ff) ||
    inRange(cp, 0x25aa, 0x25fe) ||
    inRange(cp, 0x2934, 0x2935) ||
    [0x00a9, 0x00ae, 0x203c, 0x2049, 0x2122, 0x2139, 0x3030, 0x303d, 0x3297, 0x3299].includes(cp)
  );
}

/** Code points that modify the preceding emoji: variation selectors, skin tones, tag sequences. */
function isModifier(cp: number): boolean {
  return VARIATION_SELECTORS.includes(cp) || inRange(cp, 0x1f3fb, 0x1f3ff) || inRange(cp, 0xe0020, 0xe007f);
}

/**
 * True if `text` is exactly one emoji: a single pictograph with optional modifiers, a
 * ZWJ sequence (👨‍👩‍👧), a flag (two regional indicators) or a keycap (1️⃣).
 * Written without \p{...} regexes so it does not depend on the JS engine's Unicode tables.
 */
export function isSingleEmoji(text: string): boolean {
  const cps = Array.from(text.trim(), (ch) => ch.codePointAt(0) ?? 0);
  if (cps.length === 0) return false;

  if (cps.length === 2 && cps.every(isRegionalIndicator)) return true;

  const first = cps[0] ?? 0;
  const isKeycapBase = (first >= 0x30 && first <= 0x39) || first === 0x23 || first === 0x2a;
  if (isKeycapBase) {
    const rest = cps.slice(1).filter((cp) => !VARIATION_SELECTORS.includes(cp));
    return rest.length === 1 && rest[0] === KEYCAP;
  }

  let expectBase = true;
  for (const cp of cps) {
    if (expectBase) {
      if (!isEmojiBase(cp) || isRegionalIndicator(cp)) return false;
      expectBase = false;
    } else if (cp === ZWJ) {
      expectBase = true;
    } else if (!isModifier(cp)) {
      return false;
    }
  }
  return !expectBase; // must not end with a ZWJ
}
