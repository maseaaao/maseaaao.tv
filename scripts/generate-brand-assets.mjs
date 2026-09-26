import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { textPath } from "./noir-text.mjs";

const root = path.resolve(import.meta.dirname, "..");
const assetsDir = path.join(root, "dist", "assets");
const avatarPath = path.join(assetsDir, "avatar-master.png");
const circleLogoPath = path.join(
  root,
  "src",
  "logo",
  "rendered",
  "avatar-circle-512.png",
);

const noir = {
  ink: "#070709",
  surface: "#101016",
  text: "#ececee",
  dim: "#9c9ca6",
  accent: "#b79cff",
  accent2: "#8d6cf0",
};

const svg = (width, height, content) =>
  Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}
  </svg>
`);

// Фон бренда: тёмная виньетка (нуар) или белый (светлые баннеры/обложки).
function backgroundSvg(width, height, options = {}) {
  const { rounded = 0, hairline = true, light = false } = options;
  const clip = rounded
    ? `<clipPath id="clip"><rect width="${width}" height="${height}" rx="${rounded}"/></clipPath>`
    : "";
  const inset = Math.max(2, Math.min(width, height) * 0.025);
  const ringStroke = light
    ? "rgba(141, 108, 240, 0.35)"
    : "rgba(183, 156, 255, 0.22)";
  const ring = hairline
    ? `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.max(rounded * 0.8, inset)}" fill="none" stroke="${ringStroke}" stroke-width="${Math.max(1, Math.min(width, height) * 0.0025)}"/>`
    : "";
  const base = light
    ? `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    : `<rect width="${width}" height="${height}" fill="url(#vig)"/>`;
  const defs = light
    ? `<linearGradient id="hair" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#b79cff" stop-opacity="0"/><stop offset=".3" stop-color="#b79cff"/><stop offset=".7" stop-color="#8d6cf0"/><stop offset="1" stop-color="#8d6cf0" stop-opacity="0"/></linearGradient>`
    : `<radialGradient id="vig" cx=".5" cy="0" r="1.5"><stop stop-color="#101014"/><stop offset=".55" stop-color="#0a0a0d"/><stop offset="1" stop-color="#070709"/></radialGradient><linearGradient id="hair" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${noir.accent}" stop-opacity="0"/><stop offset=".3" stop-color="${noir.accent}"/><stop offset=".7" stop-color="${noir.accent2}"/><stop offset="1" stop-color="${noir.accent2}" stop-opacity="0"/></linearGradient>`;
  return svg(
    width,
    height,
    `
    <defs>
      ${clip}
      ${defs}
    </defs>
    <g ${rounded ? 'clip-path="url(#clip)"' : ""}>
      ${base}
      <rect width="${width}" height="${Math.max(2, height * 0.004)}" fill="url(#hair)"/>
      ${ring}
    </g>
  `,
  );
}

async function avatarCircle(size) {
  const image = await sharp(avatarPath)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const mask = svg(
    size,
    size,
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>`,
  );
  return sharp(image)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

// Иконки — круглый логотип как есть (avatar-circle), без подложек и кеyning.
const circleIconSource = path.join(
  root,
  "src",
  "logo",
  "rendered",
  "avatar-circle-1024.png",
);

async function makeAppIcon(size) {
  return sharp(circleIconSource)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

async function writeAppIcons() {
  const names = [
    ["android-chrome-512x512.png", 512],
    ["apple-touch-icon.png", 180],
    ["apple-touch-icon-1024x1024.png", 1024],
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["favicon-48x48.png", 48],
  ];
  const iconBuffers = new Map();
  for (const [name, size] of names) {
    const output = await makeAppIcon(size);
    iconBuffers.set(size, output);
    await writeFile(path.join(root, "dist", name), output);
  }
  const icoSizes = [16, 32, 48];
  const entries = icoSizes.map((size) => iconBuffers.get(size));
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  entries.forEach((entry, index) => {
    const size = icoSizes[index];
    const entryOffset = 6 + index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(entry.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += entry.length;
  });
  await writeFile(
    path.join(root, "dist", "favicon.ico"),
    Buffer.concat([directory, ...entries]),
  );
}

// QR-код больше здесь не генерируется: единственный источник —
// scripts/refresh-logo-qr.mjs (npm run render:logo), чтобы старый стиль
// не перезаписывал актуальный код в dist/assets/maseaaao.tv.jpeg.

async function writeSocialImages() {
  const ogWidth = 1200;
  const ogHeight = 630;
  const portrait = await avatarCircle(430);
  const mark = await sharp(circleLogoPath).resize(120, 120).png().toBuffer();
  const caption = textPath("LIVE · TWITCH · YOUTUBE", 30, 0.22);
  const captionSvg = svg(
    ogWidth,
    ogHeight,
    `<g transform="translate(90 420)" fill="#8d6cf0"><path d="${caption.d}"/></g>
     <path d="M 90 452 H 500" stroke="#8d6cf0" stroke-opacity=".4" stroke-width="2"/>
     <text x="90" y="505" fill="#6f6f78" font-family="Arial, sans-serif" font-size="22" letter-spacing="4">MASEAAAO.TV</text>`,
  );
  await sharp(
    backgroundSvg(ogWidth, ogHeight, { rounded: 0, hairline: true, light: true }),
  ).composite([
      { input: mark, left: 90, top: 96 },
      { input: portrait, left: 730, top: 100 },
      { input: captionSvg },
    ])
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
    .toFile(path.join(root, "dist", "og-image.jpg"));

  await sharp(
    backgroundSvg(1024, 1024, { rounded: 92, hairline: true, light: true }),
  ).png().toFile(path.join(assetsDir, "subscribe-background-ai.png"));
}

await mkdir(assetsDir, { recursive: true });
await Promise.all([writeAppIcons(), writeSocialImages()]);
console.log("Generated brand assets and social images. QR is owned by render:logo.");
