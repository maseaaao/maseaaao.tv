import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const sourceRoot = resolve(root, 'integrations/streamerbot');
function combine(files: string[]) {
  const sources = files.map((file) => readFileSync(resolve(sourceRoot, file), 'utf8'));
  const imports = [...new Set(sources.flatMap((source) => source.match(/^using [^;]+;/gm) ?? []))];
  return `${imports.join('\n')}\n${sources.map((source) => source.replace(/^using [^;]+;\r?\n/gm, '')).join('\n')}`;
}
const references = [
  ...['mscorlib', 'System', 'System.Core', 'System.Net.Http', 'System.Drawing'].map(
    (name) => `C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\${name}.dll`,
  ),
  '.\\Newtonsoft.Json.dll',
];
function action(id: string, name: string, codeId: string, source: string, triggers: object[]) {
  return {
    actionGroups: [],
    actions: [
      {
        byteCode: Buffer.from(source).toString('base64'),
        delayStart: false,
        description: name,
        enabled: true,
        id: codeId,
        index: 0,
        name,
        parentId: null,
        precompile: true,
        references,
        saveResultToVariable: false,
        saveToVariable: null,
        type: 99_999,
        weight: 0,
      },
    ],
    alwaysRun: false,
    collapsedGroups: [],
    concurrent: false,
    enabled: true,
    excludeFromHistory: false,
    group: 'OBS ',
    id,
    name,
    queue: null,
    randomAction: false,
    triggers,
  };
}
const toggle = combine([
  'droidcam/DroidCamToggle.cs',
  'droidcam/CameraPresentation.cs',
  'obs-health/CompanionEndpoint.cs',
]);
const artwork = combine(['droidcam/CategoryArtwork.cs', 'droidcam/CameraPresentation.cs']);
const timerId = '6e1d83fa-5c7b-4587-b8e5-d10d9785d9e7';
const exported = {
  data: {
    actions: [
      action(
        '12810754-611b-4021-9f3e-6f51f3f4a7fe',
        'OBS | DroidCam | Toggle',
        '649b4abb-6372-40f0-8892-1daf4c4a53f2',
        toggle,
        [],
      ),
      action(
        '6cffb619-f634-460b-adbd-3190883b7de0',
        'OBS | Category Artwork | Refresh',
        '3d4f0817-c695-43b2-bd94-eb77527932fc',
        artwork,
        [
          { enabled: true, exclusions: [], id: 'aa037abc-18fd-4c60-977d-4783b6e1f751', type: 706 },
          {
            enabled: true,
            exclusions: [],
            id: '637113ad-df0d-46c1-a42c-5a279582ec68',
            timerId,
            type: 701,
          },
          {
            enabled: true,
            exclusions: [],
            gameId: null,
            gameName: null,
            gameOnly: false,
            id: '934c321f-a597-4c0d-bcc8-236e59525ab4',
            type: 118,
          },
        ],
      ),
    ],
    commands: [],
    queues: [],
    timers: [
      {
        counter: 0,
        enabled: true,
        id: timerId,
        interval: 30,
        lines: 0,
        name: 'Category artwork refresh',
        randomInterval: false,
        repeat: true,
        upperInterval: 0,
      },
    ],
    websocketClients: [],
    websocketServers: [],
  },
  exportedFrom: '1.0.7',
  meta: {
    author: 'maseaaao.tv',
    autoRunAction: null,
    description: 'Camera collapse, placeholder and IGDB category artwork.',
    minimumVersion: '1.0.6',
    name: 'OBS Camera Presentation',
    version: '1.0.0',
  },
  minimumVersion: '1.0.6',
  version: 10,
};
const compressed = gzipSync(Buffer.from(JSON.stringify(exported)));
compressed[9] = 255;
const output = resolve(root, 'dist/windows-integrations/actions/droidcam');
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, 'streamerbot-import.sb'),
  Buffer.concat([Buffer.from('SBAE'), compressed]).toString('base64'),
);
console.log('Generated OBS Camera Presentation import. Existing Companion Action ID preserved.');
