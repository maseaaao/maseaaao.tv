import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const root = fileURLToPath(new URL('./src/', import.meta.url));
  return standaloneConfig({
    fileName: 'index.html',
    outDir: '../../../dist/moderation-dock',
    root,
  });
});
