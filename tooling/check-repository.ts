import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFontFamilies, checkSourceMarkup } from './source-markup.ts';

const DOT_HTML_CSS_RE = /\.(html|css)$/;
const DOT_HTML_CSS_TS_RE = /\.(html|css|ts|js)$/;

const root = resolve(import.meta.dirname, '..');

for (const directory of ['apps', 'artwork', 'packages', 'tooling', 'docs']) {
  for (const file of files(resolve(root, directory))) {
    const name = file.slice(root.length + 1).replaceAll('\\', '/');
    if (/^(?:apps\/|artwork\/|packages\/design\/).+\.(?:html|css)$/.test(name)) {
      checkFontFamilies(readFileSync(file, 'utf8'), file);
    }
    if (
      !name.endsWith('.html') ||
      name.split('/').some((part) => ['dist', 'bin', 'obj'].includes(part))
    ) {
      continue;
    }
    checkSourceMarkup(readFileSync(file, 'utf8'), name, {
      fragment: name.startsWith('apps/obs-widgets/src/streamlabs-chat/'),
    });
  }
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'dist') {
      return [];
    }
    if (['node_modules', '.git', 'bin', 'obj', 'review', '.local'].includes(entry.name)) {
      return [];
    }
    return entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)];
  });
}
for (const app of ['apps/website/src', 'apps/stream-info/src', 'apps/obs-widgets/src']) {
  for (const file of files(resolve(root, app)).filter((fileLocal) =>
    DOT_HTML_CSS_TS_RE.test(fileLocal),
  )) {
    const text = readFileSync(file, 'utf8');
    assert(
      !/prefers-color-scheme:\s*dark|data-theme-value=|color-scheme:\s*dark/.test(text),
      `Unexpected theme switching: ${file}`,
    );
    assert(!/^(?:<{7}|={7}|>{7})/m.test(text), `Conflict marker: ${file}`);
  }
}

for (const file of files(resolve(root, 'artwork')).filter((fileLocal) =>
  DOT_HTML_CSS_RE.test(fileLocal),
)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(
    /(?:src|href)=["']([^"'#?]+)["']|url\(["']?([^\s"')]+)["']?\)/g,
  )) {
    const url = match[1] || match[2];
    if (!url) {
      continue;
    }
    if (url.startsWith('#')) {
      continue;
    }
    if (/^(?:https?:|data:|#|\/)/.test(url)) {
      continue;
    }
    if (url.startsWith('@maseaaao/')) {
      assert(existsSync(fileURLToPath(import.meta.resolve(url))), `Missing package asset: ${url}`);
      continue;
    }
    const dependency = resolve(dirname(file), url);
    if (dependency.startsWith(resolve(root, 'dist') + sep)) {
      continue;
    }
    assert(existsSync(dependency), `Missing local artwork dependency: ${file} -> ${url}`);
  }
}
console.log('Source markup, styles and local artwork references checked (no outputs required).');
