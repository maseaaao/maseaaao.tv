import assert from 'node:assert/strict';
import VoiceStream from './index.js';
import {createServer} from 'node:http';

function moduleStub() {
  const events = [];
  const oldSocket = {close: () => events.push('old-close')};
  const newSocket = {close: () => events.push('new-close')};
  const instance = Object.create(VoiceStream.prototype);
  Object.assign(instance, {
    ws: oldSocket, identified: true, stopped: false,
    pending: new Map(), counter: 0,
    guard: {status: () => events.push('status'), offline: () => events.push('offline')},
  });
  return {instance, events, oldSocket, newSocket};
}

let checks = 0;
{
  const {instance, events, newSocket} = moduleStub();
  let reject;
  instance.request = () => new Promise((_, r) => {reject = r;});
  const poll = instance.pollObs();
  instance.ws = newSocket;
  reject(new Error('old connection stopped'));
  await poll;
  assert.deepEqual(events, [], 'a rejected old poll must not close the replacement socket');
  checks++;
}
{
  const {instance, events, newSocket} = moduleStub();
  let resolve;
  instance.request = () => new Promise(r => {resolve = r;});
  const poll = instance.pollObs();
  instance.ws = newSocket;
  resolve({outputActive: true});
  await poll;
  assert.deepEqual(events, [], 'a successful old poll must not restore stale OBS state');
  checks++;
}
{
  const {instance, events} = moduleStub();
  instance.request = async () => {throw new Error('timeout');};
  await instance.pollObs();
  assert.deepEqual(events, ['offline', 'old-close']);
  checks++;
}
{
  const {instance} = moduleStub();
  instance.ws.send = () => {throw new Error('socket closed during send');};
  await assert.rejects(instance.request('GetStreamStatus'));
  assert.equal(instance.pending.size, 0, 'failed sends must not retain timeout entries');
  checks++;
}
{
  const {instance} = moduleStub();
  instance.stopped = true;
  await assert.rejects(instance.request('GetStreamStatus'), /offline/i);
  assert.equal(instance.pending.size, 0);
  checks++;
}
{
  const {instance, events} = moduleStub();
  const OriginalSocket = globalThis.WebSocket;
  class FailedSocket {
    close() { this.onerror(); }
  }
  try {
    globalThis.WebSocket = FailedSocket;
    instance.config = {};
    instance.connectObs();
    const socket=instance.ws;
    socket.onerror();
    assert.deepEqual(events, ['offline'], 'connection errors must not recursively close a connecting socket');
    assert.equal(instance.identified, false);
    assert.equal(instance.ws,null);
    assert.ok(instance.obsRetry, 'error without a close event must schedule reconnect');
    const retry=instance.obsRetry;
    socket.onclose();
    assert.equal(instance.obsRetry,retry,'error followed by close must not schedule another retry');
    clearTimeout(instance.obsRetry);
    assert.deepEqual(events, ['offline']);
    checks++;
  } finally { globalThis.WebSocket = OriginalSocket; }
}
{
  // Exercise Node's actual error event semantics against our own test server.
  const server=createServer((_request,response)=>{response.writeHead(503);response.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {instance,events}=moduleStub();
  instance.config={obsHost:'127.0.0.1',obsPort:server.address().port};
  let resolveOffline;
  const offline=new Promise(resolve=>{resolveOffline=resolve;});
  instance.guard.offline=()=>{events.push('offline');resolveOffline();};
  let timeout;
  try{
    instance.connectObs();
    await Promise.race([offline,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('native error not received')),3000);})]);
    assert.equal(instance.ws,null);
    assert.ok(instance.obsRetry,'native handshake failure must schedule reconnect');
    assert.deepEqual(events,['offline']);
    checks++;
  }finally{
    instance.stopped=true;clearTimeout(timeout);clearTimeout(instance.obsRetry);clearTimeout(instance.handshake);
    await new Promise(resolve=>server.close(resolve));
  }
}
console.log(`PASS: ${checks} OBS reconnect regression checks; only a local test server used, no app commands sent.`);
