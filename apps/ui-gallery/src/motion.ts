import tokens from '@maseaaao/design/tokens.css?raw';

const grid = document.querySelector<HTMLElement>('#motion-grid');
const speed = document.querySelector<HTMLSelectElement>('#motion-speed');
const reduce = document.querySelector<HTMLInputElement>('#motion-reduce');
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

for (const match of tokens.matchAll(/(--motion-[\w-]+):\s*([^;]+);/g)) {
  const [, name, value] = match;
  if (!(name && value)) {
    continue;
  }
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
  detail.textContent = curve
    ? `${value.trim()} · длительность var(--motion-scene)`
    : `${value.trim()} · ${easing}`;
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
function preferences() {
  grid?.style.setProperty('--motion-speed', speed?.value ?? '1');
  const disabled = systemReduce.matches || Boolean(reduce?.checked);
  grid?.classList.toggle('motion-reduced', disabled);
  if (status) {
    let message: string;
    if (systemReduce.matches) {
      message = 'Система уменьшает движение: показаны конечные состояния без анимации.';
    } else if (disabled) {
      message = 'Движение отключено: показаны конечные состояния.';
    } else if (speed?.value === '4') {
      message = 'Предпросмотр замедлен в 4 раза. Значения токенов не изменены.';
    } else {
      message = 'Реальные тайминги. Кривые сравниваются на одинаковой дистанции и длительности.';
    }
    status.textContent = message;
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
systemReduce.addEventListener('change', preferences);
preferences();
