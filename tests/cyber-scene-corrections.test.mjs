import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// OBS 32.2.2 libobs/obs-scene.c calculate_bounds_data + add_alignment:
// arithmetic is float32; the leftover size is cast to int BEFORE alignment.
// libobs/obs-defs.h: LEFT=1, TOP=4, BOTTOM=8 (BOTTOMLEFT=9).
// This intentionally does not substitute ideal floating-point centering math.
function fittedViewport(t) {
  assert.equal(t.boundsType, 'OBS_BOUNDS_SCALE_INNER');
  assert.equal(t.alignment, 5, 'item anchor remains TOPLEFT, not BOTTOMLEFT');
  assert.equal(t.rotation, 0);
  assert.deepEqual([t.cropLeft,t.cropRight,t.cropTop,t.cropBottom], [0,0,0,0]);
  const f = Math.fround;
  const w = f(t.sourceWidth * Math.abs(t.scaleX));
  const h = f(t.sourceHeight * Math.abs(t.scaleY));
  const useWidth = f(t.boundsWidth / t.boundsHeight) < f(w / h);
  const mul = f(useWidth ? t.boundsWidth / w : t.boundsHeight / h);
  const width = f(t.sourceWidth * f(t.scaleX * mul));
  const height = f(t.sourceHeight * f(t.scaleY * mul));
  const dx = Math.trunc(f(t.boundsWidth - Math.abs(width)));
  const dy = Math.trunc(f(t.boundsHeight - Math.abs(height)));
  const xOffset = t.boundsAlignment & 2 ? dx : t.boundsAlignment & 1 ? 0 : Math.trunc(dx / 2);
  const yOffset = t.boundsAlignment & 8 ? dy : t.boundsAlignment & 4 ? 0 : Math.trunc(dy / 2);
  const left = f(t.positionX + xOffset);
  const top = f(t.positionY + yOffset);
  return {left, top, width, height, bottom:f(top + height), offsetY:yOffset};
}

const root = path.resolve(import.meta.dirname, '..');
const layout = JSON.parse(await fs.readFile(path.join(root, 'artwork/assets/cyber-monolith/obs-layout.json'), 'utf8'));

test('OBS-CM-03: every pixel of the idle horizontal CAMERA music rectangle is transparent', async () => {
  const [left, top, width, height] = layout.horizontal.music;
  const {data, info} = await sharp(path.join(root, 'artwork/scenes/rendered/04-camera-horizontal.webp'))
    .extract({left, top, width, height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width, info.height], [640, 128]);
  let nonTransparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) nonTransparent++;
  assert.equal(nonTransparent, 0, 'idle music slot must not bake any opaque backdrop or edge into the camera HUD');
});

test('OBS-CM-04: horizontal alerts leave a positive gap before donors, retaining aspect and OBS bounds', () => {
  const [, y, width, height] = layout.horizontal.alerts;
  assert.equal(width, 1100);
  assert.equal(height, 366.67, 'logical aspect-preserving height is unchanged');
  assert.ok(layout.horizontal.donors[1] - (y + height) >= 8, 'logical alert reservation needs at least 8 px gap');
  assert.equal(layout.horizontal.donors[1] - (y + 366.5), 9.5, 'actual OBS-quantized bounds leave 9.5 px');
});

