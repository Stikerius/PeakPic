// Logo specification: a checked, normalized JSON structure instead of raw SVG. Only shapes with
// numbers, checked path data, a transform matrix and a role. No text, images, scripts, styles,
// references or filters exist in it. Everything is drawn in one colour (the accent of the palette).
// validateLogoSpec runs again before every render; on failure the built-in app logo is shown.

export const LOGO_SPEC_VERSION = 1;

/** fill = "Fläche", cutout = "Ausschnitt" (cut out of the fill), stroke = "Nur Linie". */
export type ShapeRole = "fill" | "cutout" | "stroke";

/** SVG matrix(a b c d e f). */
export type Matrix = readonly [number, number, number, number, number, number];

type ShapeBase = { role: ShapeRole; transform: Matrix; strokeWidth?: number };

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
  /** JSON size of a whole spec (characters). */
  maxJsonChars: 120_000,
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
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return fail("Nicht lesbar.");
  }
  if (json.length > LOGO_LIMITS.maxJsonChars) return fail("Logo zu gross.");
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
  for (const raw of shapesIn) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("Ungültige Form.");
    const s = raw as Record<string, unknown>;
    const type = s.type;
    if (typeof type !== "string" || !(type in SHAPE_KEYS)) return fail("Unbekannter Formtyp.");
    const keys = SHAPE_KEYS[type as LogoShape["type"]];
    for (const key of Object.keys(s)) {
      if (key !== "type" && key !== "role" && key !== "transform" && key !== "strokeWidth" && !keys.includes(key)) {
        return fail("Unbekanntes Feld in einer Form.");
      }
    }
    if (s.role !== "fill" && s.role !== "cutout" && s.role !== "stroke") return fail("Unbekannte Rolle.");
    const transform = checkMatrix(s.transform);
    if (transform === null) return fail("Ungültige Transformation.");
    if (s.strokeWidth !== undefined && !isNumber(s.strokeWidth, 0.01, LOGO_LIMITS.maxStrokeWidth)) {
      return fail("Ungültige Linienstärke.");
    }
    const base = {
      role: s.role as ShapeRole,
      transform,
      ...(s.strokeWidth !== undefined ? { strokeWidth: s.strokeWidth as number } : {}),
    };
    if (type === "path") {
      if (typeof s.d !== "string") return fail("Ungültiger Pfad.");
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

// ------------------------------------------------------------------ lengths (outline drawing)

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function curveLength(points: (t: number) => [number, number], steps = 16): number {
  let total = 0;
  let [px, py] = points(0);
  for (let i = 1; i <= steps; i += 1) {
    const [x, y] = points(i / steps);
    total += dist(px, py, x, y);
    px = x;
    py = y;
  }
  return total;
}

function arcLength(x1: number, y1: number, rxIn: number, ryIn: number, angle: number, large: boolean, sweep: boolean, x2: number, y2: number): number {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return dist(x1, y1, x2, y2);
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
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return curveLength((t) => {
    const a = theta + delta * t;
    return [rx * Math.cos(a), ry * Math.sin(a)];
  }, 24);
}

/** Approximate length of path data (flattened curves), in its own units. */
export function pathLength(d: string): number {
  const commands = parsePathData(d);
  if (commands === null) return 0;
  let total = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let lastCmd = "";
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
      if (lower === "m") {
        // Pairs after the first are an implicit line-to.
        const nx = ox + at(0);
        const ny = oy + at(1);
        if (g === 0) {
          startX = nx;
          startY = ny;
        } else total += dist(x, y, nx, ny);
        x = nx;
        y = ny;
      } else if (lower === "l" || lower === "t") {
        const nx = ox + at(0);
        const ny = oy + at(1);
        total += dist(x, y, nx, ny);
        x = nx;
        y = ny;
      } else if (lower === "h") {
        const nx = ox + at(0);
        total += Math.abs(nx - x);
        x = nx;
      } else if (lower === "v") {
        const ny = oy + at(0);
        total += Math.abs(ny - y);
        y = ny;
      } else if (lower === "c" || lower === "s") {
        let c1x: number;
        let c1y: number;
        let k = 0;
        if (lower === "c") {
          c1x = ox + at(0);
          c1y = oy + at(1);
          k = 2;
        } else {
          const prev = lastCmd === "c" || lastCmd === "s";
          c1x = prev ? 2 * x - lastCtrlX : x;
          c1y = prev ? 2 * y - lastCtrlY : y;
        }
        const c2x = ox + at(k);
        const c2y = oy + at(k + 1);
        const ex = ox + at(k + 2);
        const ey = oy + at(k + 3);
        const sx = x;
        const sy = y;
        total += curveLength((t) => {
          const u = 1 - t;
          return [
            u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
            u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
          ];
        });
        lastCtrlX = c2x;
        lastCtrlY = c2y;
        x = ex;
        y = ey;
      } else if (lower === "q") {
        const cx = ox + at(0);
        const cy = oy + at(1);
        const ex = ox + at(2);
        const ey = oy + at(3);
        const sx = x;
        const sy = y;
        total += curveLength((t) => {
          const u = 1 - t;
          return [u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey];
        });
        x = ex;
        y = ey;
      } else if (lower === "a") {
        const ex = ox + at(5);
        const ey = oy + at(6);
        total += arcLength(x, y, at(0), at(1), at(2), at(3) !== 0, at(4) !== 0, ex, ey);
        x = ex;
        y = ey;
      } else if (lower === "z") {
        total += dist(x, y, startX, startY);
        x = startX;
        y = startY;
      }
      lastCmd = lower;
    }
  }
  return total;
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
