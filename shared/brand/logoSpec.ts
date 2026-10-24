// Logo specification: a checked, normalized JSON structure instead of raw SVG. Only shapes with
// numbers, checked path data, a transform matrix and a role. No text, images, scripts, styles,
// references or filters exist in it. Everything is drawn in one colour (the accent of the palette).
// validateLogoSpec runs again before every render; on failure the built-in app logo is shown.

export const LOGO_SPEC_VERSION = 1;

/** fill = "Fläche", cutout = "Ausschnitt" (cut out of the fill), stroke = "Nur Linie". */
export type ShapeRole = "fill" | "cutout" | "stroke";

/** SVG matrix(a b c d e f). */
export type Matrix = readonly [number, number, number, number, number, number];

/** How overlapping parts of one shape are filled; evenodd makes inner sub-paths holes. */
export type FillRule = "nonzero" | "evenodd";

type ShapeBase = { role: ShapeRole; transform: Matrix; strokeWidth?: number; fillRule?: FillRule };

export type LogoShape =
  | (ShapeBase & { type: "path"; d: string })
  | (ShapeBase & { type: "circle"; cx: number; cy: number; r: number })
  | (ShapeBase & { type: "ellipse"; cx: number; cy: number; rx: number; ry: number })
  | (ShapeBase & { type: "rect"; x: number; y: number; width: number; height: number; rx: number; ry: number })
  | (ShapeBase & { type: "line"; x1: number; y1: number; x2: number; y2: number })
  | (ShapeBase & { type: "polygon" | "polyline"; points: readonly number[] });

export type LogoSpec = {
  version: typeof LOGO_SPEC_VERSION;
  viewBox: readonly [number, number, number, number];
  shapes: readonly LogoShape[];
};

export const LOGO_LIMITS = {
  maxShapes: 100,
  maxPathChars: 20_000,
  maxPathCommands: 4_000,
  maxTotalCommands: 8_000,
  maxPoints: 2_000,
  maxAbs: 100_000,
  /** Scale, rotation and skew part of a matrix. */
  maxLinear: 1_000,
  maxStrokeWidth: 1_000,
  /** All path data of a logo together (characters). */
  maxTotalPathChars: 100_000,
} as const;

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r,.\-eE]*$/;
const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE]-?\d+)?)|([ \t\n\r,]+)/y;
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

export type PathCommand = { command: string; values: number[] };

/** Parses path data into commands; null if anything is outside the allowed grammar. */
export function parsePathData(d: string): PathCommand[] | null {
  if (d.length === 0 || d.length > LOGO_LIMITS.maxPathChars || !PATH_CHARS.test(d)) return null;
  const commands: PathCommand[] = [];
  let current: PathCommand | null = null;
  PATH_TOKEN.lastIndex = 0;
  while (PATH_TOKEN.lastIndex < d.length) {
    const start = PATH_TOKEN.lastIndex;
    const match = PATH_TOKEN.exec(d);
    if (match === null || match.index !== start) return null;
    if (match[1] !== undefined) {
      current = { command: match[1], values: [] };
      commands.push(current);
    } else if (match[2] !== undefined) {
      if (current === null) return null;
      const n = Number(match[2]);
      if (!Number.isFinite(n) || Math.abs(n) > LOGO_LIMITS.maxAbs) return null;
      current.values.push(n);
    }
  }
  if (commands.length === 0 || (commands[0]?.command ?? "").toLowerCase() !== "m") return null;
  for (const c of commands) {
    const count = ARGS[c.command.toLowerCase()] ?? -1;
    if (count === 0 ? c.values.length !== 0 : c.values.length === 0 || c.values.length % count !== 0) return null;
  }
  return commands;
}

function isNumber(value: unknown, min: number = -LOGO_LIMITS.maxAbs, max: number = LOGO_LIMITS.maxAbs): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function checkMatrix(value: unknown): Matrix | null {
  if (!Array.isArray(value) || value.length !== 6) return null;
  const [a, b, c, d, e, f] = value as unknown[];
  const lin = LOGO_LIMITS.maxLinear;
  if (![a, b, c, d].every((n) => isNumber(n, -lin, lin)) || !isNumber(e) || !isNumber(f)) return null;
  const m = [a, b, c, d, e, f] as unknown as Matrix;
  // A collapsed matrix would make the shape invisible and break the stroke length.
  if (Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-9) return null;
  return m;
}

const SHAPE_KEYS: Record<LogoShape["type"], readonly string[]> = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polygon: ["points"],
  polyline: ["points"],
};

