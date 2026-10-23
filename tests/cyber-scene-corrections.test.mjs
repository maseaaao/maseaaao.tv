import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

// OBS 32.2.2 libobs/obs-scene.c calculate_bounds_data + add_alignment:
// arithmetic is float32; the leftover size is cast to int BEFORE alignment.
// libobs/obs-defs.h: LEFT=1, TOP=4, BOTTOM=8 (BOTTOMLEFT=9).
// This intentionally does not substitute ideal floating-point centering math.
function fittedViewport(t) {
  assert.equal(t.boundsType, 'OBS_BOUNDS_SCALE_INNER');
  assert.equal(t.alignment, 5, 'item anchor remains TOPLEFT, not BOTTOMLEFT');
  assert.equal(t.rotation, 0);
  assert.deepEqual([t.cropLeft, t.cropRight, t.cropTop, t.cropBottom], [0, 0, 0, 0]);
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
  return { left, top, width, height, bottom: f(top + height), offsetY: yOffset };
}

const root = path.resolve(import.meta.dirname, '..');
const layout = JSON.parse(await fs.readFile(path.join(root, 'artwork/scenes/layout.json'), 'utf8'));

test('camera widget slots remain completely transparent', async () => {
  for (const slot of ['chat', 'music', 'donors']) {
    const [left, top, width, height] = layout.horizontal[slot];
    const data = await sharp(path.join(root, 'artwork/scenes/rendered/04-camera-horizontal.webp'))
      .extract({ left, top, width, height: Math.floor(height) })
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 0, slot);
  }
});

test('chat fitted content reaches its panel bottom with OBS float32 alignment', async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(root, 'tests/obs-scene-geometry.fixture.json'), 'utf8'),
  );
  const chats = fixture.items.filter(
    (item) => item.transform.boundsType === 'OBS_BOUNDS_SCALE_INNER',
  );
  assert.equal(chats.length, 3);
  for (const { transform } of chats) {
    const key = transform.boundsWidth === 640 ? 'horizontal' : 'vertical-camera';
    assert.deepEqual(layout.chatFit[key], {
      sourceViewport: [1100, 800],
      boundsType: 'OBS_BOUNDS_SCALE_INNER',
      alignment: 5,
      boundsAlignment: 9,
    });
    assert.equal(transform.boundsAlignment, 9);
    const fitted = fittedViewport(transform),
      panel = layout[key].chat;
    const gap = panel[1] + panel[3] - fitted.bottom;
    assert(gap >= 0 && gap < 1, 'OBS integer alignment leaves less than one pixel');
    assert.equal(fitted.left, panel[0]);
    assert(Math.abs(fitted.width - panel[2]) < 0.001);
  }
});

test('alerts retain aspect and leave a readable gap before donors', () => {
  assert.deepEqual(layout.horizontal.alerts, [120, 824, 1100, 366.67]);
  assert.equal(layout.horizontal.donors[1] - (824 + 366.5), 9.5);
});

test('donor placements retain the current source size and mapped bounds', async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(root, 'tests/obs-scene-geometry.fixture.json'), 'utf8'),
  );
  assert.equal(fixture.donors.length, 13);
  assert.equal(
    fixture.donors.filter((i) => i.transform.boundsType !== 'OBS_BOUNDS_NONE').length,
    6,
  );
  for (const { transform: t } of fixture.donors) {
    assert.deepEqual([t.sourceWidth, t.sourceHeight], [1000, 134]);
    if (t.boundsType !== 'OBS_BOUNDS_NONE') assert([147.4, 96.48].includes(t.boundsHeight));
  }
  assert.deepEqual(layout.horizontal.donors, [120, 1200, 1100, 147.4]);
  assert.deepEqual(layout['vertical-status'].donors, [120, 1320, 720, 96.48]);
  assert.deepEqual(layout['vertical-camera'].donors, [120, 1344, 720, 96.48]);
});

test('social strip starts below the unchanged camera without overlapping chat', async () => {
  const fixture = JSON.parse(
    await fs.readFile(path.join(root, 'tests/obs-scene-geometry.fixture.json'), 'utf8'),
  );
  const camera = fixture.verticalCameraSocial.find((i) => i.itemId === 1).transform;
  const social = fixture.verticalCameraSocial.find((i) => i.itemId === 18).transform;
  const bottom = camera.positionY + Math.fround(camera.sourceHeight * camera.scaleY);
  assert.equal(bottom, 608);
  assert.equal(social.positionY, bottom);
  assert.deepEqual(layout['vertical-camera'].social, [0, 608, 1080, 64]);
  assert.equal(layout['vertical-camera'].chat[1] - (bottom + social.height), 32);
  assert.deepEqual(layout.horizontalSocial.sourceViewport, [3072, 64]);
  assert.equal(layout.horizontalSocial.scale, 5 / 6);
  assert.deepEqual(layout.horizontal.social, [0, 0, 2560, (64 * 5) / 6]);
});
