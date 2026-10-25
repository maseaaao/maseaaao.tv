import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';

const config = standaloneConfig({
  budgets: { html: 2_000_000, js: 2_000_000 },
  fileName: 'change-info-streamer-bot.ru.html',
  outDir: '../../../dist/stream-info',
  root: fileURLToPath(new URL('./src', import.meta.url)),
});
config.plugins.push({
  generateBundle() {
    this.emitFile({
      fileName: 'streamerbot-import.txt',
      source: readFileSync(
        new URL('../../dist/.cache/stream-info/streamerbot-import.txt', import.meta.url),
      ),
      type: 'asset',
    });
  },
  name: 'streamerbot-import',
});
export default config;
