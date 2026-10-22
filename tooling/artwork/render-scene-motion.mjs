import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../..');
const layout = JSON.parse(await fs.readFile(path.join(root, 'artwork/scenes/layout.json'), 'utf8'));
const fps = 24;
const seconds = 12;
const selected = process.argv.find((arg) => arg.startsWith('--scene='))?.slice(8);
const scenes = layout.files.filter(
  (scene) => scene.kind === 'status' && (!selected || scene.name === selected),
);
if (!scenes.length) throw new Error('Unknown status scene');
const probe = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
const [probeCode] = await once(probe, 'close');
if (probeCode !== 0) throw new Error('Install ffmpeg with libvpx-vp9 support');

// Render only a passing light over the existing blue plate. Text, QR and all
// reserved zones come from the approved still export and never move.
// Rerun render:scenes first whenever the still artwork changes.
for (const scene of scenes) {
  const source = path.join(root, 'artwork/scenes', scene.rendered);
  const output = source.replace(/\.webp$/, '.webm');
  const temporary = output.replace(/\.webm$/, '.partial.webm');
  const [left, top, width, height] = layout[scene.map].titleField;
  const tokens = await fs.readFile(path.join(root, 'packages/design/tokens.css'), 'utf8');
  const radiusRem = tokens.match(/--radius-surface:\s*([\d.]+)rem/);
  if (!radiusRem) throw new Error('Missing surface radius token');
  const radius = Number(radiusRem[1]) * 16;
  const still = await sharp(source).png().toBuffer();
  const encoder = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '24',
      '-b:v',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-row-mt',
      '1',
      '-cpu-used',
      '4',
      '-threads',
      '2',
      temporary,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const completed = once(encoder, 'close').then(([code]) => {
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  });
  async function* frames() {
    for (let frame = 0; frame < seconds * fps; frame++) {
      const phase = frame / (seconds * fps);
      let pixels = still;
      if (phase > 0.72 && phase < 0.94) {
        const progress = (phase - 0.72) / 0.22;
        const center = -0.5 + 2 * progress;
        const opacity = 0.12 * Math.sin(Math.PI * progress) ** 2;
        const light = Buffer.from(
          `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="light" x1="${center - 0.4}" x2="${center + 0.4}" y1="0" y2="0.3"><stop stop-color="white" stop-opacity="0"/><stop offset=".5" stop-color="white" stop-opacity="${opacity}"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs><rect width="${width}" height="${height}" rx="${radius}" fill="url(#light)"/></svg>`,
        );
        pixels = await sharp(still)
          .composite([{ input: light, left, top }])
          .png()
          .toBuffer();
      }
      yield pixels;
    }
  }
  try {
    await Promise.all([pipeline(Readable.from(frames()), encoder.stdin), completed]);
    await fs.rename(temporary, output);
    console.log(path.relative(root, output));
  } finally {
    if (encoder.exitCode === null) encoder.kill();
    await fs.rm(temporary, { force: true });
  }
}
