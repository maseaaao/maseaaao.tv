import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../../tooling/artwork/browser.ts';

const directory = import.meta.dir;
const tokensCss = await readFile(`${directory}/../../packages/design/tokens.css`, 'utf8');
// Сцена обязана следовать палитре, поэтому ожидание берётся из токена, а не
// из литерала: смена бренда не должна переписывать проверки геометрии.
const brandHex = tokensCss.match(/--color-brand:\s*(#[0-9a-f]{6})/i)?.[1];
if (!brandHex) {
  throw new Error('Missing --color-brand token');
}
const brandRgb = `rgb(${Number.parseInt(brandHex.slice(1, 3), 16)}, ${Number.parseInt(brandHex.slice(3, 5), 16)}, ${Number.parseInt(brandHex.slice(5, 7), 16)})`;
const layout = JSON.parse(await readFile(`${directory}/layout.json`, 'utf8'));
const statusScenes = layout.files.filter((scene: { kind: string }) => scene.kind === 'status');
const scenes = await Promise.all(
  statusScenes.map(async (scene: { file: string; map: string }) => ({
    ...scene,
    html: await readFile(`${directory}/${scene.file}`, 'utf8'),
  })),
);
test('status scenes keep the text nickname and the rounded mark inside the title card', () => {
  expect(scenes).toHaveLength(6);
  for (const scene of scenes) {
    expect(scene.html, scene.file).toContain('>maseaaao</p>');
    // The header identity stays text; the brand mark is a rounded square inside the title card.
    expect(scene.html, scene.file).toContain('class="title-logo"');
    expect(scene.html, scene.file).toContain('src="../logo/logo.png"');
    expect(scene.html, scene.file).not.toContain('class="identity" logo');
  }
});

test('status scenes retain QR and existing overlay zones', () => {
  for (const scene of scenes) {
    for (const zone of ['chat', 'music', 'donors', 'alerts', 'qr']) {
      expect(scene.html, `${scene.file}: ${zone}`).toContain(`data-zone="${zone}"`);
    }
    expect(scene.html, scene.file).toContain(
      'src="../../apps/website/public/assets/maseaaao.tv.png"',
    );
    if (scene.map === 'vertical-status') {
      expect(scene.html, scene.file).toContain('data-zone="social"');
    }
  }
});

for (const scene of scenes) {
  test(`${scene.file}: реальные зоны образуют стыкующуюся колонку`, async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { height: scene.height, width: scene.width },
      });
      await page.goto(pathToFileURL(`${directory}/${scene.file}`).href);
      await page.addStyleTag({
        content: await readFile(`${directory}/../../packages/design/tokens.css`, 'utf8'),
      });
      expect(
        await page.locator('.canvas.status').evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe(brandRgb);
      expect(
        await page.locator('.title-field').evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe('rgb(248, 249, 244)');
      expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).color)).toBe(
        'rgb(33, 33, 32)',
      );
      expect(await page.locator('.identity').evaluate((el) => getComputedStyle(el).color)).toBe(
        'rgb(255, 255, 255)',
      );
      const identityBounds = await page.locator('.identity').boundingBox();
      const lineBounds = await page.locator('.header-rule').boundingBox();
      expect(identityBounds).not.toBeNull();
      expect(lineBounds).not.toBeNull();
      if (!(identityBounds && lineBounds)) {
        throw new Error('Missing nickname or header line');
      }
      expect(identityBounds.y + identityBounds.height).toBeLessThan(lineBounds.y);
      const zones = await page.locator('[data-zone]').evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return [
              element.getAttribute('data-zone'),
              {
                background: style.backgroundColor,
                box: [rect.x, rect.y, rect.width, rect.height],
                radii: [
                  style.borderTopLeftRadius,
                  style.borderTopRightRadius,
                  style.borderBottomRightRadius,
                  style.borderBottomLeftRadius,
                ],
              },
            ];
          }),
        ),
      );
      const map = layout[scene.map];
      expect(scene.map).toBe(scene.width === 2560 ? 'horizontal-status' : 'vertical-status');
      for (const name of ['donors', 'chat', 'social', 'music', 'alerts', 'qr']) {
        expect(zones[name], `${scene.file}: ${name}`).toBeDefined();
        for (let index = 0; index < 4; index += 1) {
          expect(zones[name].box[index], `${scene.file}: ${name}[${index}]`).toBeCloseTo(
            map[name][index],
            1,
          );
        }
      }
      const [donors, chat, social] = ['donors', 'chat', 'social'].map((name) => zones[name].box);
      expect(donors[0]).toBe(chat[0]);
      expect(chat[0]).toBe(social[0]);
      expect(donors[2]).toBe(chat[2]);
      expect(chat[2]).toBe(social[2]);
      expect(donors[1] + donors[3]).toBe(chat[1]);
      expect(chat[1] + chat[3]).toBe(social[1]);
      expect(zones.chat.background).toBe('rgb(255, 255, 249)');
      expect(zones.chat.radii).toEqual(['0px', '0px', '0px', '0px']);
      const overlaps = (a: number[], b: number[]) =>
        a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
      for (const [i, first] of ['donors', 'chat', 'social', 'music', 'alerts', 'qr'].entries()) {
        for (const second of ['donors', 'chat', 'social', 'music', 'alerts', 'qr'].slice(i + 1)) {
          expect(
            overlaps(zones[first].box, zones[second].box),
            `${scene.file}: ${first}/${second}`,
          ).toBe(false);
        }
      }
      for (const name of ['donors', 'social', 'music', 'alerts']) {
        expect(zones[name].background, `${scene.file}: ${name} stays dynamic`).toBe(
          'rgba(0, 0, 0, 0)',
        );
      }
      const card = await page.locator('.title-field').boundingBox();
      const logo = await page.locator('.title-logo').boundingBox();
      const title = await page.locator('h1').boundingBox();
      if (!(card && logo && title)) {
        throw new Error(`${scene.file}: missing title card, brand mark or title`);
      }
      expect([card.x, card.y, card.width, card.height], scene.file).toEqual(
        map.titleField.map((value: number) => expect.closeTo(value, 0)),
      );
      // The mark is the tallest element, so its equal margins define the card.
      const logoMargin = logo.y - card.y;
      expect(
        Math.abs(logoMargin - (card.y + card.height - (logo.y + logo.height))),
        scene.file,
      ).toBeLessThan(1);
      expect(logo.x - card.x, scene.file).toBeCloseTo(32, 1);
      expect(logo.width, scene.file).toBeCloseTo(logo.height, 1);
      const logoRadii = await page
        .locator('.title-logo')
        .evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
      expect(Number.parseFloat(logoRadii), scene.file).toBeGreaterThan(0);
      const cardRadii = await page
        .locator('.title-field')
        .evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
      // Both orientations keep the same corner-to-height ratio.
      expect(Number.parseFloat(cardRadii) / card.height, scene.file).toBeCloseTo(0.22, 1);
      // The word starts after the mark and never collides with it.
      expect(title.x, scene.file).toBeGreaterThan(logo.x + logo.width);
      // Unbounded 400 draws its x-height band 0.34375em below the line box and 0.55em tall:
      // the plate and the mark share that band's centre, so the letters are not optically low.
      const fontSize = map.titleSize;
      const inkTop = title.y + 0.343_75 * fontSize;
      const inkBottom = inkTop + 0.55 * fontSize;
      expect(
        Math.abs(inkTop - card.y - (card.y + card.height - inkBottom)),
        scene.file,
      ).toBeLessThan(1.5);
    } finally {
      await browser.close();
    }
  });
}

