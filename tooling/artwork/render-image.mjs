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
      const fonts = await document.fonts.load('600 16px Unbounded', 'Проверка English');
      if (!fonts.length || fonts.some((font) => font.status !== 'loaded'))
        throw Error('Accent font is unavailable');
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    if (errors.length) throw Error(errors.join('\n'));
    const image = sharp(await page.screenshot({ omitBackground: true, animations: 'disabled' }));
    const bytes = await (
      format === 'jpeg'
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
