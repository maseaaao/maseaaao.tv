import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parse } from 'jsonc-parser';

const project = resolve(import.meta.dirname, '..');
const packageMetadata = JSON.parse(readFileSync(resolve(project, 'package.json'), 'utf8'));
const lockMetadata = parse(readFileSync(resolve(project, '../../bun.lock'), 'utf8'));
const encoded = readFileSync(resolve(project, 'streamerbot-import.txt'), 'utf8').trim();
const bytes = Buffer.from(encoded, 'base64');

if (bytes.subarray(0, 4).toString('ascii') !== 'SBAE') {
  throw new Error('Streamer.bot import is missing its SBAE header.');
}

const payload = JSON.parse(gunzipSync(bytes.subarray(4)).toString('utf8'));
const requiredVersion = payload.meta?.minimumVersion ?? payload.minimumVersion;

if (requiredVersion !== payload.minimumVersion) {
  throw new Error('Import metadata and root minimumVersion must match.');
}

if (payload.meta?.version !== packageMetadata.version) {
  throw new Error('Streamer.bot import version must match package.json.');
}

if (lockMetadata.workspaces?.['apps/stream-info']?.name !== packageMetadata.name) {
  throw new Error('Stream Info must have its own Bun workspace lock entry.');
}

if (requiredVersion >= payload.exportedFrom) {
  throw new Error(
    'minimumVersion must be lower than exportedFrom for Streamer.bot 1.0.7 compatibility.',
  );
}

if (payload.data?.actions?.length !== 1 || payload.data.actions[0]?.name !== 'STREAM INFO | API') {
  throw new Error('Import must contain exactly the STREAM INFO | API Action.');
}

const action = payload.data.actions[0];
if (action.triggers?.length !== 0) {
  throw new Error('STREAM INFO | API must not contain broadcast triggers.');
}
const source = Buffer.from(action.actions?.[0]?.byteCode ?? '', 'base64').toString('utf8');
if (!source.includes('UpdateTwitch') || /youtube/i.test(source)) {
  throw new Error('STREAM INFO | API must contain only Twitch support.');
}
console.log(
  `Verified Streamer.bot import: minimum ${requiredVersion}, exported from ${payload.exportedFrom}.`,
);
