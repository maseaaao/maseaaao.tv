import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = resolve(import.meta.dirname, '..');
const dist = resolve(project, 'dist');
const vite = resolve(dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin/vite.js');
rmSync(dist, {recursive:true, force:true});
mkdirSync(dist, {recursive:true});
execFileSync(process.execPath, [vite, 'build'], {cwd:project, stdio:'inherit'});
const output = resolve(dist, 'index.html');
writeFileSync(output, readFileSync(output, 'utf8').replace(/\r+\n/g, '\n'));
renameSync(output, resolve(dist, 'change-info-streamer-bot.ru.html'));
