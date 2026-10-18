import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {textPath} from './noir-text.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const scenes=path.join(root,'artwork/scenes');
const qr=(await fs.readFile(path.join(root,'apps/website/public/assets/maseaaao.tv.png'))).toString('base64');
const mark=(await fs.readFile(path.join(root,'artwork/logo/rendered/avatar-circle-512.png'))).toString('base64');
export async function stampScenes(){
 const rules={
 '00-blank.html':[1030,470,500,'caption-center'], 'background.html':[2180,1136,250],
 '00-blank-vertical.html':'wordmark-center',
 '01-start.html':[2180,1136,250], '02-pause.html':[2180,1136,250], '99-end.html':[2180,1136,250],
 '01-start-vertical.html':[120,1540,260], '02-pause-vertical.html':[120,1540,260], '99-end-vertical.html':[120,1540,260],
 '04-camera-horizontal.html':[2100,1140,250]
 };
 for(const file of (await fs.readdir(scenes)).filter(f=>f.endsWith('.html'))){
 let html=await fs.readFile(path.join(scenes,file),'utf8');
 html=html.replace(/<image data-brand="(?:mark|qr|logo)"[^>]*\/>|<text data-brand="qr-label"[^>]*>[^<]*<\/text>|<g data-brand="(?:qr-copy|twitch)"[\s\S]*?<\/g>/g,'');
 const rule=rules[file];let extra='';
 if(rule==='wordmark-center'){
 const cs=96, tp=textPath('maseaaao.tv',cs);
 const ls=320, gap=64, th=Math.round(cs*0.72), half=Math.round((ls+gap+th)/2);
 extra='<image data-brand="logo" x="'+Math.round((1080-ls)/2)+'" y="'+(960-half)+'" width="'+ls+'" height="'+ls+'" href="data:image/png;base64,'+mark+'"/>';
 }
 else if(rule){const [x,y,s,mode]=rule;const vertical=file.includes('-vertical');
 extra='<image data-brand="qr" x="'+x+'" y="'+y+'" width="'+s+'" height="'+s+'" href="data:image/png;base64,'+qr+'"/>';
 let cx=vertical?120:x-400, cy=vertical?1850:y+150, cs=vertical?27:32;
 if(mode==='caption-center'){cs=40;cx=Math.round(x+s/2-textPath('maseaaao.tv',cs).width/2);cy=y+s+56;}
 }
 const vertical=file.includes('-vertical');
 if(/^(01-start|02-pause|99-end)(-vertical)?\.html$/.test(file)){
 html=html.replace(/<image data-brand="nick-logo"[^>]*\/>/g,'');
 const size=vertical?48:64, y=vertical?285:119, nickX=vertical?184:208, baseline=vertical?320:168;
 html=html.replace(new RegExp('translate\\((?:120|184|208) '+baseline+'\\)'), 'translate('+nickX+' '+baseline+')');
 extra+='<image data-brand="nick-logo" x="120" y="'+y+'" width="'+size+'" height="'+size+'" href="data:image/png;base64,'+mark+'"/>';
 }
 // Twitch badge is a separate opaque OBS source; build-twitch-badge.mjs owns its style.
 const markNode='<image data-brand="mark" x="'+(vertical?240:1280)+'" y="'+(vertical?120:20)+'" width="'+(vertical?1680:1900)+'" height="'+(vertical?1680:1900)+'" opacity="0.025" href="data:image/png;base64,'+mark+'"/>';
 // Insert after the full-canvas background, behind headings and live overlays.
 html=html.replace(/(<rect\b[^>]*width="(?:1080|2560)"[^>]*height="(?:1920|1440)"[^>]*\/>)/, '$1'+markNode);
 html=html.replace(/<rect\b[^>]*height="(?:1|2|28|44)"[^>]*\/>/g,'');
 if(!html.includes('data-brand="mark"')) html=html.replace(/(<svg\b[^>]*>)/,'$1'+markNode);
 html=html.replace('</svg>',extra+'</svg>');await fs.writeFile(path.join(scenes,file),html);console.log('stamped '+file);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await stampScenes();
