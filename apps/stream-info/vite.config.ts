import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
export default standaloneConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  outDir: '../dist',
  fileName: 'change-info-streamer-bot.ru.html',
  budgets: { html: 500000, js: 220000 },
});
