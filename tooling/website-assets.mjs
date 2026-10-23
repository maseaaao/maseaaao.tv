import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const websiteImages = [
  'android-chrome-512x512.png',
  'apple-touch-icon-1024x1024.png',
  'apple-touch-icon.png',
  ...[64, 96, 128, 192, 288].map((size) => `assets/avatar-${size}.webp`),
  'assets/subscribe-512.png',
  'assets/subscribe-background-ai.png',
  ...[16, 32, 48].map((size) => `favicon-${size}x${size}.png`),
  'favicon.ico',
  'og-image.jpg',
];
export function generatedWebsiteImages(root) {
  const source = join(root, 'artwork/brand/rendered/website');
  const publicDir = join(root, 'apps/website/public');
  function files(directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(directory, entry.name), prefix + entry.name + '/')
        : entry.name === '.DS_Store'
          ? []
          : [prefix + entry.name],
    );
  }
  const actual = files(source).sort();
  if (actual.join('\n') !== [...websiteImages].sort().join('\n'))
    throw Error('Missing or unexpected generated website images');
  return new Map(
    actual.map((name) => {
      if (existsSync(join(publicDir, name))) throw Error(`Website resource collision: ${name}`);
      return [name, readFileSync(join(source, name))];
    }),
  );
}
