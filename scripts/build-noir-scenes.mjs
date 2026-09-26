import fs from 'node:fs/promises';
import path from 'node:path';
import {textPath} from './noir-text.mjs';

const scenes=path.resolve(import.meta.dirname,'../src/scenes');

const defs=`<defs><radialGradient id="vig" cx="50%" cy="0%" r="150%"><stop offset="0" stop-color="#101014"/><stop offset=".55" stop-color="#0a0a0d"/><stop offset="1" stop-color="#070709"/></radialGradient><linearGradient id="hair" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b79cff" stop-opacity="0"/><stop offset=".3" stop-color="#b79cff"/><stop offset=".7" stop-color="#8d6cf0"/><stop offset="1" stop-color="#8d6cf0" stop-opacity="0"/></linearGradient></defs>`;
const barH=``;
const barV=``;
const css=`html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#070709}body>svg{display:block;width:100%;height:100%}`;

const nick=textPath('MASEAAAO',100,0.16);

const scenesDef=[
  {file:'01-start.html',l1:'СКОРО',l2:'НАЧНЁМ'},
  {file:'02-pause.html',l1:'СКОРО',l2:'ВЕРНУСЬ'},
  {file:'99-end.html',l1:'ДО',l2:'ВСТРЕЧИ'},
];

for(const s of scenesDef){
  const l1=textPath(s.l1,100);
  const l2=textPath(s.l2,100);
  for(const [name,r] of [['nick',nick],['l1',l1],['l2',l2]]){
    if(/NaN|Infinity/.test(r.d))throw new Error(`Invalid path data in ${name} (${s.file})`);
  }
  const htmlH=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>MASEAAAO — ${s.file.replace(/\.html$/,'')}</title><style>${css}</style><body><svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440" viewBox="0 0 2560 1440">${defs}<rect width="2560" height="1440" fill="url(#vig)"/>${barH}<g transform="translate(120 168) scale(.48)" fill="#ededf0"><path d="${nick.d}"/></g><g transform="translate(112 640) scale(2)" fill="#ededf0"><path d="${l1.d}"/></g><g transform="translate(112 880) skewX(-7) scale(2)" fill="#b79cff"><path d="${l2.d}"/></g></svg></body></html>`;
  const htmlV=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>MASEAAAO — ${s.file.replace(/\.html$/,'')} — vertical</title><style>${css}</style><body><svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${defs}<rect width="1080" height="1920" fill="url(#vig)"/>${barV}<g transform="translate(120 320) scale(.3)" fill="#ededf0"><path d="${nick.d}"/></g><g transform="translate(120 435) scale(.92)" fill="#ededf0"><path d="${l1.d}"/></g><g transform="translate(120 540) skewX(-7) scale(.92)" fill="#b79cff"><path d="${l2.d}"/></g></svg></body></html>`;
  await fs.writeFile(path.join(scenes,s.file),htmlH);
  await fs.writeFile(path.join(scenes,s.file.replace('.html','-vertical.html')),htmlV);
  console.log(`noir ${s.file} (+vertical)`);
}
