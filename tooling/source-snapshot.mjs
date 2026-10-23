import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source snapshots for build-isolation checks.
 *
 * Package managers lay dependencies out differently: npm hoists a single root
 * node_modules, Bun isolated installs link one into every package that declares dependencies.
 * Both are installation artifacts, never sources, so they never belong in a
 * source snapshot. Symlinks are skipped for the same reason: they point at
 * shared store content outside the source tree.
 */
export const ignoredDirectories = new Set(['node_modules', '.turbo', '.build-cache']);

export function snapshot(root, directory) {
  const rows = [];
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const name = directory + '/' + entry.name;
    if (entry.isDirectory()) rows.push(...snapshot(root, name));
    else
      rows.push([
        name,
        createHash('sha256')
          .update(readFileSync(resolve(root, name)))
          .digest('hex'),
      ]);
  }
  return rows.sort(([left], [right]) => left.localeCompare(right));
}
