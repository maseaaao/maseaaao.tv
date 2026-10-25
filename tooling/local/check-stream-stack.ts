// Read-only live checks. Never invokes Actions, changes scenes, mute, or playback.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, fileURLToPath as fromFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { Action } from './action-targets.ts';
import { validateActionTargets } from './action-targets.ts';
import type { ConnectionRecords } from './companion-storage.ts';
import { compare } from './companion-storage.ts';
import type {
  ActionDocument,
  ButtonEntity,
  CompanionConfig,
  CompanionConnection,
  CompanionExport,
  DiagnosticsReport,
  ObsConnection,
  ObsMessage,
  ObsResponses,
  StorageObservation,
  StreamerbotMessage,
  StreamerbotSettings,
} from './diagnostic-types.ts';

const UFEFF_RE = /^\uFEFF/;

if (!process.env.STREAMERBOT_ROOT) {
  throw new Error('Set STREAMERBOT_ROOT to the installed Streamer.bot folder');
}
const root = path.resolve(process.env.STREAMERBOT_ROOT);
const jsonFile = async <T>(p: string): Promise<T> =>
  JSON.parse((await fs.readFile(p, 'utf8')).replace(UFEFF_RE, ''));
const settings = await jsonFile<StreamerbotSettings>(path.join(root, 'data/settings.json'));
const companionConfig = await jsonFile<CompanionConfig>(
  path.join(root, 'custom/companion/data/config.json'),
);
const bindHost = (h: string | undefined) =>
  ['0.0.0.0', '::', '', undefined].includes(h) ? '127.0.0.1' : h;
