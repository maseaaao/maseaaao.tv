import { readdir, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { standaloneConfig } from '@maseaaao/build-config';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildArtwork() {
  execFileSync(
    process.execPath,
    [path.join(root, 'tooling/artwork/build-cyber-scenes.mjs'), '--prepare'],
    { stdio: 'inherit' },
  );
  const output = path.join(root, '.build-cache/artwork');
  await rm(output, { recursive: true, force: true });
  for (const directory of [
    'scenes',
    'banners',
    'brand',
    'logo',
    'wallpapers',
    'twitch-description',
  ]) {
    const source = path.join(
      root,
      directory === 'scenes' ? '.build-cache/artwork-source' : 'artwork',
      directory,
    );
    for (const name of (await readdir(source)).filter((name) => name.endsWith('.html')).sort()) {
      const staging = path.join(root, '.build-cache/artwork-staging', directory, name);
      const config = standaloneConfig({ root: source, outDir: staging, fileName: name });
      config.build.rollupOptions = { input: path.join(source, name) };
      config.logLevel = 'warn';
      await build({ ...config, configFile: false });
      await mkdir(path.join(output, directory), { recursive: true });
      await cp(path.join(staging, name), path.join(output, directory, name));
    }
  }
  console.log('Artwork HTML prepared with embedded workspace design, fonts and local assets.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildArtwork();
