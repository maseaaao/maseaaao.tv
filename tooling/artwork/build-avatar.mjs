import path from 'node:path';
import sharp from 'sharp';

const assets = path.resolve(import.meta.dirname, '../../apps/website/public/assets');

// Match the landing's 62/86 CSS pixels at up to 3× device pixel density.
// Keep the approved master intact and use high-quality WebP for small, retina-ready downloads.
for (const size of [64, 96, 128, 192, 288]) {
  const {size: bytes} = await sharp(path.join(assets, 'avatar-master.png'))
    .resize(size, size)
    .webp({quality: 88, effort: 6})
    .toFile(path.join(assets, `avatar-${size}.webp`));
  console.log(`avatar-${size}.webp: ${bytes} bytes`);
}
