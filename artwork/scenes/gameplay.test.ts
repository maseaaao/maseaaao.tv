import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const layout = JSON.parse(await readFile(`${import.meta.dir}/layout.json`, 'utf8'));
const buildOrExport = /build|render|export/;

test('social source viewports match every planned scene without stretching or stale metadata', () => {
  expect(layout.horizontalSocial).toBeUndefined();
  const sources = layout.socialSources;
  expect(sources).toEqual({
    'horizontal-camera': { fragment: '', viewport: [1080, 88] },
    'horizontal-gameplay': { fragment: '', viewport: [480, 54] },
    'horizontal-status': { fragment: '', viewport: [640, 88] },
    'vertical-camera-gameplay': { fragment: '', viewport: [1080, 88] },
    'vertical-status': { fragment: '', viewport: [720, 88] },
  });
  for (const [map, source] of [
    [layout['horizontal-status'], sources['horizontal-status']],
    [layout['vertical-status'], sources['vertical-status']],
    [layout['vertical-camera'], sources['vertical-camera-gameplay']],
    [layout.gameplay.vertical, sources['vertical-camera-gameplay']],
  ]) {
    expect(map.social.slice(2)).toEqual(source.viewport);
  }
  expect(layout.horizontalCameraStrip).toEqual({
    display: [1280, (88 * 1280) / 1080],
    source: [1080, 88],
  });
});

test('root test includes artwork and widget tests without a build or export', async () => {
  const root = JSON.parse(await readFile(`${import.meta.dir}/../../package.json`, 'utf8'));
  expect(root.scripts.test).toContain('test:artwork');
  expect(root.scripts.test).toContain('test:widgets');
  for (const name of ['test:artwork', 'test:widgets']) {
    expect(root.scripts[name]).toBeDefined();
    expect(root.scripts[name]).not.toMatch(buildOrExport);
  }
});
test('every donor viewport preserves the common 1000×134 source proportions', () => {
  for (const name of [
    'horizontal',
    'horizontal-status',
    'vertical-status',
    'horizontal-camera',
    'vertical-camera',
  ]) {
    const [, , width, height] = layout[name].donors;
    expect(height, name).toBeCloseTo((134 * width) / 1000, 4);
  }
});

const expected = [
  ['0305eee8-3723-41ca-9603-5177ee0984ab', 2048, 'bottom'],
  ['febab7fd-dcdd-4cd7-a6fd-5e7f16685767', 32, 'bottom'],
  ['7b8be5f3-e964-4455-b30f-4226bf8287ab', 2048, 'center'],
  ['4e3c5765-5350-455b-b6eb-2ff98ca96bf7', 32, 'center'],
  ['f8513e73-7ce5-433f-b671-713c19e2f8cb', 2048, 'top'],
  ['fe5038c9-c957-4972-b998-7cf146c91f1e', 32, 'top'],
];

test('gameplay scenes use exact source viewports and aligned donor-camera-social stack', () => {
  const game = layout.gameplay;
  expect(game).toBeDefined();
  expect(game.horizontal.scenes.map((scene: { uuid: string }) => scene.uuid)).toEqual(
    expected.map(([uuid]) => uuid),
  );
  for (const [index, [uuid, x, position]] of expected.entries()) {
    const scene = game.horizontal.scenes[index];
    expect([scene.uuid, scene.position]).toEqual([uuid, position]);
    expect(scene.camera[0]).toBe(x);
    const [donors, camera, social] = [scene.donors, scene.camera, scene.social];
    expect(donors[0]).toBe(camera[0]);
    expect(social[0]).toBe(camera[0]);
    expect([donors[2], camera[2], social[2]]).toEqual([480, 480, 480]);
    expect(donors[3]).toBeCloseTo(134 * 0.48, 4);
    expect(donors[1] + donors[3]).toBeCloseTo(camera[1], 4);
    expect(camera[3]).toBeCloseTo(270, 4);
    expect(camera[1] + camera[3]).toBeCloseTo(social[1], 4);
    expect(social.slice(2)).toEqual(game.horizontal.socialSource);
    expect(social[3]).toBeLessThanOrEqual(scene.donorVisible[3]);
    expect(social[1] + social[3]).toBeCloseTo(scene.music[1], 4);
    expect(donors[1]).toBeGreaterThanOrEqual(32);
    expect(social[1] + social[3]).toBeLessThanOrEqual(1440);
    expect(scene.donorVisible[1]).toBeCloseTo(donors[1] + 20 * 0.48, 4);
    expect(scene.donorVisible[3]).toBeCloseTo(114 * 0.48, 4);
    expect([scene.donorVisible[0], scene.donorVisible[2]]).toEqual([donors[0], donors[2]]);
    expect(scene.donorVisible[1] + scene.donorVisible[3]).toBeCloseTo(camera[1], 4);
    // Полоса и музыка остаются без перекрытия.
    const stripBottom = social[1] + social[3];
    expect(
      scene.music[1] + scene.music[3] <= donors[1] ||
        stripBottom <= scene.music[1] + scene.music[3],
    ).toBe(true);
  }
  expect(game.horizontal.donorSource).toEqual([1000, 134]);
  expect(game.horizontal.socialSource).toEqual([480, 54]);
});

test('vertical ANY keeps crop, moves the capture below the social strip, same displayed size', () => {
  const game = layout.gameplay.vertical;
  expect(game.sceneUuid).toBe('2a3a2334-10bd-4ac6-80e8-392e7aa30f14');
  expect(game.gameCapture).toEqual({
    bounds: [1080, 861.78],
    crop: [340, 0, 340, 0],
    position: [0, 840.22],
  });
  const [, socialTop, , socialHeight] = game.social;
  expect(game.gameCapture.position[1]).toBeCloseTo(socialTop + socialHeight, 4);
  const gameBottom = game.gameCapture.position[1] + game.gameCapture.bounds[1];
  expect(gameBottom).toBeLessThanOrEqual(game.music[1]);
  expect(game.donorSource).toEqual([1000, 134]);
  expect(game.socialSource).toEqual([1080, 88]);
  expect(game.donors[3]).toBeCloseTo(134 * 1.08, 4);
  expect(game.donorVisible[1]).toBeCloseTo(game.donors[1] + 20 * 1.08, 4);
  expect(game.donorVisible[3]).toBeCloseTo(114 * 1.08, 4);
  expect([game.donorVisible[0], game.donorVisible[2]]).toEqual([game.donors[0], game.donors[2]]);
  expect(game.donorVisible[1] + game.donorVisible[3]).toBeCloseTo(game.camera[1], 4);
  expect(game.donors[1] + game.donors[3]).toBeCloseTo(game.camera[1], 4);
  expect(game.camera[1] + game.camera[3]).toBeCloseTo(game.social[1], 4);
  expect([game.donors[0], game.camera[0], game.social[0]]).toEqual([0, 0, 0]);
  expect([game.donors[2], game.camera[2], game.social[2]]).toEqual([1080, 1080, 1080]);
  expect(game.social[3]).toBe(88);
});
