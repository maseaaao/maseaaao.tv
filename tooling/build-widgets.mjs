import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import postcss from 'postcss';
import { providerPlugins } from '@maseaaao/build-config/postcss';

const root = fileURLToPath(new URL('../apps/obs-widgets/', import.meta.url));
const source = path.join(root, 'src');
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
for (const product of ['social-strip', 'output-stats']) {
  await build({ configFile: path.join(root, 'vite.config.mjs'), mode: product });
}
const license = (
  await readFile(new URL(import.meta.resolve('@maseaaao/design/license')), 'utf8')
).replace(/\r\n?/g, '\n');
for (const directory of ['streamlabs-chat', 'donors']) {
  await mkdir(path.join(output, directory), { recursive: true });
  const names =
    directory === 'streamlabs-chat'
      ? ['chat-box.css', 'donationalerts-alerts.css', 'chat-box.html', 'chat-box.js']
      : ['donationalerts-stream-stats.css'];
  for (const name of names) {
    const from = path.join(source, directory, name);
    const to = path.join(output, directory, name);
    if (!name.endsWith('.css')) {
      await cp(from, to);
      continue;
    }
    const result = await postcss(providerPlugins()).process(await readFile(from, 'utf8'), {
      from,
      to,
      map: false,
    });
    let css = result.css.replace(/\r\n?/g, '\n');
    if (name === 'chat-box.css') {
      for (const [marker, placeholder] of [
        ['var(--provider-font-size)', '{font_size}'],
        ['var(--provider-hide-delay)', '{message_hide_delay}'],
      ]) {
        if (css.split(marker).length !== 2) throw Error(`Expected one provider marker ${marker}`);
        css = css.replace(marker, placeholder);
      }
    }
    if (css.includes('var(--provider-') || !css.includes('data:font/woff2;base64,'))
      throw Error(`Incomplete provider CSS: ${name}`);
    await writeFile(to, `/* ${license.replaceAll('*/', '* /')} */\n${css}`);
  }
}
await cp(path.join(source, 'sounds'), path.join(output, 'sounds'), { recursive: true });

console.log(
  'Standalone widgets and provider CSS built; provider templates and static resources preserved.',
);
