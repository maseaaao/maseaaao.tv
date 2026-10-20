import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Storybook 10.6.2 passes native Windows separators to micromatch, which treats
// them as escapes. Normalize both the story globs and the transformed file IDs.
// Keep this pinned workaround local to the test dependency, never product code.
if (process.platform === 'win32') {
  const entry = fileURLToPath(import.meta.resolve('@storybook/addon-vitest/vitest-plugin'));
  const metadata = JSON.parse(readFileSync(resolve(dirname(entry), '../../package.json'), 'utf8'));
  if (metadata.version !== '10.6.2')
    throw new Error('Re-evaluate the Storybook Windows workaround before changing versions.');
  let source = readFileSync(entry, 'utf8');
  const replacements = [
    [
      'relative(finalOptions.vitestRoot, story)',
      'relative(finalOptions.vitestRoot, story).split(String.fromCharCode(92)).join("/")',
    ],
    [
      'relative(finalOptions.vitestRoot, id)',
      'relative(finalOptions.vitestRoot, id).split(String.fromCharCode(92)).join("/")',
    ],
  ];
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2)
      throw new Error('Storybook test transform changed; refusing an unverified dependency patch.');
    source = source.replace(before, after);
  }
  writeFileSync(entry, source);
  // Its browser helper decodes spaces only, so Cyrillic checkout paths fail the
  // generated current-test-file guard even after the glob transform succeeds.
  const helper = resolve(dirname(entry), 'test-utils.js');
  let utility = readFileSync(helper, 'utf8');
  const before = 'var convertToFilePath = (url) => url.replace(';
  const after = 'var convertToFilePath = (url) => decodeURI(url).replace(';
  if (!utility.includes(after)) {
    if (utility.split(before).length !== 2)
      throw new Error('Storybook browser path helper changed; re-evaluate the workaround.');
    utility = utility.replace(before, after);
    writeFileSync(helper, utility);
    const catalog = resolve(import.meta.dirname, 'ui-catalog');
    const cache = resolve(catalog, 'node_modules/.cache/storybook');
    if (!cache.startsWith(catalog + sep)) throw new Error('Unexpected Storybook cache path.');
    rmSync(cache, { recursive: true, force: true });
  }
  console.log('Storybook 10.6.2 Windows story paths normalized.');
}
