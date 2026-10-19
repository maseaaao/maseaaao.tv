import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../tooling/artwork/browser.mjs';
import { renderImage } from '../tooling/artwork/render-image.mjs';

test('artwork renderer rejects a missing accent font before writing an export', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'artwork-font-'));
  const browser = await launchBrowser();
  try {
    const source = join(directory, 'source.html');
    const target = join(directory, 'export.png');
    await writeFile(source, '<!doctype html><title>Missing font</title><p>Проверка English</p>');
    await assert.rejects(
      renderImage(browser, { source, target, width: 320, height: 180 }),
      /Accent font is unavailable/,
    );
    await assert.rejects(access(target), { code: 'ENOENT' });
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
