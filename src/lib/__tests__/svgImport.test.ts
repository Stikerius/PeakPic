import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { APP_LOGO_SPEC, fitViewBox, suggestShapeRoles, validateLogoSpec, type LogoSpec } from "../../../shared/brand/logoSpec";
import { cleanFileName, importSvg, parseTransform } from "../../../supabase/functions/_shared/svgImport";

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function ok(source: string) {
  const result = importSvg(source);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

function refused(source: string): string {
  const result = importSvg(source);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.code;
}

describe("valid files", () => {
  it("a path with a hole (evenodd)", () => {
    const r = ok(svg('<path fill-rule="evenodd" d="M10 10H90V90H10Z M30 30H70V70H30Z"/>'));
    expect(r.shapes).toEqual([
      { type: "path", d: "M10 10H90V90H10Z M30 30H70V70H30Z", role: "fill", transform: [1, 0, 0, 1, 0, 0], fillRule: "evenodd" },
    ]);
    expect(r.viewBox).toEqual([0, 0, 100, 100]);
  });

  it("a circle", () => {
    const r = ok(svg('<circle cx="50" cy="50" r="20" fill="#f00"/>'));
    expect(r.shapes[0]).toEqual({ type: "circle", cx: 50, cy: 50, r: 20, role: "fill", transform: [1, 0, 0, 1, 0, 0] });
    expect(r.fills).toEqual(["#ff0000"]);
  });

  it("a group with nested transforms becomes one matrix", () => {
    const r = ok(svg('<g transform="translate(10 20)"><g transform="scale(2)"><rect x="1" y="1" width="5" height="5" rx="1"/></g></g>'));
    expect(r.shapes[0]).toMatchObject({ type: "rect", x: 1, y: 1, width: 5, height: 5, rx: 1, ry: 1, transform: [2, 0, 0, 2, 10, 20] });
  });

  it("rotate, skew and matrix", () => {
    expect(parseTransform("rotate(90)").map((n) => Math.round(n * 1e9) / 1e9)).toEqual([0, 1, -1, 0, 0, 0]);
    expect(parseTransform("matrix(1 0 0 1 5 6) translate(1,1)")).toEqual([1, 0, 0, 1, 6, 7]);
    expect(parseTransform("skewX(45)")[2]).toBeCloseTo(1);
  });

  it("outlines, all shape types, title and desc, xml declaration, empty defs, comments", () => {
    const r = ok(
      `<?xml version="1.0" encoding="UTF-8"?><!-- exported -->\n${svg(
        '<title>Logo</title><desc>Beschreibung &amp; mehr</desc><defs></defs>' +
          '<ellipse cx="5" cy="5" rx="2" ry="3"/><line x1="0" y1="0" x2="9" y2="9" stroke="#000" stroke-width="3"/>' +
          '<polygon points="0,0 10,0 10,10"/><polyline points="0 0 5 5" fill="none" stroke="black"/>',
      )}`,
    );
    expect(r.shapes.map((s) => [s.type, s.role])).toEqual([
      ["ellipse", "fill"],
      ["line", "fill"],
      ["polygon", "fill"],
      ["polyline", "stroke"],
    ]);
    expect(r.shapes[3]).toMatchObject({ strokeWidth: 1 });
  });

  it("leaves out what draws nothing", () => {
    const r = ok(svg('<circle cx="5" cy="5" r="5"/><circle r="0"/><rect width="5" height="5" display="none"/><path d="M0 0L5 5" fill="none"/>'));
    expect(r.shapes).toHaveLength(1);
    expect(r.ignored).toBe(3);
  });

  it("the app icon becomes the app logo, with the background left out and the lens hole cut out", () => {
    const source = readFileSync(join(__dirname, "../../../assets/peakpic-icons/svg-quellen/default_bw.svg"), "utf8");
    const r = ok(source);
    const spec: LogoSpec = { version: 1, viewBox: r.viewBox ?? [0, 0, 1, 1], shapes: r.shapes };
    expect(validateLogoSpec(spec).ok).toBe(true);
    const suggestions = suggestShapeRoles(spec, r.fills);
    expect(suggestions.map((s) => (s.omit ? "omit" : s.role))).toEqual(["omit", "fill", "fill", "fill", "cutout"]);
    const kept = spec.shapes.filter((_, i) => !suggestions[i]?.omit).map((s, i) => ({ ...s, role: suggestions[i + 1]?.role ?? s.role }));
    expect(kept.map((s) => s.role)).toEqual(APP_LOGO_SPEC.shapes.map((s) => s.role));
    const fitted = fitViewBox(kept, 0);
    expect(fitted?.[2]).toBeGreaterThan(100);
  });
});

describe("refused files", () => {
  it("script element", () => expect(refused(svg("<script>alert(1)</script>"))).toBe("contains_script"));
  it("onload attribute", () => expect(refused(svg('<circle r="5" onload="alert(1)"/>'))).toBe("event_attribute"));
  it("onload on the root", () => expect(refused('<svg onload="alert(1)"><circle r="5"/></svg>')).toBe("event_attribute"));
  it("foreignObject", () => expect(refused(svg("<foreignObject><div/></foreignObject>"))).toBe("forbidden_element"));
  it("image with a data URI", () => expect(refused(svg('<image href="data:image/png;base64,AAAA"/>'))).toBe("contains_reference"));
  it("image without href", () => expect(refused(svg('<image width="5" height="5"/>'))).toBe("contains_image"));
  it("use with an external reference", () => expect(refused(svg('<use xlink:href="https://example.invalid/a.svg#x"/>'))).toBe("contains_reference"));
  it("use without href", () => expect(refused(svg("<use/>"))).toBe("contains_reference"));
  it("style element with url()", () => expect(refused(svg("<style>path{fill:url(https://example.invalid)}</style>"))).toBe("contains_style"));
  it("style attribute", () => expect(refused(svg('<circle r="5" style="fill:red"/>'))).toBe("contains_style"));
  it("fill with url()", () => expect(refused(svg('<circle r="5" fill="url(#g)"/>'))).toBe("contains_reference"));
  it("javascript in an attribute", () => expect(refused(svg('<circle r="5" fill="javascript:alert(1)"/>'))).toBe("contains_reference"));
  it("text", () => expect(refused(svg("<text>Hallo</text>"))).toBe("contains_text"));
  it("loose text", () => expect(refused(svg("Hallo"))).toBe("contains_text"));
  it("filter, mask, clipPath, pattern, gradient", () => {
    for (const el of ["filter", "mask", "clipPath", "pattern", "marker", "linearGradient"]) expect(refused(svg(`<${el}/>`))).toBe("contains_effect");
  });
  it("animation, links, switch", () => {
    for (const el of ['animate attributeName="r"', "set", "a", "switch", "iframe"]) expect(refused(svg(`<${el}/>`))).toBe("forbidden_element");
  });
  it("editor data", () => expect(refused(svg("<sodipodi:namedview/>"))).toBe("editor_data"));
  it("defs with content", () => expect(refused(svg('<defs><circle r="5"/></defs>'))).toBe("contains_effect"));

  it("DOCTYPE with entity expansion (Billion Laughs)", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><svg><path d="M0 0" fill="&lol2;"/></svg>`;
    expect(refused(bomb)).toBe("doctype");
  });
  it("unknown entities are never expanded", () => expect(refused(svg('<circle r="5" fill="&lol;"/>'))).toBe("unknown_entity"));
  it("processing instructions", () => expect(refused(svg('<?xml-stylesheet href="a.css"?><circle r="5"/>'))).toBe("processing_instruction"));
  it("CDATA", () => expect(refused(svg("<![CDATA[<script>alert(1)</script>]]>"))).toBe("cdata"));

  it("too large", () => expect(refused(svg(`<path d="M0 0${" L1 1".repeat(50_000)}"/>`))).toBe("too_large"));
  it("a huge path", () => expect(refused(svg(`<path d="M0 0${"L1 1".repeat(5_000)}"/>`))).toBe("too_complex"));
  it("too many shapes", () => expect(refused(svg('<circle r="1"/>'.repeat(101)))).toBe("too_complex"));
  it("deep nesting", () => expect(refused(svg(`${"<g>".repeat(13)}<circle r="5"/>${"</g>".repeat(13)}`))).toBe("too_deep"));
  it("letters outside the path allowlist", () => expect(refused(svg('<path d="M0 0 L10 10 X5 5"/>'))).toBe("invalid_path"));
  it("NaN and infinity", () => {
    expect(refused(svg('<circle r="NaN"/>'))).toBe("invalid_number");
    expect(refused(svg('<circle r="Infinity"/>'))).toBe("invalid_number");
  });
  it("extremely large numbers", () => {
    expect(refused(svg('<circle r="1e308"/>'))).toBe("number_out_of_range");
    expect(refused(svg('<circle r="5" transform="scale(1e6)"/>'))).toBe("number_out_of_range");
    expect(refused(svg('<circle r="5" transform="scale(5000)"/>'))).toBe("transform_out_of_range");
  });
  it("relative units", () => expect(refused(svg('<circle r="50%"/>'))).toBe("relative_units"));
  it("broken markup", () => {
    expect(refused('<svg><circle r="5"></svg>')).toBe("malformed");
    expect(refused('<svg><circle r=5/></svg>')).toBe("malformed");
    expect(refused("<html></html>")).toBe("not_svg");
    expect(refused(svg('<svg><circle r="5"/></svg>'))).toBe("nested_svg");
  });
  it("no visible shapes", () => expect(refused(svg('<circle r="0"/>'))).toBe("no_shapes"));

  it("never quotes the file in the message", () => {
    const secret = "SECRETCONTENT";
    for (const source of [svg(`<text>${secret}</text>`), svg(`<circle r="5" onload="${secret}"/>`), svg(`<path d="M0 0 ${secret}"/>`)]) {
      const result = importSvg(source);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toContain(secret);
    }
  });
});

describe("file names for the log", () => {
  it("no folders, safe characters, at most 100", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("Logo <neu>.svg")).toBe("Logo _neu_.svg");
    expect(cleanFileName(`${"a".repeat(200)}.svg`)).toHaveLength(100);
    expect(cleanFileName(42)).toBe("logo.svg");
  });
});

describe("the edge function's copy of the logo spec", () => {
  it("is identical to shared/brand/logoSpec.ts", () => {
    const shared = readFileSync(join(__dirname, "../../../shared/brand/logoSpec.ts"), "utf8");
    const copy = readFileSync(join(__dirname, "../../../supabase/functions/_shared/brandLogoSpec.ts"), "utf8");
    expect(copy).toBe(shared);
  });
});
