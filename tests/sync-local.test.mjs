import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
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
