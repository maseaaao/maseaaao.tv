import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildArtwork() {
  const { data, info } = await sharp(
    await readFile(path.join(root, 'apps/website/public/assets/maseaaao.tv.png')),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data !== 'https://maseaaao.tv')
    throw Error('Supplied QR is unreadable; no substitute will be invented.');
  const source = path.join(root, 'artwork');
  const output = path.join(root, '.build-cache/artwork');
  const pages = [];
  for (const directory of [
    'scenes',
    'banners',
    'brand',
    'logo',
    'wallpapers',
    'twitch-description',
  ]) {
    for (const name of (await readdir(path.join(source, directory)))
      .filter((name) => name.endsWith('.html'))
      .sort()) {
      pages.push({
        source: `${directory}/${name}`,
        output: `${directory}/${name}`,
        budgets: { html: 4000000, js: 2000 },
      });
    }
  }
  await rm(output, { recursive: true, force: true });
  for (const page of pages) {
    const temporary = path.join(root, '.build-cache/artwork-pages', page.output);
    const config = standaloneConfig({
      root: source,
      outDir: temporary,
      fileName: path.basename(page.output),
      budgets: page.budgets,
    });
    config.build.modulePreload = false;
    config.build.rollupOptions = { input: path.join(source, page.source) };
    await build({ ...config, configFile: false });
    const built = path.join(temporary, path.basename(page.output));
    const target = path.join(output, page.output);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(built, target);
  }
  console.log('Artwork: authored HTML/CSS, Vite singlefile, embedded local resources.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildArtwork();
