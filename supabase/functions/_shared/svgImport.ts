// Pure: turns an uploaded SVG file into the shapes of a logo spec (no Deno APIs, no imports, unit
// tested in src/lib/__tests__/svgImport.test.ts). Every file is treated as hostile:
//  * its own small XML reader, no DOM and no entity expansion; DOCTYPE, ENTITY, processing
//    instructions (except the XML declaration at the very start), CDATA, unknown entities and
//    deep nesting are refused
//  * only svg, g, path, circle, ellipse, rect, line, polyline, polygon, title and desc (ignored),
//    plus an empty defs; everything else is refused, with a reason that never quotes the file
//  * only geometry, transform, fill-rule, stroke-width and fill/stroke (to see "none" and to
//    suggest cut-outs) are read; event attributes, style, references (href, url(), javascript:,
//    data:) are refused; every other attribute is ignored
//  * numbers are parsed strictly and limited; transforms (also nested in groups) become one matrix
// The result is checked again with validateLogoSpec before anything is returned or stored.

export const SVG_LIMITS = {
  maxBytes: 200 * 1024,
  maxDepth: 12,
  maxShapes: 100,
  maxPathChars: 20_000,
  maxPathCommands: 4_000,
  maxTotalCommands: 8_000,
  maxAbs: 100_000,
  maxLinear: 1_000,
} as const;

type Matrix = [number, number, number, number, number, number];
type Role = "fill" | "cutout" | "stroke";

type Geometry =
  | { type: "path"; d: string }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "rect"; x: number; y: number; width: number; height: number; rx: number; ry: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "polygon" | "polyline"; points: number[] };

export type ImportedShape = { role: Role; transform: Matrix; strokeWidth?: number; fillRule?: "evenodd" } & Geometry;

export type SvgImport =
  | {
      ok: true;
      viewBox: [number, number, number, number] | null;
      shapes: ImportedShape[];
      /** Fill colour each shape had in the file (normalized), only to suggest cut-outs. */
      fills: (string | null)[];
      /** Shapes left out (invisible: display none, no fill and no stroke, zero size). */
      ignored: number;
    }
  | { ok: false; code: string; message: string };

class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function refuse(code: string, message: string): never {
  throw new ImportError(code, message);
}

const SHAPES = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const IGNORED_WITH_TEXT = new Set(["title", "desc"]);

/** Specific reasons for elements that are not allowed. */
function forbiddenElement(name: string): never {
  const n = name.toLowerCase();
  if (n === "text" || n === "tspan" || n === "textpath") {
    refuse("contains_text", "Die Datei enthält Text. Bitte den Text im Grafikprogramm in Pfade umwandeln.");
  }
  if (n === "image") refuse("contains_image", "Die Datei enthält ein eingebettetes Bild. Nur Vektorformen sind erlaubt.");
  if (n === "script") refuse("contains_script", "Die Datei enthält ein Skript.");
  if (n === "style") refuse("contains_style", "Die Datei enthält Stilangaben (style). Bitte als einfaches SVG ohne CSS exportieren.");
  if (n === "use" || n === "symbol") {
    refuse("contains_reference", "Die Datei verwendet Verweise (use/symbol). Bitte die Verweise im Grafikprogramm auflösen.");
  }
  if (n === "filter" || n === "mask" || n === "clippath" || n === "pattern" || n === "marker" || n.endsWith("gradient")) {
    refuse(
      "contains_effect",
      "Die Datei enthält Effekte, Masken, Muster oder Verläufe. Bitte die Formen im Grafikprogramm umwandeln (Konturen erweitern, Masken anwenden).",
    );
  }
  if (n === "foreignobject" || n === "iframe" || n === "a" || n === "switch" || n === "set" || n.startsWith("animate")) {
    refuse("forbidden_element", "Die Datei enthält nicht erlaubte Elemente (zum Beispiel Links, Animationen oder eingebettete Inhalte).");
  }
  if (n.includes(":") || n === "metadata" || n === "sodipodi" || n === "namedview") {
    refuse("editor_data", "Die Datei enthält Daten eines Grafikprogramms. Bitte als „einfaches“ oder „optimiertes“ SVG exportieren.");
  }
  refuse("unsupported_element", "Die Datei enthält nicht unterstützte Elemente. Erlaubt sind nur Pfade, Kreise, Ellipsen, Rechtecke, Linien und Polygone.");
}

