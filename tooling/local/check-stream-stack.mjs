// Read-only live checks. Never invokes Actions, changes scenes, mute, or playback.
import fs from 'node:fs/promises';
import {validateActionTargets} from './action-targets.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, fileURLToPath as fromFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';

if (!process.env.STREAMERBOT_ROOT) throw Error('Set STREAMERBOT_ROOT to the installed Streamer.bot folder');
const root=path.resolve(process.env.STREAMERBOT_ROOT);
const jsonFile=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const settings=await jsonFile(path.join(root,'data/settings.json'));
const companionConfig=await jsonFile(path.join(root,'custom/companion/data/config.json'));
const bindHost=h=>['0.0.0.0','::','',undefined].includes(h)?'127.0.0.1':h;
const sbBase=`http://${bindHost(settings.http.address)}:${settings.http.port}`;
const companionBase=`http://${bindHost(companionConfig.bind_ip)}:${companionConfig.http_port}`;
const report={checkedAt:new Date().toISOString(),versions:{},checks:{},issues:[],warnings:[]};
const issue=s=>report.issues.push(s);
const warning=s=>report.warnings.push(s);
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function readApplicationStorage(instances){return new Promise((resolve,reject)=>{
  const child=spawn('python',[fileURLToPath(new URL('./compare-companion-storage.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('Storage observation timeout'));},16000);
  child.stdout.on('data',data=>{output+=data;if(output.length>100000){child.kill();reject(new Error('Storage observation output limit'));}});
  child.stderr.on('data',()=>{});
  child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('Storage helper unavailable'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('Storage observation unavailable'));try{resolve(JSON.parse(output));}catch{reject(new Error('Invalid storage observation'));}});
  child.stdin.end(JSON.stringify({baseUrl:companionBase,instances}));
});}

async function getJson(url){
  const r=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());
  return JSON.parse((b[0]===0x1f&&b[1]===0x8b?gunzipSync(b):b).toString('utf8').replace(/^\uFEFF/,''));
}
const exists=async p=>{try{await fs.access(p);return true;}catch{return false;}};
function walk(value,visit,location=''){
  if(Array.isArray(value))value.forEach((v,i)=>walk(v,visit,`${location}/${i}`));
  else if(value&&typeof value==='object'){
    visit(value,location);
    for(const [k,v] of Object.entries(value))walk(v,visit,`${location}/${k}`);
  }
}
let actions;
try{
  const doc=await getJson(sbBase+'/GetActions');
  if(!Array.isArray(doc.actions))throw new Error('Invalid action list');
  actions=doc.actions;
  report.checks.streamerbotHttp={available:true,actions:actions.length};
}catch{issue('Streamer.bot HTTP API unavailable; action references were not verified.');}
let live;
try{
  const [connections,exported]=await Promise.all([
    getJson(companionBase+'/api/connections'),getJson(companionBase+'/int/export/full'),
  ]);
  live=exported;
  if(!live.instances||!live.pages)throw new Error('Invalid Companion export');
  report.versions.companion=live.companionBuild;
  report.checks.companion={available:true,connections:connections.map(c=>({
    label:c.label,module:c.moduleId,enabled:c.enabled,status:c.status?.level,
    version:live.instances[c.id]?.moduleVersionId,
  }))};
  let localStorageMatches=false;
  try{
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(path.join(root,'custom/companion/data/v5.0/db.sqlite'),{readOnly:true});
    try{
      const rows=db.prepare('SELECT id, value FROM instances').all();
      const stored=Object.fromEntries(rows.map(r=>[r.id,JSON.parse(r.value)]).filter(([,i])=>(i.moduleInstanceType||'connection')==='connection'));
      const project=i=>({moduleId:i.moduleId,moduleVersionId:i.moduleVersionId,enabled:i.enabled,label:i.label,config:i.config,secrets:i.secrets});
      localStorageMatches=Object.keys(stored).length===Object.keys(live.instances).length&&Object.entries(live.instances).every(([id,i])=>stored[id]&&canonical(project(stored[id]))===canonical(project(i)));
      report.checks.companionStoredConnections={matchesLive:localStorageMatches,source:'local-readonly-database'};
    }finally{db.close();}
  }catch{}
  if(!localStorageMatches){
    try{
      const native=await readApplicationStorage(live.instances);
      report.checks.companionStoredConnections={...native,localReadMatchesLive:false};
      if(!native.matchesLive)warning('Companion application database observation differs from its live export. Retry while settings are unchanged; retain a native export before restart.');
    }catch{warning('Companion local database differs or cannot be read, and application storage could not be verified. Retain a native export; this does not by itself prove a save failure.');}
  }
  for(const c of connections)if(c.enabled&&c.status?.category!=='good')issue(`Companion connection ${c.label} is not ready (${c.status?.level||'unknown'}).`);
  if(actions){
    const byId=new Map(actions.map(a=>[a.id,a]));
    const byName=new Map();
    for(const a of actions){const list=byName.get(a.name)||[];list.push(a);byName.set(a.name,list);}
    let checked=0;
    walk(live.pages,(entity,location)=>{
      if(!entity.connectionId||entity.disabled||entity.definitionId!=='post')return;
      const instance=live.instances[entity.connectionId];
      if(instance?.moduleId!=='generic-http'||entity.options?.url?.value!=='/DoAction')return;
      let prefix;
      try{prefix=new URL(instance.config.prefix);}catch{issue(`Invalid HTTP base on ${instance.label}.`);return;}
      const expected=new URL(sbBase);
      const local=h=>['localhost','127.0.0.1','[::1]'].includes(h);
      if(prefix.port!==expected.port||!(prefix.hostname===expected.hostname||(local(prefix.hostname)&&local(expected.hostname)))){
        warning(`Connection ${instance.label} points to a different Streamer.bot address; target validation skipped.`);return;
      }
      if(!instance.enabled)issue(`Button uses disabled connection ${instance.label}.`);
      try{
        const body=JSON.parse(entity.options.body.value);const t=body.action||{};
        let target=t.id?byId.get(t.id):undefined;
        if(!t.id){const matches=byName.get(t.name)||[];if(matches.length>1)issue(`Ambiguous action name: ${t.name}.`);target=matches[0];}
        if(!target)issue(`Missing Streamer.bot Action at ${location}: ${t.name||t.id||'<empty>'}.`);
        else if(!target.enabled)issue(`Disabled Streamer.bot Action: ${target.name}.`);
        checked++;
      }catch{issue(`Invalid static DoAction JSON at ${location}.`);}
    });
    report.checks.buttonReferences={checked};
    for(const i of Object.values(live.instances))if(i.enabled&&i.moduleId==='local-voice-stream'){
      for(const [key,name] of [['startActionId','STATE | START'],['stopActionId','STATE | STOP']]){
        if(i.config[key]){if(!byId.get(i.config[key])?.enabled)issue(`VoiceStream requires enabled Action ID for ${name}.`);}
        else {const matches=byName.get(name)||[];if(matches.length!==1||!matches[0].enabled)issue(`VoiceStream requires one enabled Action named ${name}.`);}
      }
      try{const url=new URL(i.config.streamerbotUrl||'http://127.0.0.1:7474');if(url.origin!==new URL(sbBase).origin)warning('VoiceStream uses a different Streamer.bot HTTP address.');}catch{issue('VoiceStream Streamer.bot URL is invalid.');}
    }
  }
  const localDoc=await jsonFile(path.join(root,'data/actions.json'));
  if(actions){const ids=new Set(actions.map(a=>a.id));if(localDoc.actions.length!==ids.size||localDoc.actions.some(a=>!ids.has(a.id)))warning('Streamer.bot disk data differs from the live Action list; use live data/export.');}
}catch{issue('Companion live configuration unavailable; disk snapshots were not substituted.');}

async function connectSocket(url,onHello){
  const ws=new WebSocket(url);const pending=new Map();let seq=0;
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const timer=setTimeout(()=>readyReject(new Error('WebSocket handshake timeout')),4000);
  const fail=()=>{readyReject(new Error('WebSocket disconnected'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('WebSocket disconnected'));}pending.clear();};
  ws.onerror=fail;ws.onclose=fail;
  ws.onmessage=async e=>{
    try{
      const msg=JSON.parse(e.data);
      const state=onHello(msg,ws);
      if(state===true){clearTimeout(timer);readyResolve();}
      const id=msg.id||msg.d?.requestId;const p=pending.get(id);
      if(p){clearTimeout(p.timer);pending.delete(id);p.resolve(msg);}
    }catch{fail();}
  };
  try{await ready;}catch{clearTimeout(timer);ws.close();throw new Error('WebSocket unavailable');}
  return {request(payload){return new Promise((resolve,reject)=>{
    const id=String(++seq);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Request timeout'));},3500);
    pending.set(id,{resolve,reject,timer});
    try{ws.send(JSON.stringify(payload(id)));}catch{clearTimeout(timer);pending.delete(id);reject(new Error('Socket closed'));}
  });},close(){clearTimeout(timer);ws.close();fail();}};
}
try{
  const cfg=settings.websockets;
  const socket=await connectSocket(`ws://${bindHost(cfg.address)}:${cfg.port}${cfg.endpoint||'/'}`,(m,ws)=>{
    if(m.id==='auth'){if(m.status!=='ok')throw new Error('Authentication rejected');return true;}
    if(m.request!=='Hello')return false;
    if(m.authentication){
      const secret=crypto.createHash('sha256').update((cfg.authPassword||'')+m.authentication.salt).digest('base64');
      const authentication=crypto.createHash('sha256').update(secret+m.authentication.challenge).digest('base64');
      ws.send(JSON.stringify({request:'Authenticate',id:'auth',authentication}));return false;
    }
    return true;
  });
  try{const info=await socket.request(id=>({request:'GetInfo',id}));report.versions.streamerbot=info.info?.version;report.checks.streamerbotWebsocket={available:info.status==='ok'};}finally{socket.close();}
}catch{issue('Streamer.bot WebSocket unavailable; check connection settings.');}

try{
  const cfg=await jsonFile(path.join(root,'data/obs.json'));
  const c=cfg.connections.find(x=>x.default)||cfg.connections[0];
  const socket=await connectSocket(`ws://${c.host}:${c.port}`,(m,ws)=>{
    if(m.op===0){
      const id={rpcVersion:1,eventSubscriptions:0};
      if(m.d.authentication){const a=m.d.authentication;const secret=crypto.createHash('sha256').update((c.password||'')+a.salt).digest('base64');id.authentication=crypto.createHash('sha256').update(secret+a.challenge).digest('base64');}
      ws.send(JSON.stringify({op:1,d:id}));
    }
    return m.op===2;
  });
  const request=async(type,data={})=>{
    const r=await socket.request(id=>({op:6,d:{requestType:type,requestId:id,requestData:data}}));
    if(!r.d.requestStatus.result)throw new Error('OBS read rejected');
    return r.d.responseData;
  };
  try{
    const [version,stream,record,inputs]=await Promise.all(['GetVersion','GetStreamStatus','GetRecordStatus','GetInputList'].map(q=>request(q)));
    report.versions.obs=version.obsVersion;
    report.checks.obs={available:true,streaming:stream.outputActive,recording:record.outputActive,inputs:inputs.inputs.length};
    const scenes=await request('GetSceneList');
    const document=await jsonFile(path.join(root,'data/actions.json'));
    const targets=validateActionTargets(document.actions,scenes.scenes.map(s=>s.sceneName),inputs.inputs.map(i=>i.inputName));
    targets.issues.forEach(issue);targets.warnings.forEach(warning);
    report.checks.actionTargets={checked:targets.checked,source:'disk-actions/live-OBS',note:'Inline C# targets are not executed or exhaustively analysed.'};
    if(inputs.inputs.length>128)warning('OBS input check limit reached; remaining inputs were not checked.');
    const microphoneChecks=[];const mediaFiles=[];let browserSources=0;
    for(const input of inputs.inputs.slice(0,128)){
      if(!['browser_source','wasapi_input_capture','ffmpeg_source','image_source'].includes(input.inputKind))continue;
      const {inputSettings:s}=await request('GetInputSettings',{inputName:input.inputName});
      if(input.inputKind==='wasapi_input_capture'){
        try{
          const list=await request('GetInputPropertiesListPropertyItems',{inputName:input.inputName,propertyName:'device_id'});
          const selected=list.propertyItems.find(x=>x.itemValue===s.device_id);
          microphoneChecks.push({name:input.inputName,selectedDeviceValid:!!selected?.itemEnabled});
          if(!selected?.itemEnabled)issue(`OBS microphone ${input.inputName} has an unavailable selected device.`);
        }catch{warning(`OBS microphone device list could not be checked for ${input.inputName}.`);}
      }
      if(input.inputKind==='browser_source'){
        browserSources++;
        let file=s.is_local_file?s.local_file:null;
        if(!file&&s.url?.startsWith('file:')){try{file=fromFileURL(s.url);}catch{}}
        if(file&&!await exists(file))warning(`OBS browser ${input.inputName}: local resource is not visible to file diagnostics; verify display in OBS.`);
        if(s.url){try{
          const u=new URL(s.url);
          if(['127.0.0.1','localhost',hostFromBase(companionBase)].includes(u.hostname)&&['http:','https:'].includes(u.protocol)){
            const r=await fetch(u,{signal:AbortSignal.timeout(3000)});
            if(!r.ok)issue(`OBS browser ${input.inputName}: local HTTP dependency returned ${r.status}.`);
          }
        }catch{issue(`OBS browser ${input.inputName}: local HTTP dependency unavailable.`);}}
      }
      const file=input.inputKind==='image_source'?s.file:input.inputKind==='ffmpeg_source'&&s.is_local_file?s.local_file:null;
      if(file){mediaFiles.push({name:input.inputName,exists:await exists(file)});if(!mediaFiles.at(-1).exists)warning(`OBS source ${input.inputName}: media file is not visible to diagnostics; verify source in OBS.`);}
    }
    report.checks.obsMicrophones=microphoneChecks;
    report.checks.obsResources={browserSources,mediaFiles};
    if(live)for(const i of Object.values(live.instances))if(i.enabled&&i.moduleId==='local-voice-stream'){
      if(String(i.config.obsHost)!==String(c.host)||Number(i.config.obsPort)!==Number(c.port)||String(i.config.obsPassword||'')!==String(c.password||''))issue('VoiceStream and Streamer.bot have different OBS connection settings.');
    }
  }finally{socket.close();}
}catch{issue('OBS authenticated read checks failed.');}
function hostFromBase(url){return new URL(url).hostname;}

try{
  const mappings=settings.http.mapping||{};
  if(mappings['stream-info']){
    const r=await fetch(sbBase+'/stream-info/change-info-streamer-bot.ru.html',{signal:AbortSignal.timeout(4000)});
    report.checks.streamInfo={available:r.ok};if(!r.ok)issue(`Stream Info returned HTTP ${r.status}.`);
  }
}catch{issue('Stream Info page unavailable.');}
report.ok=report.issues.length===0;
report.ready=report.ok&&report.warnings.length===0;
const arg=process.argv.indexOf('--report');
if(arg!==-1){if(!process.argv[arg+1])throw new Error('Missing report filename');await fs.writeFile(path.resolve(process.argv[arg+1]),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
process.exitCode=report.issues.length?1:report.warnings.length?2:0;
