import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../../tooling/artwork/browser.ts';
import { logoColors, logoMasterSvg } from '../../tooling/artwork/logo-master.ts';

const directory = import.meta.dir;
// Сверяем на рабочем размере 512: эталон остаётся в 1254, но все поставляемые
// растры — 192…1024, и на этом масштабе метрика стабильна.
const SIZE = 512;
const template = await readFile(`${directory}/mark.svg`, 'utf8');
// Утверждённый растр — эталон формы: мастер собран трассировкой с него.
const referencePng = await readFile(`${directory}/logo-reference.png`);

const HEX_COLOR_RE = /#[0-9a-fA-F]{6}/;
const PATH_TAG_RE = /<path /g;
const FILL_BY_ROLE_RE = /data-fill="(brand|surface)"[^>]*fill="([^"]+)"/g;

const fillsByRole = (svg: string) =>
  Object.fromEntries(
    [...svg.matchAll(FILL_BY_ROLE_RE)].map(([, role, fill]) => [role, fill] as const),
  ) as Record<string, string>;

test('mark.svg открывается сам по себе: цвета прописаны, роли помечены', () => {
  expect(template).toContain('width="512"');
  expect(template).toContain('height="512"');
  expect(template).toContain('viewBox="0 0 512 512"');
  // плейсхолдеров нет — файл валиден в браузере и предпросмотре
  expect(template).not.toContain('{{');
  const fills = fillsByRole(template);
  expect(Object.keys(fills).sort()).toEqual(['brand', 'surface']);
  for (const fill of Object.values(fills)) {
    expect(fill).toMatch(HEX_COLOR_RE);
  }
  // одна фигура без отверстий
  expect(template.match(PATH_TAG_RE) ?? []).toHaveLength(1);
});

test('сборка перекрашивает мастер токенами палитры', async () => {
  const colors = await logoColors();
  const svg = await logoMasterSvg();
  expect(svg).toContain(`fill="${colors.background}"`);
  expect(svg).toContain(`fill="${colors.mark}"`);
  // в результате заливки — ровно значения токенов, а не дефолты мастера
  expect(fillsByRole(svg).brand).toBe(colors.background);
  expect(fillsByRole(svg).surface).toBe(colors.mark);
});

test('мастер визуально совпадает с утверждённым логотипом', async () => {
  const svg = (await logoMasterSvg())
    .replaceAll('width="512"', `width="${SIZE}"`)
    .replaceAll('height="512"', `height="${SIZE}"`);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { height: SIZE, width: SIZE } });
    const shot = async (html: string) => {
      await page.setContent(html);
      return page.screenshot({ animations: 'disabled' });
    };

    // Скриншоты вместо canvas: cross-origin SVG пачкает canvas, снимки — нет.
    const traced = await shot(`<html><body style="margin:0;background:#000">${svg}</body></html>`);
    const reference = await shot(
      `<html><body style="margin:0;background:#000"><img alt="" height="${SIZE}" src="data:image/png;base64,${referencePng.toString('base64')}" width="${SIZE}"></body></html>`,
    );

    const { iou, mismatchPct } = await page.evaluate(
      async ({ first, second, size }) => {
        const mask = async (base64: string) => {
          const img = new Image();
          img.src = `data:image/png;base64,${base64}`;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('нет 2d-контекста');
          }
          context.drawImage(img, 0, 0);
          const { data } = context.getImageData(0, 0, size, size);
          const out = new Uint8Array(size * size);
          for (let i = 0; i < size * size; i += 1) {
            const offset = i * 4;
            const luma =
              0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
            out[i] = luma > 128 ? 1 : 0;
          }
          return out;
        };
        const a = await mask(first);
        const b = await mask(second);
        let intersection = 0;
        let union = 0;
        let mismatched = 0;
        for (let i = 0; i < size * size; i += 1) {
          if (a[i] && b[i]) {
            intersection += 1;
          }
          if (a[i] || b[i]) {
            union += 1;
          }
          if (a[i] !== b[i]) {
            mismatched += 1;
          }
        }
        return { iou: intersection / union, mismatchPct: (100 * mismatched) / (size * size) };
      },
      { first: traced.toString('base64'), second: reference.toString('base64'), size: SIZE },
    );

    // Форма восстановлена трассировкой: допускаем субпиксельную разницу по краю.
    expect(iou).toBeGreaterThan(0.985);
    expect(mismatchPct).toBeLessThan(0.4);
  } finally {
    await browser.close();
  }
}, 30_000);
