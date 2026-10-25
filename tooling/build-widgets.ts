import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerPlugins } from '@maseaaao/build-config/postcss';
import postcss from 'postcss';
import { build, transformWithOxc } from 'vite';

const root = fileURLToPath(new URL('../apps/obs-widgets/', import.meta.url));
const source = path.join(root, 'src');
const output = fileURLToPath(new URL('../dist/obs-widgets/', import.meta.url));
await rm(output, { force: true, recursive: true });
await build({
  configFile: path.join(root, 'vite.config.ts'),
  configLoader: 'native',
  mode: 'social-strip',
});
const license = (
  await readFile(new URL(import.meta.resolve('@maseaaao/design/license')), 'utf8')
).replace(/\r\n?/g, '\n');
for (const directory of ['streamlabs-chat', 'donors']) {
  // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
  await mkdir(path.join(output, directory), { recursive: true });
  const names =
    directory === 'streamlabs-chat'
      ? ['chat-box.css', 'donationalerts-alerts.css', 'chat-box.html', 'chat-box.js']
      : ['donationalerts-stream-stats.css'];
  for (const name of names) {
    const from = path.join(source, directory, name === 'chat-box.js' ? 'chat-box.ts' : name);
    const to = path.join(output, directory, name);
    if (name === 'chat-box.js') {
      // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
      const result = await transformWithOxc(await readFile(from, 'utf8'), from, {
        lang: 'ts',
        target: 'es2022',
      });
      await writeFile(to, result.code);
      continue;
    }
    if (!name.endsWith('.css')) {
      await cp(from, to);
      continue;
    }
    const result = await postcss(providerPlugins()).process(await readFile(from, 'utf8'), {
      from,
      map: false,
      to,
    });
    let css = result.css.replace(/\r\n?/g, '\n');
    if (name === 'chat-box.css') {
      for (const [marker, placeholder] of [
        ['var(--provider-font-size)', '{font_size}'],
        ['var(--provider-hide-delay)', '{message_hide_delay}'],
      ]) {
        if (css.split(marker).length !== 2) {
          throw new Error(`Expected one provider marker ${marker}`);
        }
        css = css.replace(marker, placeholder);
      }
    }
    if (css.includes('var(--provider-') || !css.includes('data:font/woff2;base64,')) {
      throw new Error(`Incomplete provider CSS: ${name}`);
    }
    await writeFile(to, `/* ${license.replaceAll('*/', '* /')} */\n${css}`);
  }
}

console.log(
  'Standalone widgets and provider CSS built; provider templates and static resources preserved.',
);
