import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { renderImage } from './render-image.mjs';
import { buildArtwork } from '../build-artwork.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const layout = JSON.parse(await fs.readFile(path.join(root, 'artwork/scenes/layout.json'), 'utf8'));
if (!process.argv.includes('--prepared')) await buildArtwork();
if (!process.argv.includes('--prepare')) {
  const browser = await launchBrowser({ softwareRendering: true });
  try {
    for (const file of layout.files)
      await renderImage(browser, {
        source: path.join(root, '.build-cache/artwork/scenes', file.file),
        target: path.join(root, 'artwork/scenes', file.rendered),
        width: file.width,
        height: file.height,
        format: 'webp',
      });
  } finally {
    await browser.close();
  }
}
