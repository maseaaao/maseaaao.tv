import { fileURLToPath } from 'node:url';
import { build } from 'vite';

await build({
  configFile: fileURLToPath(new URL('../apps/website/vite.config.mjs', import.meta.url)),
});
