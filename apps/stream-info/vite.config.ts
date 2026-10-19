import { standaloneConfig } from '@maseaaao/build-config';
import { fileURLToPath } from 'node:url';
export default standaloneConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  outDir: '../dist',
  fileName: 'change-info-streamer-bot.ru.html',
});
