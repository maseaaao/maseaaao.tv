const SPACE_RE = /\s$/;
const SPACE_RE_2 = /^\s/;

/** Токен подстановки названия: короткий, чтобы не загромождать шаблон. */
export const TEMPLATE_TOKEN = '$s';
/** Прежний формат: читаем его из старых сохранений и черновиков без ошибки. */
const LEGACY_TEMPLATE_TOKEN = '%subtitle%';
const TOKEN_SPLIT_RE = /(\$s)/g;

export const DEFAULT_TWITCH_TEMPLATE = '🔴 $s| !tg !yt !tw !donate';

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

/** Шаблон валиден только с ровно одним токеном: без него название не подставить. */
export function isTemplateValid(template: string): boolean {
  return splitTemplate(template).filter((part) => part === TEMPLATE_TOKEN).length === 1;
}

export function titleFromTemplate(template: string, subtitle: string): string {
  const value = subtitle.trim();
  if (value) {
    // Замена функцией: `$` в самом названии не должен читаться как шаблон замены.
    return template.replace(TEMPLATE_TOKEN, () => value).trim();
  }

  const marker = template.indexOf(TEMPLATE_TOKEN);
  if (marker < 0) {
    return template.trim();
  }

  const before = template.slice(0, marker);
  const after = template.slice(marker + TEMPLATE_TOKEN.length);
  // Removing a blank subtitle may remove one adjacent whitespace character,
  // but never normalizes unrelated text in the user template.
  if (SPACE_RE.test(before) && SPACE_RE_2.test(after)) {
    return `${before.slice(0, -1)}${after}`.trim();
  }
  return `${before}${after}`.trim();
}