test('реальные панели донатеров и соцполосы непрозрачны и имеют нужные углы', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const tokens = await readFile(`${directory}/../../packages/design/tokens.css`, 'utf8');
    const social = pathToFileURL(
      `${directory}/../../apps/obs-widgets/src/social-strip/index.html`,
    ).href;
    await page.goto(social);
    await page.addStyleTag({ content: tokens });
    const styles = await page.locator('.strip').evaluate((element) => {
      const css = getComputedStyle(element);
      return [
        css.backgroundColor,
        css.borderTopLeftRadius,
        css.borderTopRightRadius,
        css.borderBottomRightRadius,
        css.borderBottomLeftRadius,
      ];
    });
    expect(styles[0]).toBe('rgb(248, 249, 244)');
    expect(styles.slice(1)).toEqual(['0px', '0px', '0px', '0px']);
    await page.setContent(
      '<div class="widget-stream-stats"><div class="stats-list"><div class="stats-list-item">Тестовый донатер</div></div></div>',
    );
    await page.addStyleTag({ content: tokens });
    const donorCss = await readFile(
      `${directory}/../../apps/obs-widgets/src/donors/donationalerts-stream-stats.css`,
      'utf8',
    );
    await page.addStyleTag({ content: donorCss.replace(/^@import[^\n]*\n/gm, '') });
    const donor = await page.locator('.stats-list').evaluate((element) => {
      const css = getComputedStyle(element);
      return [
        css.backgroundColor,
        css.borderTopLeftRadius,
        css.borderTopRightRadius,
        css.borderBottomRightRadius,
        css.borderBottomLeftRadius,
      ];
    });
    expect(donor[0]).toBe('rgb(248, 249, 244)');
    expect(Number.parseFloat(donor[1])).toBeGreaterThan(0);
    expect(donor[1]).toBe(donor[2]);
    expect(donor.slice(3)).toEqual(['0px', '0px']);
  } finally {
    await browser.close();
  }
});
