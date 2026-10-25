import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const project = resolve(import.meta.dirname, '..');
const packageMetadata: { version: string } = JSON.parse(
  readFileSync(resolve(project, 'package.json'), 'utf8'),
);
// Collect every helper's imports before all classes; Streamer.bot compiles one
// combined source, not separate compilation units. Keep helper order explicit.
const sources = [
  'action.cs',
  'state-cache-policy.cs',
  'category-search-policy.cs',
  'category-search-service.cs',
  'category-search-transport.cs',
].map((name) =>
  readFileSync(resolve(project, 'streamerbot', name), 'utf8').replace(/\r\n?/g, '\n'),
);
const usings = [...new Set(sources.flatMap((source) => source.match(/^using [^;]+;/gm) ?? []))];
const bodies = sources.map((source) =>
  source
    .split(String.fromCharCode(10))
    .filter((line) => !line.startsWith('using '))
    .join(String.fromCharCode(10))
    .trim(),
);
const actionSource = `${usings.join('\n')}\n\n${bodies.join('\n\n')}\n`;
const EXPORTED_FROM = '1.0.7';
// Streamer.bot 1.0.7 rejects an import when minimumVersion equals its own
// version, so the compatibility floor must stay below the exporter version.
const MINIMUM_COMPATIBLE_VERSION = '1.0.6';

// This is the Streamer.bot 1.0.x export schema: SBAE + gzip + base64.  The
// shape was cross-checked against an official Streamer.bot import and the
// resulting action is compiled by an isolated real 1.0.7 instance in tests.
const action = {
  actionGroups: [],
  actions: [
    {
      byteCode: Buffer.from(actionSource, 'utf8').toString('base64'),
      delayStart: false,
      description: 'Internal API for change-info-streamer-bot.html',
      enabled: true,
      id: '008b1b1d-569b-4534-bf65-cd51d54fa826',
      index: 0,
      name: 'STREAM INFO API router',
      parentId: null,
      precompile: true,
      references: [
        'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\mscorlib.dll',
        'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.dll',
        'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Core.dll',
        'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Net.Http.dll',
        '.\\Newtonsoft.Json.dll',
      ],
      saveResultToVariable: false,
      saveToVariable: null,
      type: 99_999,
      weight: 0.0,
    },
  ],
  alwaysRun: false,
  collapsedGroups: [],
  concurrent: true,
  enabled: true,
  excludeFromHistory: false,
  group: 'STREAM INFO',
  id: '9c4b1bc3-e5d8-458d-9171-69e74c89289a',
  name: 'STREAM INFO | API',
  queue: null,
  randomAction: false,
  triggers: [],
};

const exported = {
  data: {
    actions: [action],
    commands: [],
    queues: [],
    timers: [],
    websocketClients: [],
    websocketServers: [],
  },
  exportedFrom: EXPORTED_FROM,
  meta: {
    author: 'change-info-streamer-bot',
    autoRunAction: null,
    description: 'Twitch API for the standalone Stream Info HTML.',
    minimumVersion: MINIMUM_COMPATIBLE_VERSION,
    name: 'STREAM INFO | API',
    version: packageMetadata.version,
  },
  minimumVersion: MINIMUM_COMPATIBLE_VERSION,
  version: 10,
};

export type StreamerbotImport = typeof exported;

const compressed = gzipSync(Buffer.from(JSON.stringify(exported), 'utf8'));
// gzip's OS marker otherwise differs between Windows and Linux checkouts.
compressed[9] = 255;
const importCode = Buffer.concat([Buffer.from('SBAE', 'ascii'), compressed]).toString('base64');
const output = resolve(project, '../../dist/.cache/stream-info');
mkdirSync(output, { recursive: true });
const importPath = resolve(output, 'streamerbot-import.txt');
writeFileSync(importPath, `${importCode}\n`, 'utf8');
console.log(`Generated native import string (${importCode.length} characters).`);
