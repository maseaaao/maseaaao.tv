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
  if (jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data !== 'https://maseaaao.tv') {
    throw new Error('Supplied QR is unreadable; no substitute will be invented.');
  }
  const source = path.join(root, 'artwork');
  const output = path.join(root, 'dist/artwork/html');
  const pages: { budgets: { html: number; js: number }; output: string; source: string }[] = [];
  for (const directory of [
    'scenes',
    'banners',
    'brand',
    'logo',
    'wallpapers',
    'twitch-description',
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
    for (const name of (await readdir(path.join(source, directory)))
      .filter((nameLocal) => nameLocal.endsWith('.html'))
      .sort()) {
      pages.push({
        budgets: { html: 4_000_000, js: 2_000_000 },
        output: `${directory}/${name}`,
        source: `${directory}/${name}`,
      });
    }
  }
  await rm(output, { force: true, recursive: true });
  for (const page of pages) {
    const temporary = path.join(root, 'dist/.cache/artwork-pages', page.output);
    const config: import('vite').UserConfig & { build: import('vite').BuildOptions } =
      standaloneConfig({
        budgets: page.budgets,
        fileName: path.basename(page.output),
        outDir: temporary,
        root: source,
      });
    config.build = {
      ...config.build,
      modulePreload: false,
      rollupOptions: { input: path.join(source, page.source) },
    };
    // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
    await build({ ...config, configFile: false });
    const built = path.join(temporary, path.basename(page.output));
    const target = path.join(output, page.output);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(built, target);
  }
  console.log('Artwork: authored HTML/CSS, Vite singlefile, embedded local resources.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildArtwork();
}
