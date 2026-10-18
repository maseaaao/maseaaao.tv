import assert from 'node:assert/strict';
import VoiceStream from './index.js';
import {createServer} from 'node:http';
import SystemMicrophone from '../system-microphone/index.js';

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
  const instance=Object.create(SystemMicrophone.prototype);
  const events=[];
  Object.assign(instance, {stop:()=>events.push('stop'),start:()=>events.push('start'),
    offline:()=>events.push('offline'),updateStatus:()=>events.push('bad-config')});
  await instance.configUpdated({deviceId:'fixture-pinned-device'});
  assert.deepEqual(events,['stop','offline','bad-config'], 'missing device type must fail closed without crashing the module');
  for(const dataFlow of ['capture','render']){
    events.length=0;
    const config={deviceId:'fixture-pinned-device',dataFlow};
    await instance.configUpdated(config);
    assert.deepEqual(events,['stop','start']);
    assert.deepEqual(instance.config,config,'explicit endpoint and input/output type must be preserved');
  }
  checks++;
}
{
  // No real helper, OBS socket or Action: exercise invalid reconfiguration in isolation.
  const instance = Object.create(VoiceStream.prototype);
  const events = [];
  Object.assign(instance, {
    config: {startActionId:'11111111-1111-4111-8111-111111111111',stopActionId:'22222222-2222-4222-8222-222222222222'},
    stop:()=>events.push('stop'), startAudio:()=>events.push('audio'),
    connectObs:()=>events.push('obs'), startDiscord:()=>events.push('discord'),
    updateStatus:(status)=>events.push(status),
  });
  await instance.configUpdated({startActionId:' ',stopActionId:'not-an-id'});
  assert.ok(events.includes('stop'), 'invalid reconfiguration must stop the previous runtime');
  assert.ok(!events.includes('audio'), 'invalid IDs must not start the helper');
  events.length=0;
  instance.restart(); // the Heal action must not bypass validation
  assert.ok(!events.includes('audio'), 'Heal must not restart invalid configuration');
  clearInterval(instance.monitor);
  checks++;
}
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
{
  const instance=Object.create(VoiceStream.prototype);
  const calls=[];
  for(const method of ['setVariableDefinitions','setActionDefinitions','setFeedbackDefinitions','setPresetDefinitions','updateStatus','setVariableValues','checkFeedbacks'])instance[method]=()=>{};
  Object.assign(instance,{startAudio:()=>{},connectObs:()=>{},startDiscord:()=>{}});
  const config={startActionId:'11111111-1111-4111-8111-111111111111',stopActionId:'22222222-2222-4222-8222-222222222222',streamerbotUrl:'http://fixture.invalid:7474'};
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return {ok:true};};
    await instance.init(config);
    await instance.guard.dispatch('STATE | START');
    await instance.guard.dispatch('STATE | STOP');
    assert.deepEqual(calls.map(c=>c.body),[{action:{id:config.startActionId}},{action:{id:config.stopActionId}}], 'dispatch must use IDs only, never legacy Action names');
    assert.ok(calls.every(c=>c.url==='http://fixture.invalid:7474/DoAction'));
    for(const invalid of [{}, {...config,startActionId:' '},{...config,startActionId:config.stopActionId}]){
      await instance.configUpdated(invalid);
      assert.equal(instance.stopped,true);
      assert.equal(instance.guard.online,false);
    }
    await instance.configUpdated(config);
    assert.equal(instance.stopped,false,'corrected configuration must recover without recreating the connection');
    assert.deepEqual(instance.config,config);
    checks++;
  }finally{instance.stop();globalThis.fetch=originalFetch;}
}
console.log(`PASS: ${checks} configuration / OBS reconnect regression checks; mocked fetch and local test server only, no app commands sent.`);
