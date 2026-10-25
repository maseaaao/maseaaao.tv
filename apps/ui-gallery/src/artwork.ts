interface ArtworkAsset {
  bytes: number;
  group: string;
  name: string;
  url: string;
}
declare const __ARTWORK__: ArtworkAsset[];

const groups = [
  ['logo', 'Логотипы', 'Утверждённый оригинал, аватары и варианты логотипа.'],
  ['scenes', 'Сцены', 'Горизонтальные и вертикальные сцены OBS, фоны и рамки.'],
  ['banners', 'Баннеры', 'Обложки для Twitch, YouTube и офлайн-экрана.'],
  ['twitch-description', 'Панели Twitch', 'Оформление разделов описания канала.'],
  ['wallpapers', 'Обои', 'Горизонтальные и вертикальные обои.'],
  ['brand', 'Бренд', 'Иконки, изображения сайта, превью и остальные брендовые ресурсы.'],
];
const tablist = document.querySelector<HTMLElement>('.gallery-tabs');
const panels = document.querySelector('#artwork-panels');

const dialog = document.querySelector<HTMLDialogElement>('#artwork-dialog');
const fullImage = document.querySelector<HTMLImageElement>('#artwork-full-image');
const dialogTitle = document.querySelector('#artwork-dialog-title');
const download = document.querySelector<HTMLAnchorElement>('#artwork-download');
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${number.format(bytes / 1024)} КБ`
    : `${number.format(bytes / (1024 * 1024))} МБ`;
}

for (const [id, title, description] of groups) {
  if (!(id && title && description)) {
    continue;
  }
  const assets = __ARTWORK__.filter((asset) => asset.group === id);
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.id = `tab-${id}`;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.setAttribute('aria-controls', `panel-${id}`);
  tab.tabIndex = -1;
  tab.textContent = `${title} (${assets.length})`;
  tablist?.append(tab);

  const panel = document.createElement('section');
  panel.id = `panel-${id}`;
  panel.className = 'artwork-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', tab.id);
  const heading = document.createElement('h2');
  heading.textContent = title;
  const note = document.createElement('p');
  note.className = 'description';
  note.textContent = `${description} Нажмите на изображение, чтобы открыть целиком или скачать оригинал.`;
  panel.append(heading, note);
  if (!assets.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      'Готовых изображений пока нет. Выполните bun run render:all в согласованной Linux-среде, затем перезапустите или пересоберите галерею.';
    panel.append(empty);
  }
  const grid = document.createElement('div');
  grid.className = 'artwork-grid';
  for (const asset of assets) {
    const card = document.createElement('figure');
    card.className = 'artwork-card';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'artwork-preview';
    open.setAttribute('aria-label', `Открыть ${asset.name}`);
    const image = document.createElement('img');
    image.alt = asset.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    const caption = document.createElement('figcaption');
    const name = document.createElement('code');
    name.textContent = asset.name;
    const meta = document.createElement('span');
    meta.textContent = size(asset.bytes);
    image.addEventListener('load', () => {
      meta.textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${size(asset.bytes)}`;
    });
    image.addEventListener('error', () => {
      meta.textContent = `Не удалось загрузить изображение · ${size(asset.bytes)}`;
    });
    image.src = asset.url;
    open.append(image);
    open.addEventListener('click', () => {
      if (!(dialog && fullImage && dialogTitle && download)) {
        return;
      }
      dialogTitle.textContent = asset.name;
      fullImage.src = asset.url;
      fullImage.alt = asset.name;
      download.href = asset.url;
      download.download = asset.name.split('/').pop() ?? '';
      dialog.showModal();
    });
    caption.append(name, meta);
    card.append(open, caption);
    grid.append(card);
  }
  panel.append(grid);
  panels?.append(panel);
}

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.gallery-tabs [role="tab"]')];
function selectTab(tab: HTMLButtonElement) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls') ?? '');
    if (panel) {
      panel.hidden = !selected;
    }
  }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const target = tabs[next];
    if (target) {
      selectTab(target);
      target.focus();
    }
  });
}
document.querySelector('#close-artwork')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', (event) => {
  if (event.target !== dialog) {
    return;
  }
  const box = dialog.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  ) {
    dialog.close();
  }
});
dialog?.addEventListener('close', () => fullImage?.removeAttribute('src'));