export type LogoCheck = { ok: true; spec: LogoSpec } | { ok: false; error: string };

function fail(error: string): LogoCheck {
  return { ok: false, error };
}

/** The structure, all limits, allowed characters and the number of shapes and commands. */
export function validateLogoSpec(value: unknown): LogoCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("Kein Objekt.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "version" && key !== "viewBox" && key !== "shapes") return fail("Unbekanntes Feld.");
  }
  if (input.version !== LOGO_SPEC_VERSION) return fail("Unbekannte Version.");
  const vb = input.viewBox;
  if (!Array.isArray(vb) || vb.length !== 4 || !vb.every((n) => isNumber(n))) return fail("Ungültige viewBox.");
  const viewBox = vb as [number, number, number, number];
  if (viewBox[2] <= 0 || viewBox[3] <= 0) return fail("Ungültige viewBox.");
  const shapesIn = input.shapes;
  if (!Array.isArray(shapesIn) || shapesIn.length === 0) return fail("Keine Formen.");
  if (shapesIn.length > LOGO_LIMITS.maxShapes) return fail("Zu viele Formen.");
  if (!shapesIn.some((s) => typeof s === "object" && s !== null && (s as Record<string, unknown>).role !== "cutout")) {
    return fail("Keine sichtbare Form.");
  }

  const shapes: LogoShape[] = [];
  let totalCommands = 0;
  let totalPathChars = 0;
  for (const raw of shapesIn) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("Ungültige Form.");
    const s = raw as Record<string, unknown>;
    const type = s.type;
    if (typeof type !== "string" || !(type in SHAPE_KEYS)) return fail("Unbekannter Formtyp.");
    const keys = SHAPE_KEYS[type as LogoShape["type"]];
    for (const key of Object.keys(s)) {
      if (key !== "type" && key !== "role" && key !== "transform" && key !== "strokeWidth" && key !== "fillRule" && !keys.includes(key)) {
        return fail("Unbekanntes Feld in einer Form.");
      }
    }
    if (s.role !== "fill" && s.role !== "cutout" && s.role !== "stroke") return fail("Unbekannte Rolle.");
    const transform = checkMatrix(s.transform);
    if (transform === null) return fail("Ungültige Transformation.");
    if (s.strokeWidth !== undefined && !isNumber(s.strokeWidth, 0.01, LOGO_LIMITS.maxStrokeWidth)) {
      return fail("Ungültige Linienstärke.");
    }
    if (s.fillRule !== undefined && s.fillRule !== "nonzero" && s.fillRule !== "evenodd") return fail("Ungültige Füllregel.");
    const base = {
      role: s.role as ShapeRole,
      transform,
      ...(s.strokeWidth !== undefined ? { strokeWidth: s.strokeWidth as number } : {}),
      ...(s.fillRule !== undefined ? { fillRule: s.fillRule as FillRule } : {}),
    };
    if (type === "path") {
      if (typeof s.d !== "string") return fail("Ungültiger Pfad.");
      totalPathChars += s.d.length;
      if (totalPathChars > LOGO_LIMITS.maxTotalPathChars) return fail("Logo zu gross.");
      const commands = parsePathData(s.d);
      if (commands === null) return fail("Ungültiger Pfad.");
      if (commands.length > LOGO_LIMITS.maxPathCommands) return fail("Pfad zu komplex.");
      totalCommands += commands.length;
      if (totalCommands > LOGO_LIMITS.maxTotalCommands) return fail("Logo zu komplex.");
      shapes.push({ ...base, type, d: s.d });
    } else if (type === "polygon" || type === "polyline") {
      const points = s.points;
      if (!Array.isArray(points) || points.length < 4 || points.length % 2 !== 0 || points.length > LOGO_LIMITS.maxPoints * 2) {
        return fail("Ungültige Punkte.");
      }
      if (!points.every((n) => isNumber(n))) return fail("Ungültige Punkte.");
      totalCommands += points.length / 2;
      if (totalCommands > LOGO_LIMITS.maxTotalCommands) return fail("Logo zu komplex.");
      shapes.push({ ...base, type, points: points as number[] });
    } else {
      const values: Record<string, number> = {};
      for (const key of keys) {
        const n = s[key];
        if (!isNumber(n)) return fail("Ungültige Zahl.");
        values[key] = n;
      }
      if (type === "circle" && (values.r ?? 0) <= 0) return fail("Ungültiger Kreis.");
      if (type === "ellipse" && ((values.rx ?? 0) <= 0 || (values.ry ?? 0) <= 0)) return fail("Ungültige Ellipse.");
      if (type === "rect" && ((values.width ?? 0) <= 0 || (values.height ?? 0) <= 0 || (values.rx ?? 0) < 0 || (values.ry ?? 0) < 0)) {
        return fail("Ungültiges Rechteck.");
      }
      shapes.push({ ...base, type, ...values } as LogoShape);
    }
  }
  return { ok: true, spec: { version: LOGO_SPEC_VERSION, viewBox, shapes } };
}

