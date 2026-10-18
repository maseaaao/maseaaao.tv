import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
for (const [name, width, height] of [
  ["twitch-schedule.jpeg", 1200, 480],
  ["youtube-schedule.jpeg", 2560, 1440],
]) {
  test(`${name} uses the upload-ready image dimensions`, async () => {
    const bytes = await readFile(new URL(`artwork/banners/rendered/${name}`, root));
    const image = await sharp(bytes).metadata();
    assert.equal(image.width, width);
    assert.equal(image.height, height);
    assert.equal(image.format, "jpeg");
  });
}
