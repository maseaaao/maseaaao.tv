import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { zipSync } from 'fflate';
import { compare, inspect, inspectArchive } from './compare-companion-storage.mjs';

const config = {
  moduleInstanceType: 'connection',
  moduleId: 'local-test',
  moduleVersionId: '1',
  enabled: true,
  label: 'Test',
  config: { directory: 'C:/Проекты/стрим', a: 1 },
  secrets: { test: 'fixture' },
};
const live = { c: config };

test('surface and object key order do not create a false warning', () => {
  const reordered = { ...config, config: { a: 1, directory: 'C:/Проекты/стрим' } };
  assert(compare({ c: reordered, s: { moduleInstanceType: 'surface' } }, live));
});
test('missing, extra, changed and renamed connections are detected', () => {
  for (const stored of [
    {},
    { c: config, extra: config },
    { other: config },
    { c: { ...config, moduleVersionId: '2' } },
    { c: { ...config, secrets: { test: 'changed' } } },
  ])
    assert.equal(compare(stored, live), false);
});

function archiveFixture(wal, run) {
  const directory = mkdtempSync(join(tmpdir(), 'companion-storage-test-'));
  const path = join(directory, 'db.sqlite');
  const db = new DatabaseSync(path);
  try {
    if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    db.exec('CREATE TABLE instances (id TEXT, value TEXT)');
    db.prepare('INSERT INTO instances VALUES (?, ?)').run('c', JSON.stringify(config));
    const files = {
      'db.sqlite': readFileSync(path),
      '../untrusted.txt': Buffer.from('never extract'),
    };
    if (wal) {
      files['db.sqlite-wal'] = readFileSync(`${path}-wal`);
      files['db.sqlite-shm'] = readFileSync(`${path}-shm`);
    }
    return run(zipSync(files));
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
for (const wal of [false, true]) {
  test(`reads only application archive copies, with WAL=${wal}`, () =>
    archiveFixture(wal, (raw) => {
      const before = Buffer.from(raw);
      assert.deepEqual(inspectArchive(raw, live), {
        matchesLive: true,
        storedConnections: 1,
        source: 'companion-application-files',
        integrity: 'ok',
      });
      assert.deepEqual(Buffer.from(raw), before);
      assert.equal(inspectArchive(raw, {}).matchesLive, false);
    }));
}

test('invalid, missing and oversized databases are rejected before opening', () => {
  assert.throws(
    () => inspectArchive(zipSync({ 'other.txt': Buffer.from('no DB') }), live),
    /database absent/,
  );
  assert.throws(() => inspectArchive(zipSync({ 'db.sqlite': Buffer.from('invalid') }), live));
  assert.throws(() => inspectArchive(new Uint8Array(32 * 1024 * 1024 + 1), live), /archive limit/);
  // ZIP central-directory size is checked before decompression/allocation.
  const raw = zipSync({ 'db.sqlite': new Uint8Array(1) });
  const central = Buffer.from(raw).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  new DataView(raw.buffer, raw.byteOffset).setUint32(central + 24, 64 * 1024 * 1024 + 1, true);
  assert.throws(() => inspectArchive(raw, live), /database size limit/);
});

test('HTTP export and standalone stdin/stdout protocol use no live application', async () => {
  const raw = archiveFixture(true, (bytes) => bytes);
  const server = createServer((request, response) => {
    assert.equal(request.url, '/int/export/support');
    response.end(raw);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.equal((await inspect(baseUrl, live)).matchesLive, true);
    const child = execFile(process.execPath, [
      join(import.meta.dirname, 'compare-companion-storage.mjs'),
    ]);
    child.stdin.end(JSON.stringify({ baseUrl, instances: live }));
    const { stdout } = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data;
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve({ stdout }) : reject(new Error(stderr))));
    });
    assert.equal(JSON.parse(stdout).matchesLive, true);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('CLI failures have generic output without private paths or addresses', async () => {
  const child = execFile(process.execPath, [
    join(import.meta.dirname, 'compare-companion-storage.mjs'),
  ]);
  child.stdin.end('invalid private-fixture');
  let stdout = '';
  child.stdout.on('data', (data) => {
    stdout += data;
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(stdout), {
    verified: false,
    reason: 'Application database observation unavailable',
  });
});
