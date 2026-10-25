import tokens from '@maseaaao/design/tokens.css?raw';
import './artwork';
import './motion';

const imports = `@import '@maseaaao/design/brand.css';
@import '@maseaaao/ui/components.css';
@import '@maseaaao/ui/accessibility.css';`;

const colors = document.querySelector('#colors');
const metrics = document.querySelector('#metrics');
const radii = document.querySelector('#radii');
const computed = getComputedStyle(document.documentElement);
for (const match of tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
  const [, name, value] = match;
  if (!(name && value)) {
    continue;
  }
  if (name.startsWith('--color-')) {
    const card = document.createElement('div');
    card.className = 'swatch';
    const swatch = document.createElement('div');
    swatch.className = 'swatch-color';
    swatch.style.background = `var(${name})`;
    const info = document.createElement('div');
    info.className = 'swatch-info';
    const code = document.createElement('code');
    code.textContent = name;
    const label = document.createElement('span');
    label.textContent = computed.getPropertyValue(name).trim();
    info.append(code, label);
    card.append(swatch, info);
    colors?.append(card);
  } else if (name.startsWith('--radius-')) {
    const card = document.createElement('div');
    card.className = 'radius-card';
    const reference = document.createElement('div');
    reference.className = 'radius-reference';
    reference.setAttribute('aria-hidden', 'true');
    const shape = document.createElement('div');
    shape.className = 'radius-shape';
    shape.style.borderRadius = `var(${name})`;
    reference.append(shape);
    const code = document.createElement('code');
    code.textContent = name;
    const label = document.createElement('span');
    card.append(reference, code, label);
    radii?.append(card);
    label.textContent = `${value.trim()} · ${getComputedStyle(shape).borderTopLeftRadius}`;
  } else if (!(name.startsWith('--font-') || name.startsWith('--motion-'))) {
    const row = document.createElement('div');
    row.className = 'token-row';
    const code = document.createElement('code');
    code.textContent = name;
    const label = document.createElement('span');
    label.textContent = value.trim();
    row.append(code, label);
    if (name.startsWith('--space-') || name === '--control-height') {
      const bar = document.createElement('i');
      bar.className = 'token-bar';
      bar.style.width = `var(${name})`;
      bar.setAttribute('aria-hidden', 'true');
      row.append(bar);
    }
    metrics?.append(row);
  }
}

const examples = [...document.querySelectorAll<HTMLElement>('[data-example]')];
const status = document.querySelector('#copy-status');
let statusTimer: ReturnType<typeof setTimeout>;
function announce(message: string) {
  if (!status) {
    return;
  }
  clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = setTimeout(() => {
    status.textContent = '';
  }, 5000);
}

for (const example of examples) {
  const preview = example.querySelector('.example-preview');
  if (!preview) {
    continue;
  }
  const markup = [...preview.children].map((element) => element.outerHTML).join('\n\n');
  const background =
    example.id === 'inverted' ? '\n\n/* Фон контейнера: background: var(--color-brand); */' : '';
  const source = `/* CSS */\n${imports}${background}\n\n<!-- HTML -->\n${markup}`;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Разметка и подключение';
  const toolbar = document.createElement('div');
  toolbar.className = 'source-toolbar';
  const label = document.createElement('span');
  label.textContent = 'CSS + HTML · без стилей раскладки витрины';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.textContent = 'Копировать';
  button.setAttribute('aria-label', `Копировать: ${example.querySelector('h2')?.textContent}`);
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source);
      announce('Разметка скопирована');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      announce('Выделите и скопируйте разметку вручную: буфер обмена недоступен.');
    }
  });
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  toolbar.append(label, button);
  details.append(summary, toolbar, pre);
  example.append(details);
}

const search = document.querySelector<HTMLInputElement>('#search');
const count = document.querySelector('#result-count');
const empty = document.querySelector<HTMLElement>('#empty');
const index = examples.map((element) => ({
  element,
  text: `${element.textContent} ${element.querySelector('.example-preview')?.innerHTML ?? ''}`.toLocaleLowerCase(
    'ru',
  ),
}));
function filter() {
  const query = search?.value.trim().toLocaleLowerCase('ru') ?? '';
  let visible = 0;
  for (const { element, text } of index) {
    element.hidden = !text.includes(query);
    if (!element.hidden) {
      visible += 1;
    }
  }
  if (count) {
    count.textContent = `Разделы: ${visible} / ${examples.length}`;
  }
  if (empty) {
    empty.hidden = visible !== 0;
  }
}
search?.addEventListener('input', filter);
// Navigation also works while search results are narrowed down.
for (const link of document.querySelectorAll<HTMLAnchorElement>('.section-nav a')) {
  link.addEventListener('click', () => {
    if (search) {
      search.value = '';
    }
    filter();
  });
}
filter();
