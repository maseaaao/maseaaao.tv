import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { standaloneConfig } from '@maseaaao/build-config';
import { JSDOM } from 'jsdom';
import { parse } from 'jsonc-parser';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');

for (const kind of ['JS', 'HTML']) {
  test(`standalone preset rejects an actual singlefile build exceeding its ${kind} budget`, async () => {
    const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'standalone-budget-')));
    const source = resolve(directory, 'src');
    mkdirSync(source);
    writeFileSync(
      resolve(source, 'index.html'),
      '<script type="module" src="./entry.js"></script>',
    );
    writeFileSync(resolve(source, 'entry.js'), 'console.log("budget marker");');
    try {
      await assert.rejects(
        build({
          ...standaloneConfig({
            root: source,
            outDir: '../dist',
            fileName: 'index.html',
            budgets: kind === 'JS' ? { js: 0, html: 100000 } : { js: 100000, html: 0 },
          }),
          configFile: false,
          logLevel: 'silent',
        }),
        new RegExp(`${kind} budget exceeded`),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('browser installation and CI run the same exact Playwright release', () => {
  const manifest = JSON.parse(read('package.json'));
  const lock = parse(read('bun.lock'));
  const version = manifest.devDependencies['playwright-core'];
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.devDependencies['playwright-core'], version);
  assert.equal(lock.packages['playwright-core'][0], `playwright-core@${version}`);
  assert.equal(lock.workspaces[''].devDependencies['playwright-core'], version);
});

const license = readFileSync(new URL(import.meta.resolve('@maseaaao/design/license')), 'utf8')
  .replaceAll('\r\n', '\n')
  .trim();
const font = readFileSync(
  new URL(import.meta.resolve('@maseaaao/design/fonts/unbounded-variable.woff2')),
);
test('canonical variable font has a valid WOFF2 header and OFL notice', () => {
  assert.equal(font.toString('ascii', 0, 4), 'wOF2');
  assert.equal(font.readUInt32BE(8), font.length);
  assert.match(license, /SIL OPEN FONT LICENSE/);
});
for (const [name, weight] of [
  ['apps/tuna-widget/dist/obs-tuna-widget.html', 400],
  ['apps/stream-info/dist/change-info-streamer-bot.ru.html', 400],
  ['apps/obs-widgets/dist/social-strip/index.html', 400],
  ['apps/obs-widgets/dist/streamlabs-chat/chat-box.css', 400],
  ['apps/obs-widgets/dist/streamlabs-chat/donationalerts-alerts.css', 400],
  ['apps/obs-widgets/dist/donors/donationalerts-stream-stats.css', 400],
])
  test(`${name} embeds exactly the canonical font and complete license`, () => {
    const text = read(name).replaceAll('\r\n', '\n');
    assert(!read(name).includes('\r'), 'Generated text uses canonical LF on every platform');
    const fonts = [...text.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
    assert.equal(fonts.length, 1, 'One variable font, no embedded copies');
    assert(Buffer.from(fonts[0][1], 'base64').equals(font), `Canonical Unbounded ${weight}`);
    assert.match(text, /font-weight:\s*200 900/);
    assert(text.includes(license));
    if (name.endsWith('.html')) {
      const { document } = new JSDOM(text).window;
      assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"][href]').length, 0);
      for (const image of document.querySelectorAll('img[src]')) {
        const source = image.getAttribute('src');
        assert(!source || source.startsWith('data:'), `External static image: ${source}`);
      }
    }
  });

test('the website publishes the canonical font under a fingerprinted URL and preloads the same bytes', () => {
  const { document } = new JSDOM(read('dist/index.html')).window;
  const href = document.querySelector('link[rel="preload"][as="font"]').getAttribute('href');
  assert.match(href, /^\/bundles\/unbounded-variable-[\w-]+\.woff2$/);
  assert(readFileSync(resolve(root, 'dist', href.slice(1))).equals(font));
  assert(read('dist/_headers').includes('/bundles/*'));
  assert.equal(read('dist/licenses/Unbounded-OFL.txt').replaceAll('\r\n', '\n').trim(), license);
  assert(!read('dist/licenses/Unbounded-OFL.txt').includes('\r'));
});

test('provider substitution occurs after CSS processing and leaves no intermediate markers', () => {
  const css = read('apps/obs-widgets/dist/streamlabs-chat/chat-box.css');
  assert.match(css, /font-size:\s*\{font_size\}/);
  assert.match(css, /fadeAway 0?\.5s ease \{message_hide_delay\} forwards/);
  assert(!css.includes('var(--provider-'));
});

test('build configuration is not imported into browser runtime and fonts are not generated into sources', () => {
  function files(directory) {
    return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(directory + '/' + entry.name) : [directory + '/' + entry.name],
    );
  }
  for (const directory of [
    'apps/website/src',
    'apps/stream-info/src',
    'apps/tuna-widget/src',
    'apps/obs-widgets/src',
  ]) {
    for (const file of files(directory).filter((name) => /\.(?:css|html|js|ts)$/.test(name))) {
      const source = read(file);
      assert(!/data:font\/[^;]+;base64,/.test(source), `Embedded font in source: ${file}`);
      assert(
        !source.includes('@maseaaao/build-config'),
        `Build-only dependency in runtime: ${file}`,
      );
      assert(
        !/\.{2}\/.*packages\/design/.test(source),
        `Repository-relative design import: ${file}`,
      );
    }
  }
});

test('standalone preset rejects outputs that could delete or overwrite source trees', () => {
  for (const outDir of ['.', '..', 'dist'])
    assert.throws(
      () =>
        standaloneConfig({
          root: resolve(root, 'apps/tuna-widget/src'),
          outDir,
          fileName: 'test.html',
        }),
      /separate/,
    );
  assert.throws(
    () =>
      standaloneConfig({
        root: resolve(root, 'apps/tuna-widget/src'),
        outDir: '../dist',
        fileName: '../escape.html',
      }),
    /filename/,
  );
});
