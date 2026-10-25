import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { InstanceStatus } from '@companion-module/base';
import SystemMicrophone from '../system-microphone/index.ts';
import VoiceStream, { type StreamStatus } from './index.ts';

function moduleStub() {
  const events: string[] = [];
  const oldSocket = Object.assign(Object.create(WebSocket.prototype) as WebSocket, {
    close: () => {
      events.push('old-close');
    },
  });
  const newSocket = Object.assign(Object.create(WebSocket.prototype) as WebSocket, {
    close: () => {
      events.push('new-close');
    },
  });
  const instance = Object.create(VoiceStream.prototype) as VoiceStream;
  Object.assign(instance, {
    counter: 0,
    guard: { offline: () => events.push('offline'), status: () => events.push('status') },
    identified: true,
    pending: new Map(),
    stopped: false,
    ws: oldSocket,
  });
  return { events, instance, newSocket, oldSocket };
}

let checks = 0;
{
  const instance = Object.create(VoiceStream.prototype) as VoiceStream;
  const starts: string[] = [];
  const statuses: InstanceStatus[] = [];
  for (const method of [
    'setVariableDefinitions',
    'setActionDefinitions',
    'setFeedbackDefinitions',
    'setPresetDefinitions',
    'setVariableValues',
    'checkFeedbacks',
  ] as const) {
    instance[method] = () => {
      /* Заглушка зависимости: поведение не требуется по умолчанию. */
    };
  }
  instance.updateStatus = (status) => statuses.push(status);
  instance.startAudio = () => starts.push('audio');
  instance.connectObs = () => starts.push('obs');
  instance.startDiscord = () => starts.push('discord');
  const config = {
    startActionId: 'abcdefab-1234-4567-89ab-abcdefabcdef',
    stopActionId: 'fedcbafe-1234-4567-89ab-fedcbafedcba',
  };
  try {
    await instance.init(config);
    assert.deepEqual(starts, ['audio', 'obs', 'discord']);
    for (const invalid of [
      { ...config, stopActionId: config.startActionId.toUpperCase() },
      { ...config, startActionId: config.stopActionId.toUpperCase() },
      { ...config, stopActionId: config.startActionId },
      { ...config, startActionId: 'not-a-uuid' },
    ]) {
      starts.length = 0;
      // biome-ignore lint/performance/noAwaitInLoops: Each step observes shared fixture state; keep browser actions and lifecycle checks in order.
      await instance.configUpdated(invalid);
      assert.equal(statuses.at(-1), InstanceStatus.BadConfig);
      assert.equal(instance.stopped, true);
      assert.equal(instance.guard.online, false);
      assert.deepEqual(starts, [], 'invalid IDs must not start audio, OBS or Discord');
      instance.restart();
      assert.deepEqual(starts, [], 'manual reconnect must preserve validation');
    }
    const corrected = { ...config, startActionId: config.startActionId.toUpperCase() };
    await instance.configUpdated(corrected);
    assert.equal(instance.stopped, false);
    assert.deepEqual(starts, ['audio', 'obs', 'discord']);
    assert.deepEqual(instance.config, corrected, 'comparison must not rewrite saved IDs');
    checks += 1;
  } finally {
    instance.stop();
  }
}
{
  const instance = Object.create(SystemMicrophone.prototype) as SystemMicrophone;
  const events: string[] = [];
  Object.assign(instance, {
    offline: () => events.push('offline'),
    start: () => events.push('start'),
    stop: () => events.push('stop'),
    updateStatus: () => events.push('bad-config'),
  });
  await instance.configUpdated({ deviceId: 'fixture-pinned-device' });
  assert.deepEqual(
    events,
    ['stop', 'offline', 'bad-config'],
    'missing device type must fail closed without crashing the module',
  );
  for (const dataFlow of ['capture', 'render']) {
    events.length = 0;
    const config = { dataFlow, deviceId: 'fixture-pinned-device' };
    // biome-ignore lint/performance/noAwaitInLoops: Each step observes shared fixture state; keep browser actions and lifecycle checks in order.
    await instance.configUpdated(config);
    assert.deepEqual(events, ['stop', 'start']);
    assert.deepEqual(
      instance.config,
      config,
      'explicit endpoint and input/output type must be preserved',
    );
  }
  checks += 1;
}
{
  // No real helper, OBS socket or Action: exercise invalid reconfiguration in isolation.
  const instance = Object.create(VoiceStream.prototype) as VoiceStream;
  const events: string[] = [];
  Object.assign(instance, {
    config: {
      startActionId: '11111111-1111-4111-8111-111111111111',
      stopActionId: '22222222-2222-4222-8222-222222222222',
    },
    connectObs: () => events.push('obs'),
    startAudio: () => events.push('audio'),
    startDiscord: () => events.push('discord'),
    stop: () => events.push('stop'),
    updateStatus: (status: InstanceStatus) => events.push(status),
  });
  await instance.configUpdated({ startActionId: ' ', stopActionId: 'not-an-id' });
  assert.ok(events.includes('stop'), 'invalid reconfiguration must stop the previous runtime');
  assert.ok(!events.includes('audio'), 'invalid IDs must not start the helper');
  events.length = 0;
  instance.restart(); // the Heal action must not bypass validation
  assert.ok(!events.includes('audio'), 'Heal must not restart invalid configuration');
  clearInterval(instance.monitor);
  checks += 1;
}
{
  const { instance, events, newSocket } = moduleStub();
  let reject!: (reason: Error) => void;
  instance.request = () =>
    new Promise((_, r) => {
      reject = r;
    });
  const poll = instance.pollObs();
  instance.ws = newSocket;
  reject(new Error('old connection stopped'));
  await poll;
  assert.deepEqual(events, [], 'a rejected old poll must not close the replacement socket');
  checks += 1;
}
{
  const { instance, events, newSocket } = moduleStub();
  let resolve!: (status: StreamStatus) => void;
  instance.request = () =>
    new Promise((r) => {
      resolve = r;
    });
  const poll = instance.pollObs();
  instance.ws = newSocket;
  resolve({ outputActive: true });
  await poll;
  assert.deepEqual(events, [], 'a successful old poll must not restore stale OBS state');
  checks += 1;
}
{
  const { instance, events } = moduleStub();
  instance.request = () => Promise.reject(new Error('timeout'));
  await instance.pollObs();
  assert.deepEqual(events, ['offline', 'old-close']);
  checks += 1;
}
{
  const { instance } = moduleStub();
  assert(instance.ws);
  instance.ws.send = () => {
    throw new Error('socket closed during send');
  };
  await assert.rejects(instance.request('GetStreamStatus'));
  assert.equal(instance.pending.size, 0, 'failed sends must not retain timeout entries');
  checks += 1;
}
{
  const { instance } = moduleStub();
  instance.stopped = true;
  await assert.rejects(instance.request('GetStreamStatus'), /offline/i);
  assert.equal(instance.pending.size, 0);
  checks += 1;
}
{
  const { instance, events } = moduleStub();
  const OriginalSocket = globalThis.WebSocket;
  class FailedSocket {
    onerror: (() => void) | null = null;
    close() {
      this.onerror?.();
    }
  }
  try {
    // Deliberately partial constructor: only close/error lifecycle is exercised.
    globalThis.WebSocket = FailedSocket as unknown as typeof WebSocket;
    instance.config = {};
    instance.connectObs();
    const socket = instance.ws;
    assert(socket);
    assert(socket.onerror);
    assert(socket.onclose);
    socket.onerror.call(socket, new Event('error'));
    assert.deepEqual(
      events,
      ['offline'],
      'connection errors must not recursively close a connecting socket',
    );
    assert.equal(instance.identified, false);
    assert.equal(instance.ws, null);
    assert.ok(instance.obsRetry, 'error without a close event must schedule reconnect');
    const retry = instance.obsRetry;
    socket.onclose.call(socket, new CloseEvent('close'));
    assert.equal(
      instance.obsRetry,
      retry,
      'error followed by close must not schedule another retry',
    );
    clearTimeout(instance.obsRetry);
    assert.deepEqual(events, ['offline']);
    checks += 1;
  } finally {
    globalThis.WebSocket = OriginalSocket;
  }
}
{
  // Exercise Node's actual error event semantics against our own test server.
  const server = createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { instance, events } = moduleStub();
  const address = server.address();
  assert(address && typeof address !== 'string');
  instance.config = { obsHost: '127.0.0.1', obsPort: address.port };
  let resolveOffline!: () => void;
  const offline = new Promise<void>((resolve) => {
    resolveOffline = resolve;
  });
  instance.guard.offline = () => {
    events.push('offline');
    resolveOffline();
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    instance.connectObs();
    await Promise.race([
      offline,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('native error not received')), 3000);
      }),
    ]);
    assert.equal(instance.ws, null);
    assert.ok(instance.obsRetry, 'native handshake failure must schedule reconnect');
    assert.deepEqual(events, ['offline']);
    checks += 1;
  } finally {
    instance.stopped = true;
    clearTimeout(timeout);
    clearTimeout(instance.obsRetry);
    clearTimeout(instance.handshake);
    await new Promise((resolve) => server.close(resolve));
  }
}
{
  const instance = Object.create(VoiceStream.prototype) as VoiceStream;
  const calls: { url: string; body: unknown }[] = [];
  for (const method of [
    'setVariableDefinitions',
    'setActionDefinitions',
    'setFeedbackDefinitions',
    'setPresetDefinitions',
    'updateStatus',
    'setVariableValues',
    'checkFeedbacks',
  ] as const) {
    instance[method] = () => {
      /* Заглушка зависимости: поведение не требуется по умолчанию. */
    };
  }
  Object.assign(instance, {
    connectObs: () => {
      /* Заглушка зависимости: поведение не требуется по умолчанию. */
    },
    startAudio: () => {
      /* Заглушка зависимости: поведение не требуется по умолчанию. */
    },
    startDiscord: () => {
      /* Заглушка зависимости: поведение не требуется по умолчанию. */
    },
  });
  const config = {
    startActionId: '11111111-1111-4111-8111-111111111111',
    stopActionId: '22222222-2222-4222-8222-222222222222',
    streamerbotUrl: 'http://fixture.invalid:7474',
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = Object.assign((url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(typeof options?.body, 'string');
      calls.push({ body: JSON.parse(String(options?.body)), url: String(url) });
      return Promise.resolve(new Response(null, { status: 200 }));
    }, originalFetch);
    await instance.init(config);
    await instance.guard.dispatch('STATE | START');
    await instance.guard.dispatch('STATE | STOP');
    assert.deepEqual(
      calls.map((c) => c.body),
      [{ action: { id: config.startActionId } }, { action: { id: config.stopActionId } }],
      'dispatch must use IDs only, never legacy Action names',
    );
    assert.ok(calls.every((c) => c.url === 'http://fixture.invalid:7474/DoAction'));
    for (const invalid of [
      {},
      { ...config, startActionId: ' ' },
      { ...config, startActionId: config.stopActionId },
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: Each step observes shared fixture state; keep browser actions and lifecycle checks in order.
      await instance.configUpdated(invalid);
      assert.equal(instance.stopped, true);
      assert.equal(instance.guard.online, false);
    }
    await instance.configUpdated(config);
    assert.equal(
      instance.stopped,
      false,
      'corrected configuration must recover without recreating the connection',
    );
    assert.deepEqual(instance.config, config);
    checks += 1;
  } finally {
    instance.stop();
    globalThis.fetch = originalFetch;
  }
}
console.log(
  `PASS: ${checks} configuration / OBS reconnect regression checks; mocked fetch and local test server only, no app commands sent.`,
);
