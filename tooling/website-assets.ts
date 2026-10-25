import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const websiteImages = [
  'android-chrome-512x512.png',
  'apple-touch-icon-1024x1024.png',
  'apple-touch-icon.png',
  'assets/avatar-master.png',
  'assets/subscribe-512.png',
  'assets/subscribe-background-ai.png',
  ...[16, 32, 48].map((size) => `favicon-${size}x${size}.png`),
  'favicon.ico',
  'og-image.jpg',
];
export function generatedWebsiteImages(root: string) {
  const source = join(root, 'dist/artwork/brand/website');
  const publicDir = join(root, 'apps/website/public');
  function files(directory: string, prefix = ''): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) {
        return files(join(directory, entry.name), prefix + entry.name + '/');
      }
      if (entry.name === '.DS_Store') {
        return [];
      }
      return [prefix + entry.name];
    });
  }
  const actual = files(source).sort();
  if (actual.join('\n') !== [...websiteImages].sort().join('\n')) {
    throw new Error('Missing or unexpected generated website images');
  }
  return new Map(
    actual.map((name) => {
      if (existsSync(join(publicDir, name))) {
        throw new Error(`Website resource collision: ${name}`);
      }
      return [name, readFileSync(join(source, name))];
    }),
  );
}
