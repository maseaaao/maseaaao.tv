export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Required fixture value is missing');
  }
  return value;
}
export function textValue(value: unknown): string {
  return (() => {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return '';
  })();
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object');
  }
  return parsed;
}