test('OBS-CM-01: three audited chat items fit to the panel bottom, without changing their anchor, viewport or bounds', async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(root, 'tests/cyber-scene-geometry.fixture.json'), 'utf8'));
  assert.equal(fixture.obsVersion, '32.2.2');
  assert.ok(layout.chatFit, 'layout must specify fitted-content alignment separately from the scene-item anchor');
  const corrections = JSON.parse(await fs.readFile(path.join(root, 'artwork/scenes/geometry-corrections.json'), 'utf8'));
  assert.equal(corrections.length, 11, 'four geometry corrections, six bounded donor heights and the existing CAMERA V social strip');
  const chats = fixture.items.filter(item => item.transform.boundsType === 'OBS_BOUNDS_SCALE_INNER');
  assert.equal(chats.length, 3);
  for (const item of chats) {
    const mapKey = item.transform.boundsWidth === 640 ? 'horizontal' : 'vertical-camera';
    const policy = layout.chatFit[mapKey];
    assert.deepEqual(policy, {sourceViewport:[1100,800],boundsType:'OBS_BOUNDS_SCALE_INNER',alignment:5,boundsAlignment:9});
    const correction = corrections.find(c => c.sceneUuid === item.sceneUuid && c.itemId === item.itemId);
    assert.deepEqual(correction.fieldOld, {boundsAlignment:5});
    assert.deepEqual(correction.expectedNew, {boundsAlignment:9});
    const t = {...item.transform, ...correction.expectedNew};
    assert.deepEqual({...t,boundsAlignment:5}, item.transform, 'all other transform fields are byte-equivalent');
    const old = fittedViewport(item.transform);
    const fitted = fittedViewport(t);
    const panel = layout[mapKey].chat;
    const bottom = panel[1] + panel[3];
    assert.ok(bottom - old.bottom > 75, 'fixture must reproduce the audited empty lower strip');
    assert.equal(fitted.offsetY, mapKey === 'horizontal' ? 174 : 76, 'OBS integer cast, not idealized fractional offset');
    assert.ok(bottom - fitted.bottom >= 0 && bottom - fitted.bottom < 1, 'fitted content reaches the bottom within OBS integer alignment precision');
    assert.equal(fitted.left, panel[0]);
    assert.ok(Math.abs(fitted.width - panel[2]) < 0.001);
    assert.equal(fitted.height, old.height, 'fit scale/aspect cannot change');
  }
  const alert = fixture.items.find(item => item.itemId === 7);
  const correction = corrections.find(c => c.sceneUuid === alert.sceneUuid && c.itemId === 7);
  assert.deepEqual(correction.fieldOld, {positionY:840});
  assert.deepEqual(correction.expectedNew, {positionY:824});
  const t = {...alert.transform, ...correction.expectedNew};
  assert.deepEqual({...t,positionY:840}, alert.transform, 'preserve alert bounds/type/aspect and all unrelated fields');
  assert.equal(layout.horizontal.donors[1] - (t.positionY + t.boundsHeight), 9.5);
});

test('CAMERA H: whole chat and donors rectangles remain transparent while idle', async () => {
  for (const slot of ['chat','donors']) {
    const [left,top,width,height] = layout.horizontal[slot];
    const data = await sharp(path.join(root,'artwork/scenes/rendered/04-camera-horizontal.webp')).extract({left,top,width,height:Math.floor(height)}).ensureAlpha().raw().toBuffer();
    let nonTransparent = 0;
    for (let i=3;i<data.length;i+=4) if (data[i] !== 0) nonTransparent++;
    assert.equal(nonTransparent,0,`${slot} must not bake a persistent panel or border over camera footage`);
  }
});

test('donors: 33 percent less height everywhere, identical widths and positions, music untouched', () => {
  assert.deepEqual(layout.horizontal.donors,[120,1200,1100,147.4]);
  assert.deepEqual(layout['vertical-status'].donors,[120,1320,720,96.48]);
  assert.deepEqual(layout['vertical-camera'].donors,[120,1344,720,96.48]);
  assert.deepEqual(layout.horizontal.music,[1740,1010,640,128]);
  assert.deepEqual(layout['vertical-status'].music,[120,540,720,144]);
  assert.deepEqual(layout['vertical-camera'].music,[120,1344,720,144]);
});

test('SOCIAL H: full-width separate-source mapping preserves the original displayed strip height', () => {
  assert.deepEqual(layout.horizontal.social,[0,0,2560,64*5/6]);
  assert.deepEqual(layout.horizontalSocial.sourceViewport,[3072,64]);
  assert.equal(layout.horizontalSocial.scale,5/6);
  assert.equal(layout.horizontalSocial.nicknameSourceSize,48);
  assert.equal(layout.horizontalSocial.iconSourceSize,44);
  assert.deepEqual(layout.horizontalSocial.scenes,['76421b68-7b35-46ec-b6df-66024e49e1f4','15239ffd-4bf6-45ba-a332-34c5ab063769','6725a9c4-e473-4df7-ba67-b0361df6b062','6cad31da-878f-45fe-ad3a-be3196f325b4']);
  assert.deepEqual(layout['vertical-status'].social,[0,1856,1080,64]);
  assert.deepEqual(layout['vertical-camera'].social,[0,608,1080,64]);
  assert.ok(layout['vertical-camera'].chat[1] - (layout['vertical-camera'].social[1] + 64) >= 32);
});

