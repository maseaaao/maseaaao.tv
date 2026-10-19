import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Works on an exported source tree: no Git metadata or local caches required.
export function checkMigrationContract(root) {
  for (const directory of ['src', 'assets', '.local']) {
    assert(!readdirSync(root).includes(directory), `Forbidden root directory: ${directory}`);
  }
  const wallpapers = join(root, 'artwork/wallpapers/rendered');
  const expected = new Map([
    ['desktop-4k.png', [3840, 2160]],
    ['portrait-4k.png', [2160, 3840]],
  ]);
  assert.deepEqual(
    readdirSync(wallpapers).sort(),
    [...expected.keys()].sort(),
    'Unexpected wallpaper exports',
  );
  for (const [name, dimensions] of expected) {
    const bytes = readFileSync(join(wallpapers, name));
    assert(
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      `Invalid PNG: ${name}`,
    );
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `Missing PNG dimensions: ${name}`);
    assert.deepEqual(
      [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
      dimensions,
      `Wrong wallpaper dimensions: ${name}`,
    );
  }
  const app = join(root, 'apps/stream-info');
  const htmlFiles = (directory) =>
    readdirSync(directory)
      .filter((name) => /\.html$/i.test(name))
      .sort();
  assert.deepEqual(
    htmlFiles(join(app, 'dist')),
    ['change-info-streamer-bot.ru.html'],
    'Stream Info must export only Russian HTML',
  );
  assert.deepEqual(htmlFiles(app), [], 'Legacy root Stream Info HTML');
  assert(!existsSync(join(app, 'locales')), 'Legacy Stream Info locales');
}

export function checkFontFamilies(text, file) {
  for (const match of text.matchAll(
    /(?:font-family|--(?:font-body|font-display|hud-body|hud-display|hud-mono|display))\s*:\s*([^;}]+)/g,
  )) {
    // Variable definitions are checked too; strip references but keep fallback families.
    const families = match[1].replace(/var\(\s*--[\w-]+\s*(?:,\s*)?/g, '').replace(/\)/g, '');
    for (const family of families
      .replace(/!important/g, '')
      .split(',')
      .map((value) => value.trim().replace(/["']/g, ''))
      .filter(Boolean)) {
      assert(
        ['Arial', 'Unbounded', 'sans-serif', 'inherit'].includes(family),
        `Unexpected font ${family}: ${file}`,
      );
    }
  }
}