const sbBase = `http://${bindHost(settings.http.address)}:${settings.http.port}`;
const companionBase = `http://${bindHost(companionConfig.bind_ip)}:${companionConfig.http_port}`;
const report: DiagnosticsReport = {
  checkedAt: new Date().toISOString(),
  checks: {},
  issues: [],
  versions: {},
  warnings: [],
};
const issue = (s: string) => report.issues.push(s);
const warning = (s: string) => report.warnings.push(s);
function readApplicationStorage(instances: ConnectionRecords) {
  return new Promise<StorageObservation>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            existsSync(new URL('./compare-companion-storage.ts', import.meta.url))
              ? './compare-companion-storage.ts'
              : './compare-companion-storage.mjs',
            import.meta.url,
          ),
        ),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Storage observation timeout'));
    }, 16_000);
    child.stdout.on('data', (data) => {
      output += data;
      if (output.length > 100_000) {
        child.kill();
        reject(new Error('Storage observation output limit'));
      }
    });
    child.stderr.on('data', () => {
      /* Потоки запущенного процесса не используются: подписка подавляет EPIPE. */
    });
    child.stdin.on('error', () => {
      /* Потоки запущенного процесса не используются: подписка подавляет EPIPE. */
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Storage helper unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error('Storage observation unavailable'));
      }
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error('Invalid storage observation'));
      }
    });
    child.stdin.end(JSON.stringify({ baseUrl: companionBase, instances }));
  });
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  const b = Buffer.from(await r.arrayBuffer());
  return JSON.parse(
    (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8').replace(UFEFF_RE, ''),
  );
}
const exists = async (p: string) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
function walk(
  value: unknown,
  visit: (entity: ButtonEntity, location: string) => void,
  location = '',
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      walk(v, visit, `${location}/${i}`);
    });
  } else if (value && typeof value === 'object') {
    visit(value as ButtonEntity, location);
    for (const [k, v] of Object.entries(value)) {
      walk(v, visit, `${location}/${k}`);
    }
  }
}
let actions: Action[] | undefined;
try {
  const doc = await getJson<ActionDocument>(sbBase + '/GetActions');
  if (!Array.isArray(doc.actions)) {
    throw new Error('Invalid action list');
  }
  ({ actions } = doc);
  report.checks.streamerbotHttp = { actions: actions.length, available: true };
} catch {
  issue('Streamer.bot HTTP API unavailable; action references were not verified.');
}
let live: CompanionExport | undefined;
try {
  const [connections, exported] = await Promise.all([
    getJson<CompanionConnection[]>(companionBase + '/api/connections'),
    getJson<CompanionExport>(companionBase + '/int/export/full'),
  ]);
  live = exported;
  if (!(live.instances && live.pages)) {
    throw new Error('Invalid Companion export');
  }
  report.versions.companion = live.companionBuild;
  report.checks.companion = {
    available: true,
    connections: connections.map((c) => ({
      enabled: c.enabled,
      label: c.label,
      module: c.moduleId,
      status: c.status?.level,
      version: exported.instances[c.id]?.moduleVersionId,
    })),
  };
  let localStorageMatches = false;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(root, 'custom/companion/data/v5.0/db.sqlite'), {
      readOnly: true,
    });
    try {
      const rows = db.prepare('SELECT id, value FROM instances').all();
      const stored = Object.fromEntries(
        rows.map((r) => [r.id, JSON.parse(String(r.value)) as Record<string, unknown>]),
      );
      localStorageMatches = compare(stored, live.instances);
      report.checks.companionStoredConnections = {
        matchesLive: localStorageMatches,
        source: 'local-readonly-database',
      };
    } finally {
      db.close();
    }
  } catch {
    /* Best-effort cleanup or optional observation. */
  }
  if (!localStorageMatches) {
    try {
      const native = await readApplicationStorage(live.instances);
      report.checks.companionStoredConnections = { ...native, localReadMatchesLive: false };
      if (!native.matchesLive) {
        warning(
          'Companion application database observation differs from its live export. Retry while settings are unchanged; retain a native export before restart.',
        );
      }
    } catch {
      warning(
        'Companion local database differs or cannot be read, and application storage could not be verified. Retain a native export; this does not by itself prove a save failure.',
      );
    }
  }
  for (const c of connections) {
    if (c.enabled && c.status?.category !== 'good') {
      issue(`Companion connection ${c.label} is not ready (${c.status?.level || 'unknown'}).`);
    }
  }
  if (actions) {
    const byId = new Map(actions.map((a) => [a.id, a]));
    const byName = new Map<string, Action[]>();
    for (const a of actions) {
      const list = byName.get(a.name) || [];
      list.push(a);
      byName.set(a.name, list);
    }
    let checked = 0;
    function validateButtonAction(entity: ButtonEntity, location: string): void {
      try {
        const body = JSON.parse(entity.options?.body?.value ?? '') as {
          action?: { id?: string; name?: string };
        };
        const t = body.action || {};
        let target = t.id ? byId.get(t.id) : undefined;
        if (!t.id) {
          const matches = byName.get(t.name ?? '') || [];
          if (matches.length > 1) {
            issue(`Ambiguous action name: ${t.name}.`);
          }
          [target] = matches;
        }
        if (!target) {
          issue(`Missing Streamer.bot Action at ${location}: ${t.name || t.id || '<empty>'}.`);
        } else if (!target.enabled) {
          issue(`Disabled Streamer.bot Action: ${target.name}.`);
        }
        checked += 1;
      } catch {
        issue(`Invalid static DoAction JSON at ${location}.`);
      }
    }
    walk(live.pages, (entity, location) => {
      if (!entity.connectionId || entity.disabled || entity.definitionId !== 'post') {
        return;
      }
      const instance = exported.instances[entity.connectionId];
      if (instance?.moduleId !== 'generic-http' || entity.options?.url?.value !== '/DoAction') {
        return;
      }
      let prefix: URL;
      try {
        prefix = new URL(instance.config.prefix);
      } catch {
        issue(`Invalid HTTP base on ${instance.label}.`);
        return;
      }
      const expected = new URL(sbBase);
      const local = (h: string) => ['localhost', '127.0.0.1', '[::1]'].includes(h);
      const sameHost =
        prefix.hostname === expected.hostname ||
        (local(prefix.hostname) && local(expected.hostname));
      if (prefix.port !== expected.port || !sameHost) {
        warning(
          `Connection ${instance.label} points to a different Streamer.bot address; target validation skipped.`,
        );
        return;
      }
      if (!instance.enabled) {
        issue(`Button uses disabled connection ${instance.label}.`);
      }
      validateButtonAction(entity, location);
    });
    report.checks.buttonReferences = { checked };
    for (const i of Object.values(live.instances)) {
      if (i.enabled && i.moduleId === 'local-voice-stream') {
        for (const [key, name] of [
          ['startActionId', 'STATE | START'],
          ['stopActionId', 'STATE | STOP'],
        ]) {
          if (i.config[key]) {
            if (!byId.get(i.config[key])?.enabled) {
              issue(`VoiceStream requires enabled Action ID for ${name}.`);
            }
          } else {
            const matches = byName.get(name) || [];
            if (matches.length !== 1 || !matches[0].enabled) {
              issue(`VoiceStream requires one enabled Action named ${name}.`);
            }
          }
        }
        try {
          const url = new URL(i.config.streamerbotUrl || 'http://127.0.0.1:7474');
          if (url.origin !== new URL(sbBase).origin) {
            warning('VoiceStream uses a different Streamer.bot HTTP address.');
          }
        } catch {
          issue('VoiceStream Streamer.bot URL is invalid.');
        }
      }
    }
  }
  const localDoc = await jsonFile<ActionDocument>(path.join(root, 'data/actions.json'));
  if (actions) {
    const ids = new Set(actions.map((a) => a.id));
    if (localDoc.actions.length !== ids.size || localDoc.actions.some((a) => !ids.has(a.id))) {
      warning('Streamer.bot disk data differs from the live Action list; use live data/export.');
    }
  }
} catch {
  issue('Companion live configuration unavailable; disk snapshots were not substituted.');
}

