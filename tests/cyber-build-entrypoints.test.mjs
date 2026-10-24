import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
test('production rebuild uses current generators without retired aliases', async () => {
  const p = JSON.parse(await fs.readFile(new URL('package.json', root), 'utf8'));
  assert.equal(p.scripts['render:scenes'], 'node tooling/artwork/build-cyber-scenes.mjs');
  const font = await fs.readFile(new URL('packages/design/fonts/unbounded-variable.woff2', root));
  assert.equal(font.toString('ascii', 0, 4), 'wOF2');
  assert.equal(font.readUInt32BE(8), font.length);
  assert.match(
    await fs.readFile(new URL('packages/design/licenses/Unbounded-OFL.txt', root), 'utf8'),
    /SIL OPEN FONT LICENSE/,
  );
  assert.equal((p.scripts.full.match(/bun run build:all/g) || []).length, 1);
  assert(!p.scripts.full.includes('bun run build:website'));
  assert(!p.scripts.postfull);
  for (const name of ['build-cyber-scenes.mjs', 'cyber-site-render.mjs'])
    assert(
      !(await fs.readFile(new URL('tooling/artwork/' + name, root), 'utf8')).includes('C:/Users/'),
    );
});