// ------------------------------------------------------------------ numbers and transforms

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNumber(raw: string, what: string): number {
  let value = raw.trim();
  if (value.endsWith("px")) value = value.slice(0, -2).trim();
  if (!NUMBER.test(value)) {
    if (/%|em|ex|pt|pc|cm|mm|in$/.test(value)) refuse("relative_units", `${what}: nur Zahlen ohne Einheit oder mit px sind erlaubt.`);
    refuse("invalid_number", `${what}: ungültige Zahl.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > SVG_LIMITS.maxAbs) refuse("number_out_of_range", `${what}: Zahl ausserhalb der Grenzen.`);
  return n;
}

function numberList(raw: string, what: string): number[] {
  const parts = raw.trim().split(/[\s,]+/).filter((p) => p !== "");
  return parts.map((p) => parseNumber(p, what));
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** transform="..." as one matrix: translate, scale, rotate, skewX, skewY, matrix in order. */
export function parseTransform(raw: string): Matrix {
  const text = raw.trim();
  if (text === "") return IDENTITY;
  if (text.length > 2_000) refuse("invalid_transform", "Transformation zu lang.");
  const item = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*,?/y;
  let result = IDENTITY;
  item.lastIndex = 0;
  while (item.lastIndex < text.length) {
    const start = item.lastIndex;
    const match = item.exec(text);
    if (match === null || match.index !== start) refuse("invalid_transform", "Ungültige Transformation.");
    const name = match[1] ?? "";
    const args = numberList(match[2] ?? "", "Transformation");
    const rad = (deg: number) => (deg * Math.PI) / 180;
    let m: Matrix;
    if (name === "matrix" && args.length === 6) m = args as Matrix;
    else if (name === "translate" && (args.length === 1 || args.length === 2)) m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
    else if (name === "scale" && (args.length === 1 || args.length === 2)) m = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    else if (name === "rotate" && (args.length === 1 || args.length === 3)) {
      const a = rad(args[0] ?? 0);
      const cx = args[1] ?? 0;
      const cy = args[2] ?? 0;
      const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
      m = multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === "skewX" && args.length === 1) m = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0];
    else if (name === "skewY" && args.length === 1) m = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0];
    else refuse("invalid_transform", "Ungültige Transformation.");
    result = multiply(result, m);
  }
  return result;
}

function checkedMatrix(m: Matrix): Matrix {
  const rounded = m.map((n) => Math.round(n * 1e6) / 1e6) as Matrix;
  const lin = SVG_LIMITS.maxLinear;
  if (
    !rounded.every((n) => Number.isFinite(n)) ||
    rounded.slice(0, 4).some((n) => Math.abs(n) > lin) ||
    rounded.slice(4).some((n) => Math.abs(n) > SVG_LIMITS.maxAbs) ||
    Math.abs(rounded[0] * rounded[3] - rounded[1] * rounded[2]) < 1e-9
  ) {
    refuse("transform_out_of_range", "Eine Transformation liegt ausserhalb der erlaubten Grenzen.");
  }
  return rounded.map((n) => (Object.is(n, -0) ? 0 : n)) as Matrix;
}

// ------------------------------------------------------------------ path data

const PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r,.\-eE]*$/;
const PATH_COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/g;

function checkPath(d: string): string {
  const trimmed = d.trim();
  if (trimmed === "") refuse("invalid_path", "Ein Pfad ist leer.");
  if (trimmed.length > SVG_LIMITS.maxPathChars) refuse("too_complex", "Ein Pfad ist zu lang (höchstens 20 000 Zeichen).");
  if (!PATH_CHARS.test(trimmed)) refuse("invalid_path", "Ein Pfad enthält nicht erlaubte Zeichen.");
  const commands = trimmed.match(PATH_COMMAND)?.length ?? 0;
  if (commands > SVG_LIMITS.maxPathCommands) refuse("too_complex", "Ein Pfad ist zu komplex (höchstens 4000 Befehle).");
  return trimmed;
}

// ------------------------------------------------------------------ the XML reader

type Element = { name: string; attributes: Map<string, string>; selfClosing: boolean };

const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(value: string): string {
  // Anything that looks like an entity but isn't one of these is refused (no expansion at all).
  const stripped = value.replace(ENTITY, "");
  if (stripped.includes("&")) refuse("unknown_entity", "Die Datei enthält unbekannte Entitäten.");
  return value.replace(ENTITY, (_, named: string | undefined, dec: string | undefined, hex: string | undefined) => {
    if (named !== undefined) return NAMED[named] ?? "";
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex ?? "0", 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function readTag(text: string, start: number): { element: Element | null; closing: string | null; end: number } {
  // text[start] === "<"
  const close = text[start + 1] === "/";
  const nameMatch = /[A-Za-z_][\w:.-]*/y;
  nameMatch.lastIndex = start + (close ? 2 : 1);
  const name = nameMatch.exec(text)?.[0];
  if (name === undefined) refuse("malformed", "Die Datei ist kein gültiges SVG.");
  let i = nameMatch.lastIndex;
  if (close) {
    while (/\s/.test(text[i] ?? "")) i += 1;
    if (text[i] !== ">") refuse("malformed", "Die Datei ist kein gültiges SVG.");
    return { element: null, closing: name, end: i + 1 };
  }
  const attributes = new Map<string, string>();
  const attribute = /\s+([A-Za-z_][\w:.-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/y;
  for (;;) {
    attribute.lastIndex = i;
    const match = attribute.exec(text);
    if (match === null) break;
    const key = match[1] ?? "";
    if (attributes.has(key)) refuse("malformed", "Die Datei ist kein gültiges SVG (doppeltes Attribut).");
    attributes.set(key, decode(match[3] ?? match[4] ?? ""));
    i = attribute.lastIndex;
  }
  while (/\s/.test(text[i] ?? "")) i += 1;
  if (text.startsWith("/>", i)) return { element: { name, attributes, selfClosing: true }, closing: null, end: i + 2 };
  if (text[i] === ">") return { element: { name, attributes, selfClosing: false }, closing: null, end: i + 1 };
  refuse("malformed", "Die Datei ist kein gültiges SVG (ungültiges Attribut).");
}

function checkAttributes(element: Element): void {
  for (const [key, value] of element.attributes) {
    const k = key.toLowerCase();
    if (k.startsWith("on")) refuse("event_attribute", "Die Datei enthält Ereignis-Attribute (zum Beispiel onload).");
    if (k === "href" || k.endsWith(":href")) refuse("contains_reference", "Die Datei enthält Verweise (href).");
    if (k === "style") refuse("contains_style", "Die Datei enthält Stilangaben (style-Attribut). Bitte als einfaches SVG ohne CSS exportieren.");
    if (/url\s*\(/i.test(value) || /javascript\s*:/i.test(value) || /data\s*:/i.test(value) || /\bexpression\s*\(/i.test(value)) {
      refuse("contains_reference", "Die Datei enthält Verweise auf andere Inhalte (url, javascript oder data).");
    }
  }
}

// ------------------------------------------------------------------ styles inherited from groups

type Paint = { fill: string | null; stroke: string | null; fillRule: string | null; strokeWidth: string | null; hidden: boolean };

function normalizeColor(value: string | null): string | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (v === "white") return "#ffffff";
  if (v === "black") return "#000000";
  return v;
}

function paintOf(element: Element, parent: Paint): Paint {
  const a = element.attributes;
  const display = a.get("display")?.trim().toLowerCase();
  const visibility = a.get("visibility")?.trim().toLowerCase();
  return {
    fill: a.has("fill") ? normalizeColor(a.get("fill") ?? null) : parent.fill,
    stroke: a.has("stroke") ? normalizeColor(a.get("stroke") ?? null) : parent.stroke,
    fillRule: a.get("fill-rule")?.trim().toLowerCase() ?? parent.fillRule,
    strokeWidth: a.get("stroke-width") ?? parent.strokeWidth,
    hidden: parent.hidden || display === "none" || visibility === "hidden",
  };
}

// ------------------------------------------------------------------ shapes

function num(element: Element, key: string, fallback: number | null): number {
  const raw = element.attributes.get(key);
  if (raw === undefined) {
    if (fallback === null) refuse("invalid_shape", `Einer Form fehlt die Angabe ${key}.`);
    return fallback;
  }
  return parseNumber(raw, key);
}

/** null: the shape draws nothing (zero size) and is left out. */
function shapeOf(element: Element): Geometry | null {
  switch (element.name) {
    case "path": {
      const d = element.attributes.get("d");
      if (d === undefined || d.trim() === "") return null;
      return { type: "path", d: checkPath(d) };
    }
    case "circle": {
      const r = num(element, "r", 0);
      return r > 0 ? { type: "circle", cx: num(element, "cx", 0), cy: num(element, "cy", 0), r } : null;
    }
    case "ellipse": {
      const rx = num(element, "rx", 0);
      const ry = num(element, "ry", 0);
      return rx > 0 && ry > 0 ? { type: "ellipse", cx: num(element, "cx", 0), cy: num(element, "cy", 0), rx, ry } : null;
    }
    case "rect": {
      const width = num(element, "width", 0);
      const height = num(element, "height", 0);
      if (width <= 0 || height <= 0) return null;
      // SVG: a missing radius takes the other one; both at most half the side.
      const rxRaw = element.attributes.has("rx") ? num(element, "rx", 0) : null;
      const ryRaw = element.attributes.has("ry") ? num(element, "ry", 0) : null;
      const rx = Math.min(Math.max(rxRaw ?? ryRaw ?? 0, 0), width / 2);
      const ry = Math.min(Math.max(ryRaw ?? rxRaw ?? 0, 0), height / 2);
      return { type: "rect", x: num(element, "x", 0), y: num(element, "y", 0), width, height, rx, ry };
    }
    case "line":
      return { type: "line", x1: num(element, "x1", 0), y1: num(element, "y1", 0), x2: num(element, "x2", 0), y2: num(element, "y2", 0) };
    default: {
      const points = numberList(element.attributes.get("points") ?? "", "points");
      if (points.length % 2 !== 0) refuse("invalid_shape", "Ein Polygon hat eine ungerade Anzahl Koordinaten.");
      if (points.length > 4_000) refuse("too_complex", "Ein Polygon hat zu viele Punkte.");
      if (points.length < 4) return null;
      return { type: element.name as "polygon" | "polyline", points };
    }
  }
}

function viewBoxOf(svg: Element): [number, number, number, number] | null {
  const raw = svg.attributes.get("viewBox");
  if (raw !== undefined) {
    const values = numberList(raw, "viewBox");
    if (values.length !== 4 || (values[2] ?? 0) <= 0 || (values[3] ?? 0) <= 0) refuse("invalid_viewbox", "Ungültige viewBox.");
    return values as [number, number, number, number];
  }
  const width = svg.attributes.get("width");
  const height = svg.attributes.get("height");
  if (width !== undefined && height !== undefined) {
    const w = parseNumber(width, "width");
    const h = parseNumber(height, "height");
    if (w > 0 && h > 0) return [0, 0, w, h];
  }
  return null;
}

/** Reads an SVG file into logo shapes, or refuses it with a reason (never quoting the file). */
export function importSvg(source: string): SvgImport {
  try {
    if (typeof source !== "string" || source.trim() === "") refuse("empty", "Die Datei ist leer.");
    if (new TextEncoder().encode(source).length > SVG_LIMITS.maxBytes) refuse("too_large", "Die Datei ist grösser als 200 KB.");
    if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(source)) {
      refuse("doctype", "Die Datei enthält eine DOCTYPE- oder ENTITY-Angabe. Das ist nicht erlaubt.");
    }
    if (/<!\[CDATA\[/i.test(source)) refuse("cdata", "Die Datei enthält CDATA-Abschnitte. Das ist nicht erlaubt.");

    let text = source.replace(/^﻿/, "");
    const declaration = /^\s*<\?xml\s[^?<>]*\?>/.exec(text);
    if (declaration !== null) text = text.slice(declaration[0].length);
    if (text.includes("<?")) refuse("processing_instruction", "Die Datei enthält Verarbeitungsanweisungen. Das ist nicht erlaubt.");

    const stack: { name: string; transform: Matrix; paint: Paint }[] = [];
    const shapes: ImportedShape[] = [];
    const fills: (string | null)[] = [];
    let viewBox: [number, number, number, number] | null = null;
    let seenRoot = false;
    let ignored = 0;
    let totalCommands = 0;
    let i = 0;

    while (i < text.length) {
      const lt = text.indexOf("<", i);
      const chunk = lt === -1 ? text.slice(i) : text.slice(i, lt);
      const parentName = stack[stack.length - 1]?.name;
      if (chunk.includes(">")) refuse("malformed", "Die Datei ist kein gültiges SVG.");
      if (chunk.trim() !== "" && !(parentName !== undefined && IGNORED_WITH_TEXT.has(parentName))) {
        refuse("contains_text", "Die Datei enthält Text. Bitte den Text im Grafikprogramm in Pfade umwandeln.");
      }
      if (lt === -1) break;
      if (text.startsWith("<!--", lt)) {
        const end = text.indexOf("-->", lt + 4);
        if (end === -1) refuse("malformed", "Die Datei ist kein gültiges SVG (Kommentar nicht beendet).");
        i = end + 3;
        continue;
      }
      if (text[lt + 1] === "!") refuse("malformed", "Die Datei ist kein gültiges SVG.");
      const { element, closing, end } = readTag(text, lt);
      i = end;

      if (closing !== null) {
        const top = stack.pop();
        if (top === undefined || top.name !== closing) refuse("malformed", "Die Datei ist kein gültiges SVG (Elemente nicht korrekt geschlossen).");
        continue;
      }
      if (element === null) continue;
      checkAttributes(element);
      const name = element.name;
      const parent = stack[stack.length - 1];

      if (!seenRoot) {
        if (name !== "svg") refuse("not_svg", "Die Datei ist kein SVG.");
        seenRoot = true;
        viewBox = viewBoxOf(element);
      } else if (name === "svg") {
        refuse("nested_svg", "Die Datei enthält ein verschachteltes SVG. Bitte als ein einziges SVG exportieren.");
      } else if (parent === undefined) {
        refuse("malformed", "Die Datei ist kein gültiges SVG (Inhalt ausserhalb des svg-Elements).");
      } else if (parent.name === "title" || parent.name === "desc" || parent.name === "defs") {
        refuse(parent.name === "defs" ? "contains_effect" : "malformed", parent.name === "defs"
          ? "Die Datei enthält Definitionen (defs). Bitte Verläufe, Masken und Verweise im Grafikprogramm auflösen."
          : "Die Datei ist kein gültiges SVG.");
      } else if (name !== "g" && name !== "defs" && !SHAPES.has(name) && !IGNORED_WITH_TEXT.has(name)) {
        forbiddenElement(name);
      }

      const depth = stack.length + 1;
      if (depth > SVG_LIMITS.maxDepth) refuse("too_deep", "Die Datei ist zu tief verschachtelt (höchstens 12 Ebenen).");

      const ownTransform = element.attributes.has("transform") ? parseTransform(element.attributes.get("transform") ?? "") : IDENTITY;
      // The root's transform is ignored (it would only move the drawing inside its own viewBox).
      const transform = parent === undefined ? IDENTITY : multiply(parent.transform, ownTransform);
      const paint = paintOf(element, parent?.paint ?? { fill: null, stroke: null, fillRule: null, strokeWidth: null, hidden: false });

      if (SHAPES.has(name)) {
        const geometry = shapeOf(element);
        const fillNone = paint.fill === "none" || paint.fill === "transparent";
        const strokeNone = paint.stroke === null || paint.stroke === "none" || paint.stroke === "transparent";
        if (geometry === null || paint.hidden || (fillNone && strokeNone)) {
          ignored += 1;
        } else {
          if (shapes.length >= SVG_LIMITS.maxShapes) refuse("too_complex", "Die Datei enthält zu viele Formen (höchstens 100).");
          totalCommands += geometry.type === "path" ? (geometry.d.match(PATH_COMMAND)?.length ?? 0) : geometry.type === "polygon" || geometry.type === "polyline" ? geometry.points.length / 2 : 1;
          if (totalCommands > SVG_LIMITS.maxTotalCommands) refuse("too_complex", "Das Logo ist zu komplex (höchstens 8000 Befehle).");
          const strokeOnly = fillNone && !strokeNone;
          const strokeWidth = strokeOnly ? parseNumber(paint.strokeWidth ?? "1", "stroke-width") : null;
          shapes.push({
            ...geometry,
            role: strokeOnly ? "stroke" : "fill",
            transform: checkedMatrix(transform),
            ...(strokeWidth !== null && strokeWidth > 0 ? { strokeWidth: Math.min(strokeWidth, 1000) } : {}),
            ...(paint.fillRule === "evenodd" ? { fillRule: "evenodd" as const } : {}),
          } as ImportedShape);
          fills.push(strokeOnly ? null : paint.fill);
        }
      }
      if (!element.selfClosing) stack.push({ name, transform, paint });
      else if (name === "svg") stack.length = 0;
    }
    if (!seenRoot) refuse("not_svg", "Die Datei ist kein SVG.");
    if (stack.length > 0) refuse("malformed", "Die Datei ist kein gültiges SVG (Elemente nicht geschlossen).");
    if (shapes.length === 0) refuse("no_shapes", "Die Datei enthält keine sichtbaren Formen.");
    return { ok: true, viewBox, shapes, fills, ignored };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, code: error.code, message: error.message };
    return { ok: false, code: "malformed", message: "Die Datei konnte nicht gelesen werden." };
  }
}

/** A file name for the log: no folders, safe characters, at most 100 characters. */
export function cleanFileName(name: unknown): string {
  if (typeof name !== "string") return "logo.svg";
  const last = name.split(/[\\/]/).pop() ?? "";
  const clean = last.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
  return clean !== "" ? clean : "logo.svg";
}
