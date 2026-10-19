import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor, within } from 'storybook/test';
import { h } from 'vue';
import chatCss from '@maseaaao/obs-widgets/delivery/chat.css?raw';
import chatTemplate from '@maseaaao/obs-widgets/delivery/chat.html?raw';
import alertsCss from '@maseaaao/obs-widgets/delivery/alerts.css?raw';
import donorsCss from '@maseaaao/obs-widgets/delivery/donors.css?raw';

const meta: Meta = { title: 'Форматы/Провайдеры', parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj;

// Provider formats are actual delivered CSS, not another Vue implementation.
// Run build:widgets before the catalog after editing a provider source.
function frame(title: string, css: string, html: string, height: number) {
  const srcdoc = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><main aria-label="${title}">${html}</main></body></html>`;
  return () => ({
    render: () =>
      h('iframe', { title, srcdoc, style: { width: '100%', height: `${height}px`, border: '0' } }),
  });
}
async function checkFrame(canvasElement: HTMLElement, title: string, text: string): Promise<void> {
  const element = within(canvasElement).getByTitle(title);
  if (!(element instanceof HTMLIFrameElement)) throw Error('Expected the provider document frame');
  await waitFor(async () => {
    const doc = element.contentDocument;
    if (!doc?.body) throw Error('Provider fixture is loading');
    await expect(within(doc.body).getByText(text, { exact: false })).toBeVisible();
    await doc.fonts.ready;
    await expect(
      [...doc.fonts].some(
        (face) => face.family === 'Unbounded' && face.weight === '400' && face.status === 'loaded',
      ),
    ).toBe(true);
  });
}
const item = chatTemplate.match(/<script[^>]*id="chatlist_item"[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!item) throw Error('Missing the actual Streamlabs item template');
const message = item
  .replaceAll('{from}', 'Тестовый зритель')
  .replaceAll('{messageId}', 'offline-fixture')
  .replaceAll('{color}', '#1616d9')
  .replaceAll('{message}', 'Проверка сообщения · Кириллица / English');
export const Streamlabs: Story = {
  render: frame(
    'Streamlabs: готовый формат',
    chatCss.replaceAll('{font_size}', '32px').replaceAll('{message_hide_delay}', '3600s'),
    `<div id="log">${message}</div>`,
    360,
  ),
  play: async ({ canvasElement }) =>
    checkFrame(canvasElement, 'Streamlabs: готовый формат', 'Проверка сообщения'),
};
export const DonationAlert: Story = {
  render: frame(
    'DonationAlerts: оповещение',
    alertsCss,
    '<div class="alert-container"><div id="donation-alert"><div class="title">Тестовый донат — 100 ₽</div><div class="message">Спасибо за стрим!</div></div></div>',
    367,
  ),
  play: async ({ canvasElement }) =>
    checkFrame(canvasElement, 'DonationAlerts: оповещение', 'Тестовый донат'),
};
export const Donors: Story = {
  render: frame(
    'DonationAlerts: донатеры',
    donorsCss,
    '<div class="widget-stream-stats"><div class="stats-list"><div class="stats-list-item"><div class="stats-item-main-row">Тестовый донатер — 100 ₽</div><div class="stats-item-additional-row">За месяц</div></div></div></div>',
    148,
  ),
  play: async ({ canvasElement }) =>
    checkFrame(canvasElement, 'DonationAlerts: донатеры', 'Тестовый донатер'),
};
