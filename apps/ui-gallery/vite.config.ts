import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standaloneConfig } from '@maseaaao/build-config';

const ARTWORK_RE = /^\/artwork\//;

const artwork = fileURLToPath(new URL('../../dist/artwork/', import.meta.url));
const files = new Map<string, string>();
const types: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
function collect(directory: string, prefix: string) {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const source = join(directory, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collect(source, name);
    } else if (entry.isFile() && types[extname(entry.name)]) {
      files.set(name, source);
    }
  }
}
for (const group of ['logo', 'scenes', 'banners', 'twitch-description', 'wallpapers', 'brand']) {
  collect(join(artwork, group), group);
}
files.set(
  'logo/original.png',
  fileURLToPath(new URL('../../artwork/logo/logo.png', import.meta.url)),
);
files.set(
  'brand/favicon-mask.svg',
  fileURLToPath(new URL('../../artwork/brand/favicon-mask.svg', import.meta.url)),
);

const config = standaloneConfig({
  fileName: 'index.html',
  outDir: '../../../dist/ui-gallery',
  root: fileURLToPath(new URL('./src', import.meta.url)),
});
config.plugins.push({
  config: () => ({
    define: {
      __ARTWORK__: JSON.stringify(
        [...files].map(([name, source]) => ({
          bytes: statSync(source).size,
          group: name.split('/')[0],
          name,
          url: `./artwork/${name}`,
        })),
      ),
    },
  }),
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const { pathname } = new URL(request.url || '/', 'http://localhost');
      const source = files.get(pathname.replace(ARTWORK_RE, ''));
      if (!(pathname.startsWith('/artwork/') && source)) {
        return next();
      }
      response.setHeader('Content-Type', types[extname(source)] || 'application/octet-stream');
      response.end(readFileSync(source));
    });
  },
  generateBundle() {
    for (const [name, source] of files) {
      this.emitFile({ fileName: `artwork/${name}`, source: readFileSync(source), type: 'asset' });
    }
  },
  name: 'gallery-artwork',
});
export default config;
