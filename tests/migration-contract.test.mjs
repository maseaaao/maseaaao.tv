import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMigrationContract, checkFontFamilies } from '../tooling/migration-contract.mjs';

const root = new URL('../', import.meta.url);
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'migration-contract-'));
  try {
    mkdirSync(join(directory, 'apps/stream-info/dist'), { recursive: true });
    mkdirSync(join(directory, 'apps/stream-info/src'));
    mkdirSync(join(directory, 'apps/website/public/assets'), { recursive: true });
    writeFileSync(
      join(directory, 'apps/stream-info/dist/change-info-streamer-bot.ru.html'),
      '<html lang="ru"></html>',
    );
    const wallpapers = join(directory, 'artwork/wallpapers/rendered');
    mkdirSync(wallpapers, { recursive: true });
    const source = new URL('artwork/wallpapers/rendered/', root);
    for (const name of readdirSync(source))
      copyFileSync(new URL(name, source), join(wallpapers, name));
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('migration contract accepts a clean export without Git and allows nested src/assets', () => {
  fixture((directory) => checkMigrationContract(directory));
  checkMigrationContract(fileURLToPath(root));
});
for (const name of ['src', 'assets', '.local']) {
  test(`migration contract rejects root ${name}`, () =>
    fixture((directory) => {
      mkdirSync(join(directory, name));
      assert.throws(() => checkMigrationContract(directory), /Forbidden root directory/);
    }));
}
test('wallpaper contract rejects extra, missing, corrupt and incorrectly sized exports', () => {
  for (const mutation of [
    (directory) => writeFileSync(join(directory, 'extra.png'), ''),
    (directory) => rmSync(join(directory, 'portrait-4k.png')),
    (directory) => writeFileSync(join(directory, 'desktop-4k.png'), 'not a png'),
    (directory) =>
      copyFileSync(join(directory, 'desktop-4k.png'), join(directory, 'portrait-4k.png')),
  ])
    fixture((directory) => {
      mutation(join(directory, 'artwork/wallpapers/rendered'));
      assert.throws(() => checkMigrationContract(directory));
    });
});
test('Stream Info contract rejects old languages, root HTML and missing Russian export', () => {
  for (const path of [
    'dist/change-info-streamer-bot.en.html',
    'dist/change-info-streamer-bot.html',
    'change-info-streamer-bot.html',
  ]) {
    fixture((directory) => {
      writeFileSync(join(directory, 'apps/stream-info', path), '');
      assert.throws(() => checkMigrationContract(directory), /Stream Info/);
    });
  }
  fixture((directory) => {
    rmSync(join(directory, 'apps/stream-info/dist/change-info-streamer-bot.ru.html'));
    assert.throws(() => checkMigrationContract(directory), /Stream Info/);
  });
});
test('font contract accepts agreed families and rejects foreign families including variable fallbacks', () => {
  checkFontFamilies(
    'font-family: "Unbounded", Arial, sans-serif; font-family: inherit;',
    'fixture',
  );
  checkFontFamilies(
    '--font-body: Arial, sans-serif; font-family: var(--font-body, Arial);',
    'fixture',
  );
  for (const declaration of [
    'font-family: Roboto;',
    '--font-body: Roboto;',
    ':root { --hud-mono: Roboto; } .x { font-family: var(--hud-mono); }',
    'font-family: var(--font-body, Roboto);',
  ]) {
    assert.throws(() => checkFontFamilies(declaration, 'fixture'), /Unexpected font Roboto/);
  }
});
