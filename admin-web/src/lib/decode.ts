/** Small runtime checks for RPC results (they arrive as unknown JSON). */

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Json {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return 0;
}

export function bool(value: unknown): boolean {
  return value === true;
}
