import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../../tooling/artwork/browser.ts';

for (const scale of [0.48, 0.64, 0.72, 1.08, 1.28]) {
  test(`донатер 1000×134, масштаб ${scale}: внутренняя панель стыкуется снизу`, async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { height: 134, width: 1000 } });
      await page.setContent(
        `<div style="display:table;width:1000px;height:134px;transform-origin:top left;transform:scale(${scale})"><div style="display:table-row"><div style="display:table-cell;vertical-align:bottom"><div class="widget-stream-stats"><div class="stats-list"><div class="stats-list-item"><div class="stats-item-main-row">ОченьДлинноеИмяДонатераБезПробелов</div><div class="stats-item-additional-row">999 999 RUB</div></div></div></div></div></div></div>`,
      );
      await page.addStyleTag({
        content: await readFile(`${import.meta.dir}/../../packages/design/tokens.css`, 'utf8'),
      });
      const css = await readFile(
        `${import.meta.dir}/../../apps/obs-widgets/src/donors/donationalerts-stream-stats.css`,
        'utf8',
      );
      await page.addStyleTag({ content: css.replace(/^@import[^\n]*\n/gm, '') });
      const panel = await page.locator('.stats-list').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          height: rect.height,
          radii: [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ],
          width: rect.width,
          x: rect.x,
          y: rect.y,
        };
      });
      expect(panel.x).toBeCloseTo(0, 2);
      expect(panel.y).toBeCloseTo(20 * scale, 2);
      expect(panel.width).toBeCloseTo(1000 * scale, 2);
      expect(panel.height).toBeCloseTo(114 * scale, 2);
      expect(panel.y + panel.height).toBeCloseTo(134 * scale, 2);
      expect(panel.radii).toEqual(['24px', '24px', '0px', '0px']);
      const sizes = await page
        .locator('.stats-item-main-row, .stats-item-additional-row')
        .evaluateAll((elements) =>
          elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
        );
      expect(sizes).toEqual([44, 32]);
    } finally {
      await browser.close();
    }
  });
}
