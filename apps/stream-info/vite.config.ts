import { fileURLToPath } from 'node:url';
import { vueStandaloneConfig } from '@maseaaao/build-config/vue';
export default vueStandaloneConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  outDir: '../dist',
  fileName: 'change-info-streamer-bot.ru.html',
  budgets: { html: 400000, js: 220000 },
});
