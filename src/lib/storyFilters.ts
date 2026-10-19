/**
 * Story filters as 4x5 colour matrices (row-major, Skia's ColorMatrix format:
 * the 5th column is an offset in the 0..1 range). Pure functions, unit tested.
 */
export type ColorMatrix = readonly number[];

export const IDENTITY: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** Applies `second` after `first` (matrices extended to 5x5 with a [0 0 0 0 1] row). */
export function compose(first: ColorMatrix, second: ColorMatrix): ColorMatrix {
  const at = (m: ColorMatrix, row: number, col: number): number =>
    row === 4 ? (col === 4 ? 1 : 0) : (m[row * 5 + col] ?? 0);
  const result: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let k = 0; k < 5; k++) sum += at(second, row, k) * at(first, k, col);
      result.push(sum);
    }
  }
  return result;
}

/** Linear blend between two matrices; amount 0 = a, 1 = b. */
export function mix(a: ColorMatrix, b: ColorMatrix, amount: number): ColorMatrix {
  return a.map((value, i) => value + ((b[i] ?? 0) - value) * amount);
}

export function saturation(s: number): ColorMatrix {
  const [r, g, b] = [0.2126 * (1 - s), 0.7152 * (1 - s), 0.0722 * (1 - s)];
  return [
    r + s, g, b, 0, 0,
    r, g + s, b, 0, 0,
    r, g, b + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

export function contrast(c: number): ColorMatrix {
  const offset = (1 - c) / 2;
  return [
    c, 0, 0, 0, offset,
    0, c, 0, 0, offset,
    0, 0, c, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

export function brightness(amount: number): ColorMatrix {
  return [
    1, 0, 0, 0, amount,
    0, 1, 0, 0, amount,
    0, 0, 1, 0, amount,
    0, 0, 0, 1, 0,
  ];
}

/** Scales the red, green and blue channels individually. */
export function channels(r: number, g: number, b: number): ColorMatrix {
  return [
    r, 0, 0, 0, 0,
    0, g, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

const SEPIA: ColorMatrix = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];

export type StoryFilter = { id: string; name: string; matrix: ColorMatrix };

export const STORY_FILTERS: readonly StoryFilter[] = [
  { id: "normal", name: "Normal", matrix: IDENTITY },
  { id: "punch", name: "Punch", matrix: compose(saturation(1.35), contrast(1.2)) },
  { id: "warm", name: "Warm", matrix: compose(channels(1.08, 1, 0.86), saturation(1.1)) },
  { id: "cool", name: "Kühl", matrix: compose(channels(0.9, 1, 1.1), saturation(0.95)) },
  { id: "bw", name: "S/W", matrix: compose(saturation(0), contrast(1.15)) },
  { id: "noir", name: "Noir", matrix: compose(saturation(0), contrast(1.6)) },
  { id: "sepia", name: "Sepia", matrix: SEPIA },
  {
    id: "vintage",
    name: "Vintage",
    matrix: compose(compose(mix(IDENTITY, SEPIA, 0.45), contrast(0.85)), brightness(0.05)),
  },
];
