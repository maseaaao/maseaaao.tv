// Observe application-provided DB/WAL copies only. Never open the working database.
// The support archive is an observation, not a transactional restoration backup.

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import type { ConnectionRecords } from './companion-storage.ts';
import { compare, connections } from './companion-storage.ts';

const archiveLimit = 32 * 1024 * 1024;
const databaseLimit = 64 * 1024 * 1024;
const databaseFiles = new Set(['db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm']);

export function inspectArchive(raw: Uint8Array, live: ConnectionRecords) {
  if (raw.byteLength > archiveLimit) {
    throw new Error('archive limit');
  }
  const files: Partial<Record<string, Uint8Array>> = unzipSync(raw, {
    filter: ({ name, originalSize }) => {
      if (!databaseFiles.has(name)) {
        return false;
      }
      if (originalSize > databaseLimit) {
        throw new Error('database size limit');
      }
      return true;
    },
  });
  if (!files['db.sqlite']) {
    throw new Error('database absent');
  }
  const target = realpathSync(mkdtempSync(join(tmpdir(), 'companion-readonly-')));
  try {
    if (dirname(target) !== realpathSync(tmpdir())) {
      throw new Error('unexpected temporary directory');
    }
    for (const name of databaseFiles) {
      if (files[name]) {
        writeFileSync(join(target, name), files[name]);
      }
    }
    const db = new DatabaseSync(join(target, 'db.sqlite'), { readOnly: true });
    try {
      if (Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0] !== 'ok') {
        throw new Error('inconsistent archive');
      }
      const stored = Object.fromEntries(
        db
          .prepare('SELECT id, value FROM instances')
          .all()
          .map(({ id, value }) => [id, JSON.parse(String(value)) as Record<string, unknown>]),
      );
      return {
        integrity: 'ok',
        matchesLive: compare(stored, live),
        source: 'companion-application-files',
        storedConnections: Object.keys(connections(stored)).length,
      };
    } finally {
      db.close();
    }
  } finally {
    rmSync(target, { force: true, recursive: true });
  }
}

export async function inspect(baseUrl: string, live: ConnectionRecords) {
  const response = await fetch(baseUrl + '/int/export/support', {
    signal: AbortSignal.timeout(12_000),
  });
  if (!(response.ok && response.body)) {
    throw new Error('archive unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: The stream ends via the done flag, not the loop condition.
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: Read each stream chunk before requesting the next one.
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > archiveLimit) {
        throw new Error('archive limit');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return inspectArchive(Buffer.concat(chunks), live);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      baseUrl: string;
      instances: ConnectionRecords;
    };
    console.log(JSON.stringify(await inspect(request.baseUrl, request.instances)));
  } catch {
    // Exception details may contain private paths/addresses; keep output generic.
    console.log(
      JSON.stringify({ reason: 'Application database observation unavailable', verified: false }),
    );
    process.exitCode = 1;
  }
}
