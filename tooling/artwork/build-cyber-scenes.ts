import fs from 'node:fs/promises';
import path from 'node:path';
import { buildArtwork } from '../build-artwork.ts';
import { launchBrowser } from './browser.ts';
import { renderImage } from './render-image.ts';

const root = path.resolve(import.meta.dirname, '../..');
const layout = JSON.parse(
  await fs.readFile(path.join(root, 'artwork/scenes/layout.json'), 'utf8'),
) as {
  files: { file: string; rendered: string; width: number; height: number }[];
};
if (!process.argv.includes('--prepared')) {
  await buildArtwork();
}
if (!process.argv.includes('--prepare')) {
  const browser = await launchBrowser({ softwareRendering: true });
  try {
    for (const file of layout.files) {
      // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
      await renderImage(browser, {
        format: 'webp',
        height: file.height,
        source: path.join(root, 'dist/artwork/html/scenes', file.file),
        target: path.join(root, 'dist/artwork/scenes', file.rendered),
        width: file.width,
      });
    }
  } finally {
    await browser.close();
  }
}
