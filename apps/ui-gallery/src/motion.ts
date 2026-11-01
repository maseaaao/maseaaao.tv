import tokens from '@maseaaao/design/tokens.css?raw';

const grid = document.querySelector<HTMLElement>('#motion-grid');
const speed = document.querySelector<HTMLSelectElement>('#motion-speed');
const reduce = document.querySelector<HTMLInputElement>('#motion-reduce');
const forceSystem = document.querySelector<HTMLInputElement>('#motion-force');
const status = document.querySelector('#motion-status');
const systemReduce = matchMedia('(prefers-reduced-motion: reduce)');
const definitions: Record<string, [string, string, string]> = {
  '--motion-enter': ['Появление', 'enter', '--motion-ease-enter'],
  '--motion-exit': ['Исчезновение', 'exit', '--motion-ease-exit'],
  '--motion-feedback': ['Отклик', 'feedback', '--motion-ease-state'],
  '--motion-focus': ['Фокус', 'focus', '--motion-ease-state'],
  '--motion-press': ['Нажатие', 'press', '--motion-ease-state'],
  '--motion-scene': ['Смена сцены', 'scene', '--motion-ease-spring'],
};
const curves: Record<string, string> = {
  '--motion-ease-enter': 'Кривая появления',
  '--motion-ease-exit': 'Кривая исчезновения',
  '--motion-ease-spring': 'Упругое движение',
  '--motion-ease-state': 'Кривая смены состояния',
};

const parsedTokens = new Map<string, string>();
for (const match of tokens.matchAll(/(--motion-[\w-]+):\s*([^;]+);/g)) {
  const [, name, value] = match;
  if (name && value) {
    // В tokens.css пружина объявлена дважды: fallback и @supports-версия.
    // Для витрины важно последнее действующее значение, а не обе записи.
    parsedTokens.set(name, value);
  }
}
const sceneDuration = getComputedStyle(document.documentElement)
  .getPropertyValue('--motion-scene')
  .trim();

for (const [name, value] of parsedTokens) {
  const definition = definitions[name];
  const curve = curves[name];
  if (!(definition || curve)) {
    continue;
  }
  const [title, kind, easing] = definition ?? [curve ?? name, 'curve', name];
  const card = document.createElement('div');
  card.className = 'motion-card';
  card.dataset.motion = kind;
  card.style.setProperty('--preview-duration', `var(${curve ? '--motion-scene' : name})`);
  card.style.setProperty('--preview-easing', `var(${easing})`);
  const heading = document.createElement('h3');
  heading.textContent = title;
  const token = document.createElement('code');
  token.textContent = name;
  const detail = document.createElement('p');
  detail.className = 'motion-detail';
  const shown = value.trim().startsWith('linear(')
    ? 'linear(25 отсчётов, 8% перелёта)'
    : value.trim();
  detail.textContent = curve ? `${shown} · ${sceneDuration}` : `${shown} · ${easing}`;
  const stage = document.createElement('div');
  stage.className = 'motion-stage';
  stage.setAttribute('aria-hidden', 'true');
  const object = document.createElement('span');
  object.className = 'motion-object';
  stage.append(object);
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'copy-button';
  play.textContent = 'Воспроизвести';
  play.setAttribute('aria-label', `Воспроизвести: ${title}`);
  play.addEventListener('click', () => replay(card));
  card.append(heading, token, detail, stage, play);
  grid?.append(card);
}

function replay(card: HTMLElement) {
  card.classList.remove('motion-playing');
  // Чтение offsetWidth синхронно пересчитывает рендер, чтобы конечная CSS-анимация
  // перезапустилась на повторном клике — без таймеров и циклов.
  synchronizeRender(card);
  card.classList.add('motion-playing');
}
/** Читает геометрию элемента и тем самым форсирует синхронный перерасчёт рендера. */
function synchronizeRender(card: HTMLElement) {
  return card.offsetWidth;
}
/** Текст состояния витрины: что именно сейчас показывают карточки. */
function motionStatus(forcedPastSystem: boolean): string {
  if (reduce?.checked) {
    return 'Движение отключено: показаны конечные состояния.';
  }
  if (systemReduce.matches) {
    return forcedPastSystem
      ? 'Система уменьшает движение, но предпросмотр включён принудительно. Разница с реальным поведением продуктов учтена.'
      : 'Система уменьшает движение: показаны конечные состояния без анимации. Включите «Вопреки системе», чтобы проверить тайминги.';
  }
  if (speed?.value === '4') {
    return 'Предпросмотр замедлен в 4 раза. Значения токенов не изменены.';
  }
  return 'Реальные тайминги. Кривые сравниваются на одинаковой дистанции и длительности.';
}

function preferences() {
  grid?.style.setProperty('--motion-speed', speed?.value ?? '1');
  // Витрина обязана показывать движение даже на машине с выключенными анимациями
  // Windows, иначе проверить тайминги негде. «Без движения» остаётся сильнее.
  const forcedPastSystem = Boolean(forceSystem?.checked) && !reduce?.checked;
  const disabled = Boolean(reduce?.checked) || (systemReduce.matches && !forcedPastSystem);
  grid?.classList.toggle('motion-reduced', disabled);
  if (grid && forcedPastSystem && systemReduce.matches) {
    grid.dataset.motionOverride = 'force';
  }
  if (grid && !(forcedPastSystem && systemReduce.matches)) {
    grid.removeAttribute('data-motion-override');
  }
  if (status) {
    status.textContent = motionStatus(forcedPastSystem);
  }
  if (disabled) {
    for (const card of document.querySelectorAll<HTMLElement>('.motion-card')) {
      replay(card);
    }
  }
}
document.querySelector('#motion-play-all')?.addEventListener('click', () => {
  for (const card of document.querySelectorAll<HTMLElement>('.motion-card')) {
    replay(card);
  }
});
speed?.addEventListener('change', preferences);
reduce?.addEventListener('change', preferences);
forceSystem?.addEventListener('change', preferences);
systemReduce.addEventListener('change', preferences);
preferences();
