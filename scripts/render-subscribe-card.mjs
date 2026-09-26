import fs from 'node:fs/promises';
import sharp from 'sharp';
import {textPath} from './noir-text.mjs';
const logo=(await fs.readFile('src/logo/rendered/avatar-circle-512.png')).toString('base64');
const line=(text,size,y,color)=>{const p=textPath(text,size);return '<g transform="translate('+(512-p.width)/2+' '+y+')" fill="'+color+'"><path d="'+p.d+'"/></g>';};
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#f6f5f2"/><image x="168" y="48" width="176" height="176" href="data:image/png;base64,'+logo+'"/>'+line('Оставайся на связи',25,292,'#17171b')+line('Стримы, клипы, анонсы',16,334,'#65646e')+line('maseaaao.tv',28,434,'#7655c6')+'</svg>';
await sharp(Buffer.from(svg)).png().toFile('dist/assets/subscribe-512.png');
console.log('Rendered subscribe-512.png');