// ------------------------------------------------------------------ outlines as points (length, bounds)

type Point = [number, number];

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function sample(points: Point[], at: (t: number) => Point, steps: number): void {
  for (let i = 1; i <= steps; i += 1) points.push(at(i / steps));
}

/** Points along an SVG arc (endpoint parameterization -> centre, as in the SVG spec). */
function sampleArc(points: Point[], x1: number, y1: number, rxIn: number, ryIn: number, angle: number, large: boolean, sweep: boolean, x2: number, y2: number): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    points.push([x2, y2]);
    return;
  }
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  sample(
    points,
    (t) => {
      const a = theta + delta * t;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
    },
    24,
  );
}

/**
 * Path data as point lists, one per sub-path (curves sampled, closed sub-paths end at their
 * start). In the path's own units, without transform.
 */
export function flattenPath(d: string): Point[][] {
  const commands = parsePathData(d);
  if (commands === null) return [];
  const subpaths: Point[][] = [];
  let points: Point[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let lastCmd = "";
  const begin = () => {
    if (points.length > 1) subpaths.push(points);
    points = [[x, y]];
  };
  for (const { command, values } of commands) {
    const lower = command.toLowerCase();
    const rel = command === lower;
    const size = ARGS[lower] ?? 0;
    const groups = size === 0 ? 1 : values.length / size;
    for (let g = 0; g < groups; g += 1) {
      const v = values.slice(g * size, g * size + size);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      const at = (i: number) => v[i] ?? 0;
      const sx = x;
      const sy = y;
      if (lower === "m") {
        // Pairs after the first are an implicit line-to.
        x = ox + at(0);
        y = oy + at(1);
        if (g === 0) {
          startX = x;
          startY = y;
          begin();
        } else points.push([x, y]);
      } else if (lower === "l") {
        x = ox + at(0);
        y = oy + at(1);
        points.push([x, y]);
      } else if (lower === "h") {
        x = ox + at(0);
        points.push([x, y]);
      } else if (lower === "v") {
        y = oy + at(0);
        points.push([x, y]);
      } else if (lower === "c" || lower === "s") {
        let c1x = x;
        let c1y = y;
        let k = 0;
        if (lower === "c") {
          c1x = ox + at(0);
          c1y = oy + at(1);
          k = 2;
        } else if (lastCmd === "c" || lastCmd === "s") {
          c1x = 2 * x - lastCtrlX;
          c1y = 2 * y - lastCtrlY;
        }
        const c2x = ox + at(k);
        const c2y = oy + at(k + 1);
        x = ox + at(k + 2);
        y = oy + at(k + 3);
        const ex = x;
        const ey = y;
        sample(
          points,
          (t) => {
            const u = 1 - t;
            return [
              u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
              u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
            ];
          },
          16,
        );
        lastCtrlX = c2x;
        lastCtrlY = c2y;
      } else if (lower === "q" || lower === "t") {
        let cx: number;
        let cy: number;
        if (lower === "q") {
          cx = ox + at(0);
          cy = oy + at(1);
          x = ox + at(2);
          y = oy + at(3);
        } else {
          const prev = lastCmd === "q" || lastCmd === "t";
          cx = prev ? 2 * x - lastCtrlX : x;
          cy = prev ? 2 * y - lastCtrlY : y;
          x = ox + at(0);
          y = oy + at(1);
        }
        const ex = x;
        const ey = y;
        sample(
          points,
          (t) => {
            const u = 1 - t;
            return [u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey];
          },
          16,
        );
        lastCtrlX = cx;
        lastCtrlY = cy;
      } else if (lower === "a") {
        x = ox + at(5);
        y = oy + at(6);
        sampleArc(points, sx, sy, at(0), at(1), at(2), at(3) !== 0, at(4) !== 0, x, y);
      } else if (lower === "z") {
        x = startX;
        y = startY;
        points.push([x, y]);
        begin();
      }
      lastCmd = lower;
    }
  }
  if (points.length > 1) subpaths.push(points);
  return subpaths;
}

/** Approximate length of path data (flattened curves), in its own units. */
export function pathLength(d: string): number {
  let total = 0;
  for (const points of flattenPath(d)) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] ?? [0, 0];
      const b = points[i] ?? [0, 0];
      total += dist(a[0], a[1], b[0], b[1]);
    }
  }
  return total;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Outline points of a shape in logo units (transform applied). */
