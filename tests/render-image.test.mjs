import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access, readFile } from 'node:fs/promises';
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
    await writeFile(
      source,
      '<!doctype html><title>Missing font</title><p style="font:400 20px Unbounded">Проверка English</p>',
    );
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

for (const [declared, requested, passes] of [
  [400, 400, true],
  [600, 600, true],
  [600, 400, false],
]) {
  test(`artwork renderer: declared ${declared}, requested ${requested}, valid=${passes}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'artwork-weight-'));
    const browser = await launchBrowser();
    try {
      const font = await readFile(
        new URL(import.meta.resolve(`@maseaaao/design/fonts/unbounded-${declared}.woff2`)),
      );
      const source = join(directory, 'source.html');
      const target = join(directory, 'export.png');
      await writeFile(
        source,
        `<!doctype html><title>Font weight</title><style>@font-face{font-family:Unbounded;src:url(data:font/woff2;base64,${font.toString('base64')});font-weight:${declared}}p{font:${requested} 20px Unbounded;font-synthesis:none}</style><p>Проверка English</p>`,
      );
      const render = () => renderImage(browser, { source, target, width: 320, height: 180 });
      if (passes) {
        await render();
        await access(target);
      } else {
        await assert.rejects(render, /Accent font is unavailable/);
        await assert.rejects(access(target), { code: 'ENOENT' });
      }
    } finally {
      await browser.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
