import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../..');

/** Векторный мастер знака: 512x512, две заливки с ролями brand и surface. */
const masterPath = path.join(root, 'artwork/logo/mark.svg');
const tokensPath = path.join(root, 'packages/design/tokens.css');

/** Значение цветового токена из палитры проекта. */
export async function readToken(token: string) {
  const css = await fs.readFile(tokensPath, 'utf8');
  const match = css.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,8});`));
  if (!match) {
    throw new Error(`tokens.css: не найден токен --${token}`);
  }
  return match[1];
}

export interface LogoColors {
  background: string;
  mark: string;
}

/** Фон знака — бренд, сам знак — поверхность: обе краски из палитры. */
export async function logoColors(): Promise<LogoColors> {
  return { background: await readToken('color-brand'), mark: await readToken('color-surface') };
}

/** Заливка элемента по роли: цвет задаётся конкретным значением, роль помечена. */
const FILL_ATTRIBUTE_RE = /(^|\s)fill="[^"]*"/;
const roleElement = (role: string) =>
  new RegExp(`<(rect|path)\\b[^>]*data-fill="${role}"[^>]*>`, 'g');

/**
 * SVG мастера с цветами палитры.
 * В файле заливки заданы конкретными значениями (мастер открывается и
 * просматривается сам по себе), а здесь они перекрашиваются по ролям
 * `data-fill`, поэтому палитра остаётся единственным источником цвета.
 */
export async function logoMasterSvg(colors?: LogoColors) {
  const resolved = colors ?? (await logoColors());
  let svg = await fs.readFile(masterPath, 'utf8');
  for (const [role, color] of [
    ['brand', resolved.background],
    ['surface', resolved.mark],
  ] as const) {
    let replaced = false;
    svg = svg.replace(roleElement(role), (tag) => {
      replaced = true;
      return tag.replace(FILL_ATTRIBUTE_RE, `$1fill="${color}"`);
    });
    if (!replaced) {
      throw new Error(`artwork/logo/mark.svg: нет элемента с data-fill="${role}"`);
    }
  }
  return svg;
}

/** Растр мастера любого размера. */
export async function logoMasterPng(size: number) {
  const svg = await logoMasterSvg();
  return sharp(Buffer.from(svg)).resize(size, size, { fit: 'fill' }).png().toBuffer();
}
