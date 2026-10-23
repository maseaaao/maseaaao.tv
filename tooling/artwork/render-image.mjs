import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export async function renderImage(
  browser,
  { source, target, width, height, format = 'png', scale = 1 },
) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: 'reduce',
  });
  try {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(request.url()));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(source).href);
    await page.evaluate(async () => {
      const requested = new Map();
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        if (!style.fontFamily.includes('Unbounded') || !element.getClientRects().length) continue;
        const text = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .trim();
        if (text) requested.set(style.fontWeight, text);
      }
      for (const [weight, sample] of requested) {
        const fonts = await document.fonts.load(`${weight} 16px Unbounded`, sample);
        const desired = Number(weight);
        const coversWeight = (font) => {
          const range = font.weight.split(/\s+/).map(Number);
          const lower = range[0];
          const upper = range[1] ?? lower;
          return lower <= desired && desired <= upper;
        };
        if (
          !fonts.length ||
          fonts.some((font) => font.status !== 'loaded') ||
          !fonts.some(coversWeight)
        )
          throw Error(`Accent font is unavailable for weight ${weight}`);
      }
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
      // Decoding does not guarantee that the compositor has painted resized
      // images. Let layout and the following paint finish before the export.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    if (errors.length) throw Error(errors.join('\n'));
    const image = sharp(await page.screenshot({ omitBackground: true, animations: 'disabled' }));
    const bytes = await (format === 'jpeg'
      ? image.flatten({ background: '#f4f3ec' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      : format === 'webp'
        ? image.webp({ lossless: true, effort: 6 })
        : image.png()
    ).toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== width * scale || metadata.height !== height * scale)
      throw Error(`Wrong dimensions: ${target}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    console.log(`${target}: ${metadata.width}x${metadata.height}`);
  } finally {
    await page.close();
  }
}
