import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {textPath} from './noir-text.mjs';
const root=path.resolve(import.meta.dirname,'..');
const scenes=path.join(root,'src/scenes');
const qr=(await fs.readFile(path.join(root,'dist/assets/maseaaao.tv.png'))).toString('base64');
const mark=(await fs.readFile(path.join(root,'src/logo/rendered/avatar-circle-512.png'))).toString('base64');
const label=(text,x,y,size,color)=>{const tp=textPath(text,size);return '<g data-brand="qr-copy" transform="translate('+x+' '+y+')" fill="'+color+'"><path d="'+tp.d+'"/></g>';};
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
 extra+=label('maseaaao.tv',Math.round((1080-tp.width)/2),960-half+ls+gap+th,cs,'#ececee');
 }
 else if(rule){const [x,y,s,mode]=rule;const vertical=file.includes('-vertical');
 extra='<image data-brand="qr" x="'+x+'" y="'+y+'" width="'+s+'" height="'+s+'" href="data:image/png;base64,'+qr+'"/>';
 let cx=vertical?120:x-400, cy=vertical?1850:y+150, cs=vertical?27:32;
 if(mode==='caption-center'){cs=40;cx=Math.round(x+s/2-textPath('maseaaao.tv',cs).width/2);cy=y+s+56;}
 extra+=label('maseaaao.tv',cx,cy,cs,'#ececee');
 }
 const vertical=file.includes('-vertical');
 if(vertical){
 const copy=textPath('twitch / maseaaao',30);
 const width=48+copy.width;
 const x=rule==='wordmark-center'?Math.round((1080-width)/2):440;
 const y=rule==='wordmark-center'?1870:1850;
 extra+='<g data-brand="twitch" aria-label="Twitch: maseaaao" transform="translate('+x+' '+y+')"><path fill="#b79cff" transform="translate(0 -32) scale(1.6)" d="M11.571 4.714h1.715v5.143h-1.715zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/><path fill="#ececee" transform="translate(48 0)" d="'+copy.d+'"/></g>';
 }
 const markNode='<image data-brand="mark" x="'+(vertical?240:1280)+'" y="'+(vertical?120:20)+'" width="'+(vertical?1680:1900)+'" height="'+(vertical?1680:1900)+'" opacity="0.025" href="data:image/png;base64,'+mark+'"/>';
 // Insert after the full-canvas background, behind headings and live overlays.
 html=html.replace(/(<rect\b[^>]*width="(?:1080|2560)"[^>]*height="(?:1920|1440)"[^>]*\/>)/, '$1'+markNode);
 html=html.replace(/<rect\b[^>]*height="(?:1|2|28|44)"[^>]*\/>/g,'');
 if(!html.includes('data-brand="mark"')) html=html.replace(/(<svg\b[^>]*>)/,'$1'+markNode);
 html=html.replace('</svg>',extra+'</svg>');await fs.writeFile(path.join(scenes,file),html);console.log('stamped '+file);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await stampScenes();
