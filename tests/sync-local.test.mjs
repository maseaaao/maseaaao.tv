import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {spawnSync} from 'node:child_process';

test('local update previews changes, preserves unrelated data and backs up replaced resources',()=>{
  const root=resolve(import.meta.dirname,'..');
  mkdirSync(resolve(root,'.local'),{recursive:true});
  const target=mkdtempSync(resolve(root,'.local/sync-fixture-'));
  mkdirSync(resolve(target,'Streamer.bot/data'),{recursive:true});
  writeFileSync(resolve(target,'Streamer.bot/Streamer.bot.exe'),'test marker only');
  writeFileSync(resolve(target,'Streamer.bot/data/actions.json'),'private fixture');
  writeFileSync(resolve(target,'obs-tuna-widget.html'),'previous widget');
  const run=(...args)=>spawnSync(process.execPath,[resolve(root,'tooling/sync-local.mjs'),'--obs-root',target,...args],{encoding:'utf8'});
  try {
    assert.equal(run('--product','tuna').status,0);
    assert.equal(readFileSync(resolve(target,'obs-tuna-widget.html'),'utf8'),'previous widget');
    assert(!existsSync(resolve(target,'Streamer.bot/backup')));
    assert.equal(run('--product','tuna','--apply').status,0);
    assert(readFileSync(resolve(target,'obs-tuna-widget.html')).equals(readFileSync(resolve(root,'apps/tuna-widget/dist/obs-tuna-widget.html'))));
    const backups=readdirSync(resolve(target,'Streamer.bot/backup'));
    assert.equal(backups.length,1);
    assert.equal(readFileSync(resolve(target,'Streamer.bot/backup',backups[0],'obs-tuna-widget.html'),'utf8'),'previous widget');
    assert.equal(readFileSync(resolve(target,'Streamer.bot/data/actions.json'),'utf8'),'private fixture');
    assert.equal(run('--product','tuna','--apply').status,0);
    assert.equal(readdirSync(resolve(target,'Streamer.bot/backup')).length,1,'unchanged update is idempotent');
    assert.notEqual(run('--product','unknown','--apply').status,0);
  } finally {rmSync(target,{recursive:true,force:true});}
});

test('artwork restores a complete dependency graph and legacy fonts in an empty OBS folder',()=>{
  const root=resolve(import.meta.dirname,'..');
  mkdirSync(resolve(root,'.local'),{recursive:true});
  const target=mkdtempSync(resolve(root,'.local/artwork-fixture-'));
  mkdirSync(resolve(target,'Streamer.bot'),{recursive:true});
  writeFileSync(resolve(target,'Streamer.bot/Streamer.bot.exe'),'test marker only');
  const run=(...args)=>spawnSync(process.execPath,[resolve(root,'tooling/sync-local.mjs'),'--obs-root',target,'--product','artwork',...args],{encoding:'utf8'});
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(dir,entry.name)):[resolve(dir,entry.name)]);
  try {
    const preview=run();
    assert.equal(preview.status,0,preview.stderr);
    assert(!existsSync(resolve(target,'maseaaao.tv')),'preview must not write resources');
    const applied=run('--apply');
    assert.equal(applied.status,0,applied.stderr);
    for(const file of walk(resolve(target,'maseaaao.tv')).filter(file=>/\.(html|css)$/.test(file))) {
      for(const match of readFileSync(file,'utf8').matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^\s"')]+)["']?\)/g)) {
        const url=match[1]||match[2];
        if(/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(url)) continue;
        const dependency=resolve(dirname(file),decodeURIComponent(url.split(/[?#]/)[0]));
        assert(existsSync(dependency),`${relative(target,file)} -> ${url}`);
        assert(!relative(target,dependency).startsWith('..'),'dependencies stay inside the deployment');
      }
    }
    for(const [source,destination] of [
      ['fonts/fonts.css','assets/fonts/fonts.css'],
      ['fonts/Geologica.ttf','assets/cyber-monolith/Geologica.ttf'],
      ['fonts/Unbounded.ttf','assets/cyber-monolith/Unbounded.ttf'],
    ]) assert(readFileSync(resolve(root,'packages/design',source)).equals(readFileSync(resolve(target,'maseaaao.tv',destination))),destination);
    const repeated=run('--apply');
    assert.equal(repeated.status,0,repeated.stderr);
    assert.match(repeated.stdout,/0 files updated/,'transformed output is idempotent');
  } finally {rmSync(target,{recursive:true,force:true});}
});

test('widgets restores the transparent image used by existing OBS camera sources',()=>{
  const root=resolve(import.meta.dirname,'..');
  mkdirSync(resolve(root,'.local'),{recursive:true});
  const target=mkdtempSync(resolve(root,'.local/widgets-fixture-'));
  mkdirSync(resolve(target,'Streamer.bot'),{recursive:true});
  writeFileSync(resolve(target,'Streamer.bot/Streamer.bot.exe'),'test marker only');
  try {
    const result=spawnSync(process.execPath,[resolve(root,'tooling/sync-local.mjs'),'--obs-root',target,'--product','widgets','--apply'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const file=resolve(target,'Streamer.bot/custom/assets/social-strip/transparent.png');
    assert(existsSync(file),'saved OBS camera source must be restorable');
    assert(readFileSync(file).equals(readFileSync(resolve(root,'apps/obs-widgets/social-strip/transparent.png'))));
  } finally {rmSync(target,{recursive:true,force:true});}
});
