import {InstanceBase, InstanceStatus} from '@companion-module/base';
import {HelperProcess} from '../shared/helper-process.mjs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {StreamGuard} from './guard.mjs';

const keys=['discord','steam'];
const BLUE=26367,RED=13840175,PURPLE=9323693,YELLOW=16766011,GRAY=4473924;
const mix=(a,b,t)=>{const c=(x,y)=>Math.round(x+(y-x)*t);return (c((a>>16)&255,(b>>16)&255)<<16)|(c((a>>8)&255,(b>>8)&255)<<8)|c(a&255,b&255);};
export default class VoiceStream extends InstanceBase {
 async init(config) {
  this.audio={};this.pending=new Map();this.counter=0;
   this.setVariableDefinitions({discord_state:{name:'Звук Discord выключен'},steam_state:{name:'Звук Steam выключен'},stream_label:{name:'Подпись кнопки эфира'},stream_active:{name:'Эфир OBS'},stream_available:{name:'Соединение OBS'},discord_mic_label:{name:'Подпись кнопки микрофона Discord'},discord_team_label:{name:'Подпись кнопки собеседников Discord'}});
  this.guard=new StreamGuard({read:async()=>{const s=await this.request('GetStreamStatus');return s.outputActive;},dispatch:async(name)=>{
   const r=await fetch(new URL('/DoAction',this.config.streamerbotUrl||'http://127.0.0.1:7474'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:{id:this.config[name==='STATE | START'?'startActionId':'stopActionId']}}),signal:AbortSignal.timeout(5000)});
   if(!r.ok)throw new Error('Streamer.bot action failed');
  },update:()=>this.publish()});
   this.setActionDefinitions({
    discord_toggle:{name:'Переключить звук Discord',options:[],callback:()=>this.toggle('discord')},
    steam_toggle:{name:'Переключить звук Steam',options:[],callback:()=>this.toggle('steam')},
    discord_mic:{name:'Клавиша микрофона Discord',options:[],callback:()=>this.mic(this.config.discordMicKey)},
    steam_mic:{name:'Клавиша микрофона Steam',options:[],callback:()=>this.mic(this.config.steamMicKey)},
    discord_deafen:{name:'Клавиша звука собеседников Discord',options:[],callback:()=>this.mic(this.config.discordDeafenKey)},
     stream_down:{name:'Начать удержание кнопки эфира',options:[],callback:()=>this.guard.down()},
     stream_up:{name:'Отпустить кнопку эфира',options:[],callback:()=>this.guard.up()},
     heal:{name:'Переподключить модуль и аудиопомощник',options:[],callback:()=>{this.restart();this.log('info','Manual heal: sockets and helper restarted');}}
    });
    const feedbacks={};
    for(const key of keys){
     feedbacks[key+'_muted']={type:'boolean',name:key+' output muted',options:[],defaultStyle:{bgcolor:11739175},callback:()=>!!this.audio[key]?.muted};
     feedbacks[key+'_unavailable']={type:'boolean',name:key+' no audio session',options:[],defaultStyle:{bgcolor:4473924},callback:()=>!this.audio[key]?.available};
    }
   feedbacks.stream_bg={type:'advanced',name:'Фон кнопки эфира',options:[],callback:()=>({bgcolor:this.streamStyle().bg})};
   feedbacks.discord_mic_bg={type:'advanced',name:'Фон кнопки микрофона Discord',options:[],callback:()=>({bgcolor:(this.discord&&this.discord.connected&&(this.discord.mute===true||this.discord.deaf===true))?YELLOW:PURPLE})};
   feedbacks.discord_team_bg={type:'advanced',name:'Фон кнопки собеседников Discord',options:[],callback:()=>({bgcolor:(this.discord&&this.discord.connected&&this.discord.deaf===true)?YELLOW:PURPLE})};
   this.setFeedbackDefinitions(feedbacks);
   const presets={};
   for(const key of keys) presets[key]={type:'simple',name:key+' output',style:{text:`${key==='discord'?'Discord':'Steam'}\n$(local-voice-stream:${key}_state)`,size:18,color:16777215,bgcolor:1793104},steps:[{down:[{actionId:key+'_toggle',options:{}}],up:[]}],feedbacks:[{feedbackId:key+'_muted',options:{},style:{bgcolor:11739175}},{feedbackId:key+'_unavailable',options:{},style:{bgcolor:4473924}}]};
   presets.stream={type:'simple',name:'Эфир: удерживать 3 с для старта / 2 с для остановки',style:{text:'$(local-voice-stream:stream_label)',size:20,color:16777215,bgcolor:BLUE},steps:[{down:[{actionId:'stream_down',options:{}}],up:[{actionId:'stream_up',options:{}}]}],feedbacks:[{feedbackId:'stream_bg',options:{}}]};
   presets.discord_mic={type:'simple',name:'Микрофон Discord',style:{text:'$(local-voice-stream:discord_mic_label)',size:14,color:16777215,bgcolor:PURPLE},steps:[{down:[{actionId:'discord_mic',options:{}}],up:[]}],feedbacks:[{feedbackId:'discord_mic_bg',options:{}}]};
   presets.discord_deafen={type:'simple',name:'Звук собеседников Discord',style:{text:'$(local-voice-stream:discord_team_label)',size:14,color:16777215,bgcolor:PURPLE},steps:[{down:[{actionId:'discord_deafen',options:{}}],up:[]}],feedbacks:[{feedbackId:'discord_team_bg',options:{}}]};
    presets.steam_mic={type:'simple',name:'Steam microphone hotkey',style:{text:'Steam\n🎙️',size:18,color:16777215,bgcolor:1793104},steps:[{down:[{actionId:'steam_mic',options:{}}],up:[]}],feedbacks:[]};
   presets.heal={type:'simple',name:'Переподключить модуль',style:{text:'HEAL\n🩹',size:18,color:16777215,bgcolor:1793104},steps:[{down:[{actionId:'heal',options:{}}],up:[]}],feedbacks:[]};
  this.setPresetDefinitions([{id:'voice',name:'Звук и эфир',definitions:Object.keys(presets)}],presets);
  await this.configUpdated(config);
 }
 getConfigFields(){const keyChoices=[];for(let i=1;i<=24;i++)keyChoices.push({id:'F'+i,label:'F'+i});keyChoices.push({id:'End',label:'End'},{id:'Home',label:'Home'},{id:'PgUp',label:'PgUp'},{id:'PgDn',label:'PgDn'},{id:'Ins',label:'Insert'},{id:'Del',label:'Delete'},{id:'ScrollLock',label:'Scroll Lock'},{id:'Pause',label:'Pause'});return [{type:'textinput',id:'streamerbotUrl',label:'HTTP-адрес Streamer.bot',width:12,default:'http://127.0.0.1:7474'},{type:'textinput',id:'startActionId',label:'ID Action запуска эфира',width:6,default:''},{type:'textinput',id:'stopActionId',label:'ID Action остановки эфира',width:6,default:''},{type:'textinput',id:'obsHost',label:'Адрес OBS',width:8,default:'127.0.0.1'},{type:'number',id:'obsPort',label:'Порт OBS',width:4,default:4455,min:1,max:65535},{type:'textinput',id:'obsPassword',label:'Пароль WebSocket OBS',width:12,isVisible:()=>true,default:'',useAsPassword:true},{type:'dropdown',id:'discordMicKey',label:'Клавиша микрофона Discord',width:4,default:'F13',choices:keyChoices},{type:'dropdown',id:'discordDeafenKey',label:'Клавиша звука собеседников Discord',width:4,default:'F14',choices:keyChoices},{type:'textinput',id:'discordClientId',label:'ID локального RPC Discord',width:6,default:'1161350695322591324'},{type:'dropdown',id:'steamMicKey',label:'Микрофон Steam',width:4,default:'End',choices:keyChoices}];}
  async configUpdated(config){this.config=config;this.restart();}
  restart(){this.stop();
   const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
   const {startActionId,stopActionId}=this.config||{};
   if(typeof startActionId!=='string'||typeof stopActionId!=='string'||!idPattern.test(startActionId)||!idPattern.test(stopActionId)||startActionId===stopActionId){
    this.updateStatus(InstanceStatus.BadConfig,'Укажите разные корректные ID Actions запуска и остановки');return;
   }
   this.stopped=false;this.discordRejected=false;this.startAudio();this.connectObs();this.startDiscord();this.monitor=setInterval(()=>{
   if(Date.now()-this.audioSeen>12000){this.audio={};this.publish();}
   this.pollObs();
  },5000);}
 pollObs(){
  const ws=this.ws;
  if(this.stopped||!this.identified||!ws)return Promise.resolve();
  return this.request('GetStreamStatus').then(s=>{
   if(!this.stopped&&this.ws===ws)this.guard.status(s.outputActive,s.outputReconnecting);
  }).catch(()=>{
   if(this.stopped||this.ws!==ws)return;
   this.guard.offline();ws.close();
  });
 }
 streamStyle(){
  const g=this.guard;if(!g)return{label:'',bg:BLUE};
  if(!g.online)return{label:'📡⚠️',bg:GRAY};
  if(g.busy)return g.active?{label:'🎥⏳',bg:RED}:{label:'🚀⏳',bg:BLUE};
  if(g.held&&g.holdStart){
   const t=Math.min(1,(Date.now()-g.holdStart)/g.holdMs);
   const v=(t*g.holdMs/1000).toFixed(1);
   return g.active?{label:'🏁'+v,bg:mix(RED,BLUE,t)}:{label:'🚀'+v,bg:mix(BLUE,RED,t)};
  }
  return g.active?{label:'🎥',bg:RED}:{label:'🚀',bg:BLUE};
 }
 publish(){
  if(!this.guard)return;
  const g=this.guard;
  const st=this.streamStyle();
  const d=this.discord||{connected:false};
  const values={stream_label:st.label,stream_active:g.active,stream_available:g.online,
   discord_mic_label:!d.connected?'Discord 🎙️':'Discord 🎙️'+((d.mute===true||d.deaf===true)?'❌':(d.mute===false?'🟢':'')),
   discord_team_label:!d.connected?'Discord 💬':'Discord 💬'+(d.deaf===true?'❌':(d.deaf===false?'🟢':''))};
  for(const key of keys){const s=this.audio[key];values[key+'_state']=!s?.available?'⚠️':s.mixed?'🔊/🔇':s.muted?'🔇':'🔊';}
  const signature=JSON.stringify([values,st.bg,this.audio,d]);
  if(signature!==this.lastPublished){this.lastPublished=signature;this.setVariableValues(values);
  this.checkFeedbacks('stream_bg','discord_mic_bg','discord_team_bg','discord_muted','discord_unavailable','steam_muted','steam_unavailable');}
  if(g.held&&!this.holdTick)this.holdTick=setInterval(()=>{if(this.guard&&this.guard.held)this.publish();else{clearInterval(this.holdTick);this.holdTick=null;this.publish();}},100);
  else if(!g.held&&this.holdTick){clearInterval(this.holdTick);this.holdTick=null;}
  const audioReady=!!this.helper?.child&&this.audioHealthy&&Date.now()-this.audioSeen<12000;
  this.updateStatus(audioReady&&g.online?InstanceStatus.Ok:InstanceStatus.Connecting,
   !g.online?'Нет соединения с OBS':!audioReady?'Аудиопомощник недоступен':'Звук / состояние OBS');
 }
 startDiscord(){
  const clientId=String(this.config.discordClientId||'1161350695322591324');
  const open=(idx)=>{
   if(this.stopped)return;
   this.discord={connected:false,mute:null,deaf:null};
   let acc=Buffer.alloc(0);
   const sock=net.connect('\\\\.\\pipe\\discord-ipc-'+idx);
   this.discordSock=sock;
   sock.setTimeout(15000,()=>sock.destroy());
   const send=(op,o)=>{const p=Buffer.from(JSON.stringify(o));const h=Buffer.alloc(8);h.writeUInt32LE(op,0);h.writeUInt32LE(p.length,4);try{sock.write(Buffer.concat([h,p]));}catch{}};
   sock.on('connect',()=>{send(0,{v:1,client_id:clientId});});
   sock.on('data',d=>{
    if(this.discordSock!==sock||this.stopped)return;
    if(acc.length+d.length>1048576){sock.destroy();return;}
    acc=Buffer.concat([acc,d]);
    while(acc.length>=8){
     const op=acc.readUInt32LE(0),len=acc.readUInt32LE(4);
     if(len>1048576){sock.destroy();return;}
     if(acc.length<8+len)break;
     const payload=acc.slice(8,8+len);acc=acc.slice(8+len);
     if(op===3){try{sock.write(Buffer.concat([Buffer.from([4,0,0,0]),Buffer.from([len&255,(len>>>8)&255,(len>>>16)&255,(len>>>24)&255]),payload]));}catch{}continue;}
     if(op===2){sock.destroy();return;}
     if(op!==1)continue;
     try{
      const m=JSON.parse(payload.toString());
      if(m.cmd==='DISPATCH'&&m.evt==='READY'){sock.setTimeout(0);this.discord.connected=true;this.discordRejected=false;send(1,{cmd:'SUBSCRIBE',evt:'VOICE_SETTINGS_UPDATE',nonce:'s1'});send(1,{cmd:'GET_VOICE_SETTINGS',args:{},nonce:'s2'});}
      if((m.evt==='VOICE_SETTINGS_UPDATE'||m.cmd==='GET_VOICE_SETTINGS')&&m.data){
       this.discord.connected=true;
       if(typeof m.data.mute==='boolean')this.discord.mute=m.data.mute;
       if(typeof m.data.deaf==='boolean')this.discord.deaf=m.data.deaf;
       this.publish();
      }
      if(m.evt==='ERROR'&&m.data&&/client/i.test(m.data.message||'')){this.discordRejected=true;this.log('warn','Discord RPC rejected client id');}
     }catch{}
    }
   });
   sock.on('error',()=>{});
   sock.on('close',()=>{
    if(this.discordSock!==sock)return;
    this.discordSock=null;this.discord={connected:false,mute:null,deaf:null};this.publish();
    if(this.stopped)return;
    if(this.discordRejected){this.discordRetry=setTimeout(()=>open(0),30000);return;}
    if(idx<9)this.discordRetry=setTimeout(()=>open(idx+1),1000);
    else this.discordRetry=setTimeout(()=>open(0),5000);
   });
  };
  open(0);
 }
 startAudio(){
  this.audio={};this.audioHealthy=false;this.audioSeen=0;
  this.helper?.stop();
  this.helper=new HelperProcess({file:path.join(path.dirname(fileURLToPath(import.meta.url)),'AudioHelper.exe'),retry:3000,
   onLine:line=>{const s=JSON.parse(line);if(s.commandError)this.log('warn','Audio helper rejected a hotkey');this.audio=s.error?{}:s;this.audioHealthy=!s.error;this.audioSeen=Date.now();this.publish();},
   onOffline:()=>{this.audio={};this.audioHealthy=false;this.audioSeen=0;this.publish();}});
  this.helper.start();
 }
 toggle(app){if(this.audio[app]?.available)this.helper?.send('toggle:'+app);}
 mic(key){if(key&&this.audioHealthy)this.helper?.send('key:'+key);}
 request(type){return new Promise((resolve,reject)=>{
  if(this.stopped||!this.identified||!this.ws)return reject(new Error('OBS offline'));
  const id=String(++this.counter);const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('OBS timeout'));},3000);
  this.pending.set(id,{resolve,reject,timer});
  try{this.ws.send(JSON.stringify({op:6,d:{requestType:type,requestId:id}}));}
  catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
 });}
 connectObs(){
  try {
   const c={host:this.config.obsHost||'127.0.0.1',port:this.config.obsPort||4455,password:this.config.obsPassword||''};
   const ws=this.ws=new WebSocket(`ws://${c.host}:${c.port}`);
   ws.onopen=()=>{if(this.ws!==ws||this.stopped){ws.close();return;}this.handshake=setTimeout(()=>ws.close(),5000);};
   ws.onmessage=async event=>{
    if(this.ws!==ws)return;
    try{
     const {op,d}=JSON.parse(event.data);
     if(op===0){const identify={rpcVersion:1,eventSubscriptions:64};if(d.authentication){const secret=crypto.createHash('sha256').update(c.password+d.authentication.salt).digest('base64');identify.authentication=crypto.createHash('sha256').update(secret+d.authentication.challenge).digest('base64');}ws.send(JSON.stringify({op:1,d:identify}));}
     if(op===2){clearTimeout(this.handshake);this.identified=true;const s=await this.request('GetStreamStatus');if(this.ws===ws&&!this.stopped)this.guard.status(s.outputActive,s.outputReconnecting);}
     if(op===7){const p=this.pending.get(d.requestId);if(p){clearTimeout(p.timer);this.pending.delete(d.requestId);d.requestStatus.result?p.resolve(d.responseData):p.reject(new Error('OBS request failed'));}}
     if(op===5&&d.eventType==='StreamStateChanged'){const s=d.eventData;this.guard.status(s.outputActive,!['OBS_WEBSOCKET_OUTPUT_STARTED','OBS_WEBSOCKET_OUTPUT_STOPPED'].includes(s.outputState));}
    }catch{if(this.ws===ws&&!this.stopped){this.guard.offline();ws.close();}}
   };
   // A failed CONNECTING socket may emit only error. Handle both events once,
   // without recursively closing from inside Undici's error callback.
   const disconnected=()=>{if(this.ws!==ws)return;this.ws=null;this.identified=false;this.guard.offline();clearTimeout(this.handshake);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('OBS disconnected'));}this.pending.clear();if(!this.stopped)this.obsRetry=setTimeout(()=>this.connectObs(),5000);};
   ws.onerror=disconnected;
   ws.onclose=disconnected;
  }catch(error){this.log('warn','OBS setup: '+error.name+' / '+(error.code||'no code'));this.guard.offline();if(!this.stopped)this.obsRetry=setTimeout(()=>this.connectObs(),10000);}
 }
  stop(){this.stopped=true;clearInterval(this.monitor);clearInterval(this.holdTick);this.holdTick=null;clearTimeout(this.audioRetry);clearTimeout(this.obsRetry);clearTimeout(this.discordRetry);clearTimeout(this.handshake);this.guard?.destroy();this.guard?.offline();this.helper?.stop();this.helper=null;this.audioHealthy=false;this.audioSeen=0;const ws=this.ws;this.ws=null;this.identified=false;ws?.close();const ds=this.discordSock;this.discordSock=null;this.discord={connected:false,mute:null,deaf:null};ds?.destroy();for(const p of this.pending?.values()||[]){clearTimeout(p.timer);p.reject(new Error('Stopped'));}this.pending?.clear();}
 async destroy(){this.stop();}
}
export const UpgradeScripts=[];
