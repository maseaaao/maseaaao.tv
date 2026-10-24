// Compare JSON connection records, without loading the archive reader or SQLite.
import { isDeepStrictEqual } from 'node:util';

export const connections = (rows) =>
  Object.fromEntries(
    Object.entries(rows).filter(
      ([, value]) => (value.moduleInstanceType ?? 'connection') === 'connection',
    ),
  );
const project = (value) =>
  Object.fromEntries(
    ['moduleId', 'moduleVersionId', 'enabled', 'label', 'config', 'secrets'].map((key) => [
      key,
      value[key] ?? null,
    ]),
  );

export function compare(stored, live) {
  const saved = connections(stored);
  return (
    isDeepStrictEqual(Object.keys(saved).sort(), Object.keys(live).sort()) &&
    Object.entries(live).every(([key, value]) =>
      isDeepStrictEqual(project(saved[key]), project(value)),
    )
  );
}