async function connectSocket<Message extends { id?: string; d?: { requestId?: string } }>(
  url: string,
  onHello: (message: Message, socket: WebSocket) => boolean,
) {
  const ws = new WebSocket(url);
  const pending = new Map<
    string,
    {
      resolve: (message: Message) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let seq = 0;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const timer = setTimeout(() => readyReject(new Error('WebSocket handshake timeout')), 4000);
  const fail = () => {
    readyReject(new Error('WebSocket disconnected'));
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('WebSocket disconnected'));
    }
    pending.clear();
  };
  ws.onerror = fail;
  ws.onclose = fail;
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data)) as Message;
      const state = onHello(msg, ws);
      if (state === true) {
        clearTimeout(timer);
        readyResolve();
      }
      const id = msg.id || msg.d?.requestId;
      const p = pending.get(id ?? '');
      if (p) {
        clearTimeout(p.timer);
        pending.delete(id ?? '');
        p.resolve(msg);
      }
    } catch {
      fail();
    }
  };
  try {
    await ready;
  } catch (error) {
    clearTimeout(timer);
    ws.close();
    throw new Error('WebSocket unavailable', { cause: error });
  }
  return {
    close() {
      clearTimeout(timer);
      ws.close();
      fail();
    },
    request(payload: (id: string) => unknown) {
      return new Promise<Message>((resolve, reject) => {
        seq += 1;
        const id = String(seq);
        const timerLocal = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Request timeout'));
        }, 3500);
        pending.set(id, { reject, resolve, timer: timerLocal });
        try {
          ws.send(JSON.stringify(payload(id)));
        } catch {
          clearTimeout(timerLocal);
          pending.delete(id);
          reject(new Error('Socket closed'));
        }
      });
    },
  };
}
try {
  const cfg = settings.websockets;
  const socket = await connectSocket<StreamerbotMessage>(
    `ws://${bindHost(cfg.address)}:${cfg.port}${cfg.endpoint || '/'}`,
    (m, ws) => {
      if (m.id === 'auth') {
        if (m.status !== 'ok') {
          throw new Error('Authentication rejected');
        }
        return true;
      }
      if (m.request !== 'Hello') {
        return false;
      }
      if (m.authentication) {
        const secret = crypto
          .createHash('sha256')
          .update((cfg.authPassword || '') + m.authentication.salt)
          .digest('base64');
        const authentication = crypto
          .createHash('sha256')
          .update(secret + m.authentication.challenge)
          .digest('base64');
        ws.send(JSON.stringify({ authentication, id: 'auth', request: 'Authenticate' }));
        return false;
      }
      return true;
    },
  );
  try {
    const info = await socket.request((id) => ({ id, request: 'GetInfo' }));
    report.versions.streamerbot = info.info?.version;
    report.checks.streamerbotWebsocket = { available: info.status === 'ok' };
  } finally {
    socket.close();
  }
} catch {
  issue('Streamer.bot WebSocket unavailable; check connection settings.');
}

