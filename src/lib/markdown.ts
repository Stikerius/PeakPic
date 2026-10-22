/**
 * A deliberately small Markdown parser for the legal texts: headings (#, ##, ###), paragraphs,
 * bullet and numbered lists, block quotes, horizontal rules and **bold** inline. Everything else
 * stays plain text. No HTML, no links that open anything: safe to render as React Native text.
 */

export type InlineSpan = { text: string; bold: boolean };

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "bullet"; items: InlineSpan[][] }
  | { kind: "numbered"; items: InlineSpan[][] }
  | { kind: "quote"; spans: InlineSpan[] }
  | { kind: "rule" };

/** Splits "**bold**" markers into spans; unmatched markers stay as text. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const parts = text.split("**");
  // An odd number of parts means every opening ** has a closing one.
  if (parts.length % 2 === 0) return [{ text, bold: false }];
  parts.forEach((part, index) => {
    if (part !== "") spans.push({ text: part, bold: index % 2 === 1 });
  });
  return spans;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { kind: "bullet" | "numbered"; items: string[] } | null = null;
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
    if (list !== null) {
      blocks.push({ kind: list.kind, items: list.items.map(parseInline) });
      list = null;
    }
    if (quote.length > 0) {
      blocks.push({ kind: "quote", spans: parseInline(quote.join(" ")) });
      quote = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, spans: parseInline(heading[2] ?? "") });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    if (line.startsWith(">")) {
      if (paragraph.length > 0 || list !== null) flush();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      const kind = bullet !== null ? "bullet" : "numbered";
      if (paragraph.length > 0 || quote.length > 0 || (list !== null && list.kind !== kind)) flush();
      if (list === null) list = { kind, items: [] };
      list.items.push(item[1] ?? "");
      continue;
    }
    if (list !== null && /^\s{2,}/.test(raw)) {
      // Continuation of the last list item.
      const items = list.items;
      items[items.length - 1] = `${items[items.length - 1] ?? ""} ${line.trim()}`;
      continue;
    }
    if (list !== null || quote.length > 0) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
