import { parse, printParseErrorCode } from 'jsonc-parser';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMigrationContract, checkFontFamilies } from './migration-contract.mjs';

const root = resolve(import.meta.dirname, '..');
checkMigrationContract(root);
const json = (file) => {
  const errors = [];
  const value = parse(readFileSync(resolve(root, file), 'utf8'), errors, {
    allowTrailingComma: true,
  });
  assert.equal(
    errors.length,
    0,
    `Invalid JSON: ${file}: ${errors.map((error) => printParseErrorCode(error.error)).join(', ')}`,
  );
  return value;
};
const pkg = json('package.json');
assert(pkg.private && !pkg.version, 'Root package must not have a product version');
assert.equal(json('wrangler.jsonc').assets.directory, './dist');
assert.equal(json('apps/stream-info/package.json').name, 'change-info-streamer-bot');
for (const file of [
  'apps/website/src/index.html',
  'apps/stream-info/streamerbot/action.cs',
  'packages/design/brand.css',
  'apps/tuna-widget/src/index.html',
])
  assert(existsSync(resolve(root, file)), file);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '.git', 'bin', 'obj', 'review', '.local'].includes(entry.name)) return [];
    return entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)];
  });
}
for (const app of ['apps/website/src', 'apps/stream-info/src', 'apps/obs-widgets/src']) {
  for (const file of files(resolve(root, app)).filter((file) => /\.(html|css|ts|js)$/.test(file))) {
    const text = readFileSync(file, 'utf8');
    assert(
      !/prefers-color-scheme:\s*dark|data-theme-value=|color-scheme:\s*dark/.test(text),
      `Unexpected theme switching: ${file}`,
    );
    assert(!/^(?:<{7}|={7}|>{7})/m.test(text), `Conflict marker: ${file}`);
  }
}
// Public static files are copied exactly; source HTML/CSS/JS are transformed by Vite.
for (const file of files(resolve(root, 'apps/website/public'))) {
  const output = resolve(root, 'dist', file.slice(resolve(root, 'apps/website/public').length + 1));
  assert(
    existsSync(output) && readFileSync(output).equals(readFileSync(file)),
    `Missing or stale public resource: ${output}`,
  );
}
for (const name of [
  'index.html',
  'docs.html',
  'check.html',
  'tools/index.html',
  'tools/stream-info.html',
  'tools/tuna-widget.html',
])
  assert(existsSync(resolve(root, 'dist', name)), `Missing website route: ${name}`);
for (const file of files(resolve(root, 'artwork')).filter((file) => /\.(html|css)$/.test(file))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(
    /(?:src|href)=["']([^"'#?]+)["']|url\(["']?([^\s"')]+)["']?\)/g,
  )) {
    const url = match[1] || match[2];
    if (url.startsWith('#')) continue;
    if (/^(?:https?:|data:|#|\/)/.test(url)) continue;
    if (url.startsWith('@maseaaao/')) {
      assert(existsSync(fileURLToPath(import.meta.resolve(url))), `Missing package asset: ${url}`);
      continue;
    }
    assert(
      existsSync(resolve(dirname(file), url)),
      `Missing local artwork dependency: ${file} -> ${url}`,
    );
  }
}
console.log(
  'Repository structure, light appearance, static publication parity and artwork dependencies verified.',
);

// Both browser applications and exported widgets use only the two agreed families.
for (const directory of ['apps', 'artwork', 'packages/design']) {
  for (const file of files(resolve(root, directory)).filter((file) => /\.(html|css)$/.test(file))) {
    const text = readFileSync(file, 'utf8');
    checkFontFamilies(text, file);
  }
}
assert.deepEqual(
  readdirSync(resolve(root, 'packages/design/fonts')).sort(),
  ['Unbounded.ttf', 'unbounded-600.woff2'].sort(),
);
