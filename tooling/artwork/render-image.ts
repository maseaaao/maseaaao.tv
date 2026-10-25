import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright-core';
import sharp from 'sharp';

const HTTP_SCHEME_RE = /^https?:/;

export interface RenderOptions {
  format?: 'png' | 'jpeg' | 'webp';
  height: number;
  scale?: number;
  source: string;
  target: string;
  width: number;
}

export async function renderImage(
  browser: Browser,
  { source, target, width, height, format = 'png', scale = 1 }: RenderOptions,
) {
  const page = await browser.newPage({
    deviceScaleFactor: scale,
    reducedMotion: 'reduce',
    viewport: { height, width },
  });
  try {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(request.url()));
    await page.route(HTTP_SCHEME_RE, (route) => route.abort());
    await page.goto(pathToFileURL(source).href);
    await page.evaluate(async () => {
      // biome-ignore lint/performance/useTopLevelRegex: This callback runs in the browser and cannot access module constants.
      const spaceRe = /\s+/;
      const requested = new Map();
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        if (!(style.fontFamily.includes('Unbounded') && element.getClientRects().length)) {
          continue;
        }
        const text = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .trim();
        if (text) {
          requested.set(style.fontWeight, text);
        }
      }
      for (const [weight, sample] of requested) {
        // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
        const fonts = await document.fonts.load(`${weight} 16px Unbounded`, sample);
        const desired = Number(weight);
        const coversWeight = (font: FontFace) => {
          const range = font.weight.split(spaceRe).map(Number);
          const [lower] = range;
          const upper = range[1] ?? lower;
          return lower <= desired && desired <= upper;
        };
        if (
          !fonts.length ||
          fonts.some((font) => font.status !== 'loaded') ||
          !fonts.some(coversWeight)
        ) {
          throw new Error(`Accent font is unavailable for weight ${weight}`);
        }
      }
      await document.fonts.ready;
      await Promise.all([...document.images].map((imageLocal) => imageLocal.decode()));
      // Decoding does not guarantee that the compositor has painted resized
      // images. Let layout and the following paint finish before the export.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    if (errors.length) {
      throw new Error(errors.join('\n'));
    }
    const image = sharp(await page.screenshot({ animations: 'disabled', omitBackground: true }));
    const bytes = await (() => {
      if (format === 'jpeg') {
        return image
          .flatten({ background: '#f4f3ec' })
          .jpeg({ chromaSubsampling: '4:4:4', quality: 92 });
      }
      if (format === 'webp') {
        return image.webp({ effort: 6, lossless: true });
      }
      return image.png();
    })().toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== width * scale || metadata.height !== height * scale) {
      throw new Error(`Wrong dimensions: ${target}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    console.log(`${target}: ${metadata.width}x${metadata.height}`);
  } finally {
    await page.close();
  }
}
