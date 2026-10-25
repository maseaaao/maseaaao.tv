// CI-only version stamping: no commits, tags, installs or dependency changes.
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { applyEdits, modify } from 'jsonc-parser';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { root: { type: 'string' } },
});
const [number] = positionals;
if (
  positionals.length !== 1 ||
  !/^[1-9]\d*$/.test(number) ||
  !Number.isSafeInteger(Number(number))
) {
  throw new Error('Expected a positive release number without leading zeros');
}
// A common major newer than the former independently versioned 1.x products.
const version = `2.0.${number}`;
const root = resolve(values.root || resolve(import.meta.dirname, '..'));
const safe = (name: string) => {
  const file = resolve(root, name);
  const rel = relative(root, file);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error(`Release metadata escapes the repository: ${name}`);
  }
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Release metadata symlink: ${name}`);
    }
  }
  return file;
};
const catalog = JSON.parse(readFileSync(safe('tooling/release-products.json'), 'utf8')) as {
  products: { path: string; versionFile?: string }[];
};
const files = new Set<string>();
for (const product of catalog.products) {
  if (product.versionFile) {
    files.add(safe(product.versionFile));
  }
  const manifest = safe(`${product.path}/package.json`);
  if (existsSync(manifest)) {
    const metadata = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
    if (metadata.version) {
      files.add(manifest);
    } else if (!product.versionFile) {
      throw new Error(`Missing product version: ${manifest}`);
    }
  }
  const companion = safe(`${product.path}/companion/manifest.json`);
  if (existsSync(companion)) {
    files.add(companion);
  }
}
// Validate every input before changing any file.
const updates = [...files].map((file) => {
  const source = readFileSync(file, 'utf8');
  const metadata = JSON.parse(source) as Record<string, unknown>;
  if (typeof metadata.version !== 'string') {
    throw new Error(`Missing product version: ${file}`);
  }
  return { content: applyEdits(source, modify(source, ['version'], version, {})), file };
});
for (const { file, content } of updates) {
  writeFileSync(file, content);
}
console.log(`Prepared v${number}: ${updates.length} metadata files use ${version}.`);
