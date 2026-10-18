import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import {launchBrowser} from "./browser.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const requested = process.argv[2] || "all";
const browser = await launchBrowser();

async function render(source, target, width, height, format = "png", scale = 1) {
  const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: scale, reducedMotion: "reduce"});
  try {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("requestfailed", request => errors.push(request.url()));
    await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(root, source)).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const fonts = await document.fonts.load('600 16px "Unbounded"', "maseaaao АБВ");
      if (!fonts.length || fonts.some(font => font.status !== "loaded")) throw Error("Accent font is unavailable");
      await Promise.all([...document.images].map(image => image.decode()));
    });
    if (errors.length) throw Error(errors.join("\n"));
    const png = await page.screenshot({omitBackground: true});
    const image = sharp(png);
    const bytes = format === "jpeg"
      ? await image.flatten({background: "#f4f3ec"}).jpeg({quality: 92, chromaSubsampling: "4:4:4"}).toBuffer()
      : await image.png().toBuffer();
    await fs.mkdir(path.dirname(path.join(root, target)), {recursive: true});
    await fs.writeFile(path.join(root, target), bytes);
    console.log(target + " " + width * scale + "x" + height * scale + " " + bytes.length + " bytes");
  } finally {
    await page.close();
  }
}

try {
  if (requested === "all" || requested === "banners") {
    await render("artwork/banners/twitch-schedule.html", "artwork/banners/rendered/twitch-schedule.jpeg", 1200, 480, "jpeg");
    await render("artwork/banners/youtube-schedule.html", "artwork/banners/rendered/youtube-schedule.jpeg", 2560, 1440, "jpeg");
  }
  if (requested === "all" || requested === "panels") {
    for (const name of (await fs.readdir(path.join(root, "artwork/twitch-description"))).filter(name => name.endsWith(".html"))) {
      await render("artwork/twitch-description/" + name, "artwork/twitch-description/rendered/" + name.replace(".html", ".jpeg"), 320, 64, "jpeg");
    }
  }
  if (requested === "all" || requested === "brand") {
    await render("artwork/brand/og.html", "apps/website/public/og-image.jpg", 1200, 630, "jpeg");
    await render("artwork/brand/subscribe.html", "apps/website/public/assets/subscribe-512.png", 512, 512);
    await render("artwork/brand/background.html", "apps/website/public/assets/subscribe-background-ai.png", 512, 512);
  }
  if (["all", "brand", "favicon"].includes(requested)) {
    await render("artwork/brand/icon.html", "apps/website/public/icon-master.png", 512, 512);
    const master = await fs.readFile(path.join(root, "apps/website/public/icon-master.png"));
    const favicon = await sharp(master).composite([{
      input: await fs.readFile(path.join(root, "artwork/brand/favicon-mask.svg")),
      blend: "dest-in",
    }]).png().toBuffer();
    const icons = [];
    for (const size of [16, 32, 48]) {
      const data = await sharp(favicon).resize(size).png().toBuffer();
      icons.push({size, data});
      await fs.writeFile(path.join(root, "apps/website/public/favicon-" + size + "x" + size + ".png"), data);
    }
    const ico = Buffer.alloc(6 + 16 * icons.length);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(icons.length, 4);
    let offset = ico.length;
    icons.forEach(({size, data}, index) => {
      const at = 6 + index * 16;
      ico[at] = size;
      ico[at + 1] = size;
      ico.writeUInt16LE(1, at + 4);
      ico.writeUInt16LE(32, at + 6);
      ico.writeUInt32LE(data.length, at + 8);
      ico.writeUInt32LE(offset, at + 12);
      offset += data.length;
    });
    await fs.writeFile(path.join(root, "apps/website/public/favicon.ico"), Buffer.concat([ico, ...icons.map(icon => icon.data)]));
    if (requested !== "favicon") {
      for (const [name, size] of [["apple-touch-icon.png", 180], ["apple-touch-icon-1024x1024.png", 1024], ["android-chrome-512x512.png", 512]]) {
        await sharp(master).resize(size).png().toFile(path.join(root, "apps/website/public", name));
      }
    }
    await fs.unlink(path.join(root, "apps/website/public/icon-master.png"));
  }
  if (requested === "all" || requested === "wallpapers") {
    for (const name of (await fs.readdir(path.join(root, "artwork/wallpapers"))).filter(name => name.endsWith(".html"))) {
      const phone = name.startsWith("phone");
      await render("artwork/wallpapers/" + name, "artwork/wallpapers/rendered/" + name.replace(".html", ".png"), phone ? 1440 : 3840, phone ? 2560 : 2160);
    }
  }
} finally {
  await browser.close();
}
