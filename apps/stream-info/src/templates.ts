const SPACE_RE = /\s$/;
const SPACE_RE_2 = /^\s/;

/** Токен подстановки названия: короткий, чтобы не загромождать шаблон. */
export const TEMPLATE_TOKEN = '$s';
/** Текущая категория Twitch; нужна, чтобы продублировать игру в YouTube. */
export const GAME_TOKEN = '$g';
/** Прежний формат: читаем его из старых сохранений и черновиков без ошибки. */
const LEGACY_TEMPLATE_TOKEN = '%subtitle%';
const TOKEN_SPLIT_RE = /(\$[sg])/g;

export const DEFAULT_TWITCH_TEMPLATE = '🔴 $s| !tg !yt !tw !donate';
export const DEFAULT_YOUTUBE_TEMPLATE = '🔴 $g | $s| !tg !yt !tw !donate';

/** Переводит шаблон прежнего формата в `$s`, не трогая остальной текст. */
export function migrateTemplateToken(template: string): string {
  return template.includes(LEGACY_TEMPLATE_TOKEN)
    ? template.split(LEGACY_TEMPLATE_TOKEN).join(TEMPLATE_TOKEN)
    : template;
}

export function templateHasToken(template: string): boolean {
  return template.includes(TEMPLATE_TOKEN);
}

export function splitTemplate(template: string): string[] {
  return template.split(TOKEN_SPLIT_RE);
}

/** Шаблон валиден только с ровно одним `$s`: без него название не подставить. */
export function isTemplateValid(template: string): boolean {
  return splitTemplate(template).filter((part) => part === TEMPLATE_TOKEN).length === 1;
}

function removeToken(template: string, token: string): string {
  let value = template;
  let marker = value.indexOf(token);
  while (marker >= 0) {
    const before = value.slice(0, marker);
    const after = value.slice(marker + token.length);
    // Removing an empty token may remove one adjacent whitespace character,
    // but never normalizes unrelated text in the user template.
    value =
      SPACE_RE.test(before) && SPACE_RE_2.test(after)
        ? `${before.slice(0, -1)}${after}`
        : `${before}${after}`;
    marker = value.indexOf(token);
  }
  return value;
}

function replaceToken(template: string, token: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? template.split(token).join(trimmed) : removeToken(template, token);
}

export function titleFromTemplate(template: string, subtitle: string, gameName = ''): string {
  const withGame = replaceToken(template, GAME_TOKEN, gameName);
  return replaceToken(withGame, TEMPLATE_TOKEN, subtitle).trim();
}
