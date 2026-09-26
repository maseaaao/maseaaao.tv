import { pathToFileURL } from "node:url";
import QRCode from "qrcode";
import sharp from "sharp";
import jsQR from "jsqr";

const svg = (width, height, content) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${content}
  </svg>
`);

const defaults = {
  width: 800,
  margin: 3,
  errorCorrectionLevel: "H",
  color: { dark: "#181126", light: "#fffaff" },
  logoFraction: 0.16,
  maxCoveredArea: 0.25,
  tile: { fill: "#fffaff", stroke: "#dfc4ff", strokeOpacity: 1 },
};

/**
 * Декодирует QR-код из PNG/JPEG-буфера или файла.
 * @returns {Promise<string|null>} распознанный текст либо null, если код не прочитан
 */
async function decodeQr(input) {
  const image = Buffer.isBuffer(input) ? input : await sharp(input).png().toBuffer();
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return result ? result.data : null;
}

async function roundedPortrait(logo, size, radius) {
  const image = await sharp(logo).resize(size, size, { fit: "cover", position: "centre" }).png().toBuffer();
  const mask = svg(size, size, `<rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/>`);
  return sharp(image).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

/**
 * Генерирует PNG QR-кода с картинкой в центре в фирменном стиле проекта
 * (белая скруглённая плитка с лавандовой обводкой + скруглённый портрет)
 * и гарантирует читаемость: перед возвратом результат декодируется.
 *
 * Безопасность логотипа:
 *  - errorCorrectionLevel "H" восстанавливает до 30% повреждённых модулей;
 *  - плитка центрируется и по умолчанию занимает ≤ 25% площади модулей (maxCoveredArea);
 *  - плитка не заходит в зоны поиска (finder patterns) — по краям остаётся свободный модуль.
 *
 * @param {object} options
 * @param {string} options.text  Содержимое QR-кода (обычно URL).
 * @param {number} [options.width=800]  Желаемый размер; рисуется целым числом пикселей на модуль.
 * @param {number} [options.margin=3]  Тихая зона в модулях.
 * @param {string} [options.errorCorrectionLevel="H"]
 * @param {{dark?: string, light?: string}} [options.color]
 * @param {Buffer|null} [options.logo]  Картинка в центр (сырое изображение; скругление внутри).
 * @param {number} [options.logoFraction=0.16]  Сторона плитки как доля стороны QR (округляется до целых модулей).
 * @param {number} [options.maxCoveredArea=0.25]  Максимальная доля закрытых модулей.
 * @param {{fill?: string, stroke?: string, strokeOpacity?: number}|null} [options.tile]  null — без плитки.
 * @returns {Promise<{buffer: Buffer, width: number, decoded: string, modules: number, scale: number, tileModules: number}>}
 */
export async function generateQrWithLogo(options = {}) {
  const {
    text,
    width,
    margin,
    errorCorrectionLevel,
    color,
    logo,
    logoFraction,
    maxCoveredArea,
    tile: tileOverrides,
  } = { ...defaults, ...options };
  const tile = tileOverrides === null ? null : { ...defaults.tile, ...tileOverrides };
  if (!text) throw new Error("generateQrWithLogo: options.text is required");

  const modules = QRCode.create(text, { errorCorrectionLevel }).modules.size;
  const scale = Math.max(1, Math.floor(width / (modules + margin * 2)));
  const symbolSide = (modules + margin * 2) * scale;

  let tileModules = 0;
  if (logo && tile) {
    tileModules = Math.max(1, Math.round(logoFraction * (modules + margin * 2)));
    // Центр свободен от finder patterns: зоны поиска с разделителями занимают 8 модулей с каждого угла,
    // оставляем ещё 1 модуль зазора → максимум modules - 18 модулей на плитку.
    tileModules = Math.min(tileModules, modules - 18);
    const coveredArea = (tileModules / modules) ** 2;
    if (coveredArea > maxCoveredArea) {
      throw new Error(
        `generateQrWithLogo: tile covers ${(coveredArea * 100).toFixed(1)}% of modules ` +
        `(limit ${maxCoveredArea * 100}%). Reduce logoFraction or raise error correction.`,
      );
    }
    if (tileModules < 1) throw new Error("generateQrWithLogo: QR version too small for a centred logo");
  }

  const layers = [];
  if (tileModules > 0) {
    const tileSide = tileModules * scale;
    const cornerRadius = Math.round(tileSide * 0.25);
    const strokeWidth = Math.max(2, Math.round(tileSide * 0.04));
    const inset = Math.max(1, Math.round(tileSide * 0.023));
    const tileImage = svg(tileSide, tileSide, `
      <rect width="${tileSide}" height="${tileSide}" rx="${cornerRadius}" fill="${tile.fill}"/>
      <rect x="${inset}" y="${inset}" width="${tileSide - inset * 2}" height="${tileSide - inset * 2}" rx="${cornerRadius - inset}" fill="none" stroke="${tile.stroke}" stroke-opacity="${tile.strokeOpacity}" stroke-width="${strokeWidth}"/>
    `);
    layers.push({
      input: tileImage,
      left: Math.round((symbolSide - tileSide) / 2),
      top: Math.round((symbolSide - tileSide) / 2),
    });
    const portraitSide = Math.round(tileSide * 0.75);
    const portrait = await roundedPortrait(logo, portraitSide, Math.round(portraitSide * 0.25));
    layers.push({
      input: portrait,
      left: Math.round((symbolSide - portraitSide) / 2),
      top: Math.round((symbolSide - portraitSide) / 2),
    });
  }

  const qr = await QRCode.toBuffer(text, {
    type: "png",
    scale,
    margin,
    errorCorrectionLevel,
    color: { dark: color.dark, light: color.light },
  });

  let buffer = layers.length
    ? await sharp(qr).composite(layers).png().toBuffer()
    : qr;

  // Slightly rounded plate corners; outside the plate stays transparent.
  const cornerRadius = Math.round(symbolSide * 0.07);
  const plateMask = svg(symbolSide, symbolSide, `<rect width="${symbolSide}" height="${symbolSide}" rx="${cornerRadius}" fill="#fff"/>`);
  buffer = await sharp(buffer).composite([{ input: plateMask, blend: "dest-in" }]).png().toBuffer();

  const decoded = await decodeQr(buffer);
  if (decoded !== text) {
    throw new Error(
      `generateQrWithLogo: generated QR is not readable — expected ${JSON.stringify(text)}, ` +
      `decoded ${JSON.stringify(decoded)}`,
    );
  }

  return { buffer, width: symbolSide, decoded, modules, scale, tileModules };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const [text, output, ...rest] = process.argv.slice(2);
  if (!text || !output) {
    console.log("Usage: node scripts/generate-qr-with-logo.mjs <text> <output.png|jpeg> [--width 800] [--logo image] [--margin 3] [--level H] [--logo-fraction 0.16]");
    process.exit(1);
  }
  const arg = (name, fallback) => {
    const index = rest.indexOf(name);
    return index >= 0 && rest[index + 1] ? rest[index + 1] : fallback;
  };
  const logoPath = arg("--logo");
  const result = await generateQrWithLogo({
    text,
    width: Number(arg("--width", defaults.width)),
    margin: Number(arg("--margin", defaults.margin)),
    errorCorrectionLevel: arg("--level", defaults.errorCorrectionLevel),
    logo: logoPath ? await sharp(logoPath).toBuffer() : null,
    logoFraction: Number(arg("--logo-fraction", defaults.logoFraction)),
  });
  const pipeline = sharp(result.buffer);
  if (/\.(jpe?g)$/i.test(output)) {
    await pipeline.jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toFile(output);
  } else {
    await pipeline.png().toFile(output);
  }
  console.log(`QR ${result.width}px (${result.modules} modules, scale ${result.scale}, tile ${result.tileModules} modules) verified: ${result.decoded}`);
}
