export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.length > 0) return value;
  return null;
}