test('donor API fixture: all 13 placements shrink height 33 percent, without width/scale/position changes', async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(root,'tests/cyber-scene-geometry.fixture.json'),'utf8'));
  const corrections = JSON.parse(await fs.readFile(path.join(root,'artwork/scenes/geometry-corrections.json'),'utf8'));
  assert.equal(fixture.donors.length,13);
  let bounded=0;
  for (const item of fixture.donors) {
    const t=item.transform;
    assert.deepEqual([t.sourceWidth,t.sourceHeight],[1000,200]);
    if (t.boundsType === 'OBS_BOUNDS_NONE') {
      assert.equal(corrections.find(c=>c.sceneUuid===item.sceneUuid && c.itemId===item.itemId),undefined,'NONE needs only global source height 134; never rewrite its transform');
      assert.equal(134*t.scaleY,(200*t.scaleY)*134/200);
    } else {
      bounded++;
      const c=corrections.find(c=>c.sceneUuid===item.sceneUuid && c.itemId===item.itemId);
      assert.deepEqual(c.fieldOld,{boundsHeight:t.boundsHeight});
      assert.deepEqual(c.expectedNew,{boundsHeight:t.boundsHeight*134/200});
      assert.deepEqual({...t,...c.expectedNew,boundsHeight:t.boundsHeight},t);
      assert.equal(c.expectedNew.boundsHeight===147.4 || c.expectedNew.boundsHeight===96.48,true);
    }
  }
  assert.equal(bounded,6);
});

test('CAMERA V: existing social item starts exactly below the unchanged actual camera viewport', async () => {
  const fixture=JSON.parse(await fs.readFile(path.join(root,'tests/cyber-scene-geometry.fixture.json'),'utf8'));
  const camera=fixture.verticalCameraSocial.find(i=>i.itemId===1).transform;
  const social=fixture.verticalCameraSocial.find(i=>i.itemId===18).transform;
  assert.equal(camera.boundsType,'OBS_BOUNDS_NONE');
  assert.deepEqual([camera.cropTop,camera.cropBottom,camera.cropLeft,camera.cropRight,camera.alignment,camera.rotation],[0,0,0,0,5,0]);
  const actualBottom=camera.positionY+Math.fround(camera.sourceHeight*camera.scaleY);
  assert.equal(actualBottom,608);
  const corrections=JSON.parse(await fs.readFile(path.join(root,'artwork/scenes/geometry-corrections.json'),'utf8'));
  const c=corrections.find(i=>i.sceneUuid==='b38334de-de76-4bc9-95c3-4917ef1c342c'&&i.itemId===18);
  assert.deepEqual(c.fieldOld,{positionY:1856});
  assert.deepEqual(c.expectedNew,{positionY:actualBottom});
  assert.deepEqual({...social,...c.expectedNew,positionY:1856},social);
  assert.deepEqual(layout['vertical-camera'].social,[0,608,1080,64]);
  assert.equal(layout['vertical-camera'].chat[1]-(actualBottom+social.height),32);
  assert.equal(corrections.some(i=>i.sceneUuid==='b38334de-de76-4bc9-95c3-4917ef1c342c'&&i.itemId===1),false,'never patch camera transform');
});

test('fresh offline screenshots match lossless WEBPs when a local render report exists', {skip:!await fs.access(path.join(root,'artwork/scenes/rendered/cyber-scenes-build-report.json')).then(()=>true,()=>false)}, async () => {
  const report=JSON.parse(await fs.readFile(path.join(root,'artwork/scenes/rendered/cyber-scenes-build-report.json'),'utf8'));
  assert.equal(report.outputs.length,12);
  for (const file of report.outputs) {
    assert.ok(file.screenshot,'persist the actual full-size browser screenshot, not a mockup');
    const png=path.join(root,'artwork/scenes/rendered',file.screenshot);
    const webp=path.join(root,'artwork/scenes/rendered',file.name+'.webp');
    const meta=await sharp(png).metadata();
    assert.deepEqual([meta.width,meta.height],[file.width,file.height]);
    assert.equal((await sharp(png).ensureAlpha().raw().toBuffer()).equals(await sharp(webp).ensureAlpha().raw().toBuffer()),true);
  }
  if (process.env.CYBER_BACKUP_SCRIPT) assert.equal(report.backupReceipts.length,report.outputs.length*3+3);
});
