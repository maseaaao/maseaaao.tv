import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { zipSync } from 'fflate';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('tooling/release-products.json', root), 'utf8'));
const product = catalog.products.find(({ id }) => id === 'windows-integrations');

test('released storage diagnostic runs without node_modules and retains the ZIP reader license', async () => {
  execFileSync(process.execPath, [new URL('tooling/local/build-diagnostics.mjs', root).pathname], {
    stdio: 'pipe',
  });

  const mapping = product.files.find(
    ({ target }) => target === 'diagnostics/compare-companion-storage.mjs',
  );
  assert(mapping);
  const source = new URL(mapping.source, root);
  const license = readFileSync(new URL('node_modules/fflate/LICENSE', root), 'utf8');
  assert(readFileSync(source, 'utf8').includes(license));
  const directory = mkdtempSync(join(tmpdir(), 'diagnostic-delivery-'));
  const server = createServer();
  try {
    const script = join(directory, 'compare-companion-storage.mjs');
    copyFileSync(source, script);
    const database = join(directory, 'fixture.sqlite');
    const db = new DatabaseSync(database);
    try {
      db.exec('CREATE TABLE instances (id TEXT, value TEXT)');
      db.prepare('INSERT INTO instances VALUES (?, ?)').run(
        'test',
        '{"moduleId":"fixture","enabled":true}',
      );
    } finally {
      db.close();
    }
    const raw = zipSync({ 'db.sqlite': readFileSync(database) });
    server.on('request', (request, response) => {
      assert.equal(request.url, '/int/export/support');
      response.end(raw);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const child = execFile(process.execPath, [script], { cwd: directory });
    child.stdin.end(
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}`,
        instances: { test: { moduleId: 'fixture', enabled: true } },
      }),
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), {
      matchesLive: true,
      storedConnections: 1,
      source: 'companion-application-files',
      integrity: 'ok',
    });
  } finally {
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    rmSync(directory, { recursive: true, force: true });
  }
});

test('released checker resolves its local imports without node_modules before requiring an installation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checker-delivery-'));
  try {
    for (const { source, target } of product.files.filter(({ target }) =>
      target.startsWith('diagnostics/'),
    )) {
      const output = join(directory, target);
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(new URL(source, root), output);
    }
    const result = spawnSync(process.execPath, ['diagnostics/check-stream-stack.mjs'], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, STREAMERBOT_ROOT: '' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set STREAMERBOT_ROOT to the installed Streamer.bot folder/);
    assert.doesNotMatch(result.stderr, /Cannot find (?:module|package)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
