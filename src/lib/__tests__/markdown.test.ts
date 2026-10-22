import { describe, expect, it } from "@jest/globals";

import { parseInline, parseMarkdown } from "@/lib/markdown";

describe("parseInline", () => {
  it("marks bold parts", () => {
    expect(parseInline("Das ist **wichtig** hier")).toEqual([
      { text: "Das ist ", bold: false },
      { text: "wichtig", bold: true },
      { text: " hier", bold: false },
    ]);
  });

  it("keeps unmatched markers as text", () => {
    expect(parseInline("a ** b")).toEqual([{ text: "a ** b", bold: false }]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs and lists", () => {
    const blocks = parseMarkdown("# Titel\n\nErster Satz\nzweiter Satz.\n\n- eins\n- zwei\n\n1. a\n2. b");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "bullet", "numbered"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", spans: [{ text: "Erster Satz zweiter Satz.", bold: false }] });
  });

  it("never produces HTML: tags stay text", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([{ kind: "paragraph", spans: [{ text: "<script>alert(1)</script>", bold: false }] }]);
  });

  it("reads quotes and rules", () => {
    expect(parseMarkdown("> ENTWURF\n\n---").map((b) => b.kind)).toEqual(["quote", "rule"]);
  });
});