export function shapePoints(shape: LogoShape): Point[] {
  let local: Point[];
  switch (shape.type) {
    case "path":
      local = flattenPath(shape.d).flat();
      break;
    case "circle":
    case "ellipse": {
      const rx = shape.type === "circle" ? shape.r : shape.rx;
      const ry = shape.type === "circle" ? shape.r : shape.ry;
      local = Array.from({ length: 32 }, (_, i): Point => {
        const a = (i / 32) * 2 * Math.PI;
        return [shape.cx + rx * Math.cos(a), shape.cy + ry * Math.sin(a)];
      });
      break;
    }
    case "rect":
      local = [
        [shape.x, shape.y],
        [shape.x + shape.width, shape.y],
        [shape.x + shape.width, shape.y + shape.height],
        [shape.x, shape.y + shape.height],
      ];
      break;
    case "line":
      local = [
        [shape.x1, shape.y1],
        [shape.x2, shape.y2],
      ];
      break;
    default:
      local = [];
      for (let i = 0; i + 1 < shape.points.length; i += 2) local.push([shape.points[i] ?? 0, shape.points[i + 1] ?? 0]);
  }
  const [a, b, c, d, e, f] = shape.transform;
  return local.map(([px, py]): Point => [a * px + c * py + e, b * px + d * py + f]);
}

/** Bounding box of shapes (logo units), or null without points. */
export function shapesBounds(shapes: readonly LogoShape[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const shape of shapes) {
    const pad = shape.role === "stroke" ? (shape.strokeWidth ?? 1) / 2 : 0;
    for (const [px, py] of shapePoints(shape)) {
      bounds =
        bounds === null
          ? { minX: px - pad, minY: py - pad, maxX: px + pad, maxY: py + pad }
          : {
              minX: Math.min(bounds.minX, px - pad),
              minY: Math.min(bounds.minY, py - pad),
              maxX: Math.max(bounds.maxX, px + pad),
              maxY: Math.max(bounds.maxY, py + pad),
            };
    }
  }
  return bounds;
}

/** "Auto-Zentrierung und Rand": a viewBox around the visible shapes with `margin` (share of the size) on every side. */
export function fitViewBox(shapes: readonly LogoShape[], margin: number): readonly [number, number, number, number] | null {
  const bounds = shapesBounds(shapes.filter((s) => s.role !== "cutout"));
  if (bounds === null) return null;
  const width = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const pad = Math.max(width, height) * Math.min(Math.max(margin, 0), 0.5);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [round(bounds.minX - pad), round(bounds.minY - pad), round(width + 2 * pad), round(height + 2 * pad)];
}

/**
 * Length of a shape's outline (approximately). With `withTransform` in logo units; without it in
 * the shape's own units, which is what a stroke dash on the transformed element needs.
 */
