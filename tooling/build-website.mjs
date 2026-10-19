import { build } from 'vite';
import { fileURLToPath } from 'node:url';
await build({
  configFile: fileURLToPath(new URL('../apps/website/vite.config.mjs', import.meta.url)),
});