try {
  const cfg = await jsonFile<{ connections: ObsConnection[] }>(path.join(root, 'data/obs.json'));
  const c = cfg.connections.find((x) => x.default) || cfg.connections[0];
  const socket = await connectSocket<ObsMessage>(`ws://${c.host}:${c.port}`, (m, ws) => {
    if (m.op === 0) {
      const id: { rpcVersion: number; eventSubscriptions: number; authentication?: string } = {
        eventSubscriptions: 0,
        rpcVersion: 1,
      };
      if (m.d.authentication) {
        const a = m.d.authentication;
        const secret = crypto
          .createHash('sha256')
          .update((c.password || '') + a.salt)
          .digest('base64');
        id.authentication = crypto
          .createHash('sha256')
          .update(secret + a.challenge)
          .digest('base64');
      }
      ws.send(JSON.stringify({ d: id, op: 1 }));
    }
    return m.op === 2;
  });
  const request = async <Type extends keyof ObsResponses>(
    type: Type,
    data: Record<string, unknown> = {},
  ): Promise<ObsResponses[Type]> => {
    const r = await socket.request((id) => ({
      d: { requestData: data, requestId: id, requestType: type },
      op: 6,
    }));
    if (!r.d.requestStatus.result) {
      throw new Error('OBS read rejected');
    }
    return r.d.responseData as ObsResponses[Type];
  };
  try {
    const [version, stream, record, inputs] = await Promise.all([
      request('GetVersion'),
      request('GetStreamStatus'),
      request('GetRecordStatus'),
      request('GetInputList'),
    ] as const);
    report.versions.obs = version.obsVersion;
    report.checks.obs = {
      available: true,
      inputs: inputs.inputs.length,
      recording: record.outputActive,
      streaming: stream.outputActive,
    };
    const scenes = await request('GetSceneList');
    const document = await jsonFile<ActionDocument>(path.join(root, 'data/actions.json'));
    const targets = validateActionTargets(
      document.actions,
      scenes.scenes.map((s) => s.sceneName),
      inputs.inputs.map((i) => i.inputName),
    );
    targets.issues.forEach(issue);
    targets.warnings.forEach(warning);
    report.checks.actionTargets = {
      checked: targets.checked,
      note: 'Inline C# targets are not executed or exhaustively analysed.',
      source: 'disk-actions/live-OBS',
    };
    if (inputs.inputs.length > 128) {
      warning('OBS input check limit reached; remaining inputs were not checked.');
    }
    const microphoneChecks: { name: string; selectedDeviceValid: boolean }[] = [];
    const mediaFiles: { exists: boolean; name: string }[] = [];
    let browserSources = 0;
    for (const input of inputs.inputs.slice(0, 128)) {
      if (
        !['browser_source', 'wasapi_input_capture', 'ffmpeg_source', 'image_source'].includes(
          input.inputKind,
        )
      ) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: Query OBS inputs sequentially to bound pending requests.
      const { inputSettings: s } = await request('GetInputSettings', {
        inputName: input.inputName,
      });
      if (input.inputKind === 'wasapi_input_capture') {
        try {
          const list = await request('GetInputPropertiesListPropertyItems', {
            inputName: input.inputName,
            propertyName: 'device_id',
          });
          const selected = list.propertyItems.find((x) => x.itemValue === s.device_id);
          microphoneChecks.push({
            name: input.inputName,
            selectedDeviceValid: !!selected?.itemEnabled,
          });
          if (!selected?.itemEnabled) {
            issue(`OBS microphone ${input.inputName} has an unavailable selected device.`);
          }
        } catch {
          warning(`OBS microphone device list could not be checked for ${input.inputName}.`);
        }
      }
      if (input.inputKind === 'browser_source') {
        browserSources += 1;
        let file = s.is_local_file ? s.local_file : null;
        if (!file && s.url?.startsWith('file:')) {
          try {
            file = fromFileURL(s.url);
          } catch {
            /* Best-effort cleanup or optional observation. */
          }
        }
        if (file && !(await exists(file))) {
          warning(
            `OBS browser ${input.inputName}: local resource is not visible to file diagnostics; verify display in OBS.`,
          );
        }
        if (s.url) {
          try {
            const u = new URL(s.url);
            if (
              ['127.0.0.1', 'localhost', hostFromBase(companionBase)].includes(u.hostname) &&
              ['http:', 'https:'].includes(u.protocol)
            ) {
              const r = await fetch(u, { signal: AbortSignal.timeout(3000) });
              if (!r.ok) {
                issue(
                  `OBS browser ${input.inputName}: local HTTP dependency returned ${r.status}.`,
                );
              }
            }
          } catch {
            issue(`OBS browser ${input.inputName}: local HTTP dependency unavailable.`);
          }
        }
      }
      let file: string | null | undefined;
      if (input.inputKind === 'image_source') {
        ({ file } = s);
      } else if (input.inputKind === 'ffmpeg_source' && s.is_local_file) {
        file = s.local_file;
      } else {
        file = null;
      }
      if (file) {
        mediaFiles.push({ exists: await exists(file), name: input.inputName });
        if (!mediaFiles.at(-1)?.exists) {
          warning(
            `OBS source ${input.inputName}: media file is not visible to diagnostics; verify source in OBS.`,
          );
        }
      }
    }
    report.checks.obsMicrophones = microphoneChecks;
    report.checks.obsResources = { browserSources, mediaFiles };
    if (live) {
      for (const i of Object.values(live.instances)) {
        if (
          i.enabled &&
          i.moduleId === 'local-voice-stream' &&
          (String(i.config.obsHost) !== String(c.host) ||
            Number(i.config.obsPort) !== Number(c.port) ||
            String(i.config.obsPassword || '') !== String(c.password || ''))
        ) {
          issue('VoiceStream and Streamer.bot have different OBS connection settings.');
        }
      }
    }
  } finally {
    socket.close();
  }
} catch {
  issue('OBS authenticated read checks failed.');
}
function hostFromBase(url: string) {
  return new URL(url).hostname;
}

try {
  const mappings = settings.http.mapping || {};
  if (mappings['stream-info']) {
    const r = await fetch(sbBase + '/stream-info/change-info-streamer-bot.ru.html', {
      signal: AbortSignal.timeout(4000),
    });
    report.checks.streamInfo = { available: r.ok };
    if (!r.ok) {
      issue(`Stream Info returned HTTP ${r.status}.`);
    }
  }
} catch {
  issue('Stream Info page unavailable.');
}
report.ok = report.issues.length === 0;
report.ready = report.ok && report.warnings.length === 0;
const arg = process.argv.indexOf('--report');
if (arg !== -1) {
  if (!process.argv[arg + 1]) {
    throw new Error('Missing report filename');
  }
  await fs.writeFile(path.resolve(process.argv[arg + 1]), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = (() => {
  if (report.issues.length) {
    return 1;
  }
  if (report.warnings.length) {
    return 2;
  }
  return 0;
})();