export function shapeLength(shape: LogoShape, withTransform = true): number {
  const [a, b, c, d] = shape.transform;
  const scale = withTransform ? Math.sqrt(Math.abs(a * d - b * c)) : 1;
  let length: number;
  switch (shape.type) {
    case "path":
      length = pathLength(shape.d);
      break;
    case "circle":
      length = 2 * Math.PI * shape.r;
      break;
    case "ellipse": {
      const h = ((shape.rx - shape.ry) / (shape.rx + shape.ry)) ** 2;
      length = Math.PI * (shape.rx + shape.ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      break;
    }
    case "rect":
      length = 2 * (shape.width + shape.height);
      break;
    case "line":
      length = dist(shape.x1, shape.y1, shape.x2, shape.y2);
      break;
    default: {
      length = 0;
      const p = shape.points;
      for (let i = 2; i + 1 < p.length; i += 2) length += dist(p[i - 2] ?? 0, p[i - 1] ?? 0, p[i] ?? 0, p[i + 1] ?? 0);
      if (shape.type === "polygon") length += dist(p[p.length - 2] ?? 0, p[p.length - 1] ?? 0, p[0] ?? 0, p[1] ?? 0);
    }
  }
  return Math.max(1, length * scale);
}

/** "x1,y1 x2,y2 ..." for polygon and polyline. */
export function pointsAttribute(points: readonly number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push(`${points[i]},${points[i + 1]}`);
  return pairs.join(" ");
}

export function matrixAttribute(m: Matrix): string {
  return `matrix(${m.join(" ")})`;
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

// ------------------------------------------------------------------ roles for imported logos

export type RoleSuggestion = { role: ShapeRole; omit: boolean; reason: string | null };

function inside(inner: Bounds, outer: Bounds): boolean {
  return inner.minX >= outer.minX && inner.minY >= outer.minY && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}

/**
 * Suggestions for step 2 of the upload, from the shapes and the colour each had in the file
 * (colours are not stored): a shape covering (nearly) the whole viewBox first is the icon
 * background and is left out; a shape lying completely inside an earlier filled shape, in another
 * colour, is cut out of it (like the inner circle of the lens). Outlines stay outlines.
 */
export function suggestShapeRoles(spec: LogoSpec, fills: readonly (string | null)[]): RoleSuggestion[] {
  const [vx, vy, vw, vh] = spec.viewBox;
  const kept: { bounds: Bounds; fill: string | null }[] = [];
  return spec.shapes.map((shape, i) => {
    const bounds = shapesBounds([shape]);
    const fill = fills[i] ?? null;
    if (shape.role === "stroke" || bounds === null) return { role: shape.role, omit: false, reason: null };
    const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    if (i === 0 && spec.shapes.length > 1 && area >= vw * vh * 0.98 && bounds.minX <= vx + vw * 0.01 && bounds.minY <= vy + vh * 0.01) {
      return { role: "fill", omit: true, reason: "Hintergrundfläche" };
    }
    const host = kept.find((k) => inside(bounds, k.bounds) && k.fill !== fill);
    kept.push({ bounds, fill });
    if (host !== undefined) return { role: "cutout", omit: false, reason: "Liegt in einer anderen Form und hat eine andere Farbe" };
    return { role: shape.role, omit: false, reason: shape.fillRule === "evenodd" ? "Löcher über die Füllregel evenodd" : null };
  });
}

// ------------------------------------------------------------------ built-in logos

export const APP_LOGO_ID = "00000000-0000-4000-8000-00000000b001";
export const FLAME_LOGO_ID = "00000000-0000-4000-8000-00000000b002";

/**
 * App logo: exactly the shapes of the app icon (assets/peakpic-icons/svg-quellen/default_bw.svg,
 * arm with camera lens), without the square icon background. viewBox around the shapes.
 */
export const APP_LOGO_SPEC: LogoSpec = {
  version: 1,
  viewBox: [131, 92, 167, 212],
  shapes: [
    {
      type: "path",
      d: "M148 128 C 158 108, 188 104, 202 122 C 218 142, 222 168, 210 190 C 202 204, 196 210, 202 220 C 214 228, 232 232, 250 244 C 236 250, 226 258, 224 268 C 206 250, 186 236, 172 218 C 160 202, 152 190, 150 170 C 149 156, 143 142, 148 128 Z",
      role: "fill",
      transform: IDENTITY,
    },
    { type: "circle", cx: 252, cy: 258, r: 34, role: "fill", transform: IDENTITY },
    { type: "rect", x: 242, y: 218, width: 20, height: 10, rx: 4, ry: 4, role: "fill", transform: IDENTITY },
    { type: "circle", cx: 252, cy: 258, r: 18, role: "cutout", transform: IDENTITY },
  ],
};

/**
 * PLATZHALTER: The login screen showed the Ionicons glyph "flame" (a font, no vector file in the
 * project). Until a vector file of the flame exists, this placeholder shape is used.
 */
export const FLAME_LOGO_SPEC: LogoSpec = {
  version: 1,
  viewBox: [0, 0, 200, 240],
  shapes: [
    {
      type: "path",
      d: "M104 8C112 52 168 84 168 150C168 200 136 228 100 228C64 228 32 200 32 150C32 112 56 92 72 66C78 84 88 96 98 98C92 70 94 36 104 8Z",
      role: "fill",
      transform: IDENTITY,
    },
    {
      type: "path",
      d: "M100 150C112 168 122 180 122 194C122 208 112 216 100 216C88 216 78 208 78 194C78 180 88 168 100 150Z",
      role: "cutout",
      transform: IDENTITY,
    },
  ],
};

export const BUILTIN_LOGOS = [
  { id: APP_LOGO_ID, name: "App-Logo", spec: APP_LOGO_SPEC },
  { id: FLAME_LOGO_ID, name: "Flamme", spec: FLAME_LOGO_SPEC },
] as const;
