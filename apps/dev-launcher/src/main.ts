const HASH_PREFIX_RE = /^#/;

export {};

interface ProjectPage {
  height: number | null;
  label: string;
  url: string;
  width: number | null;
}
interface CanvasSize {
  height: number;
  width: number;
}
type ZoomMode = 'fit' | 'width' | 'free';
interface ProjectInfo {
  hint: string | null;
  id: string;
  label: string;
  pages: ProjectPage[];
  url: string | null;
}
interface ProjectsDocument {
  projects: ProjectInfo[];
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Не найден элемент #${id}`);
  }
  return element as T;
}

const items: HTMLUListElement = requireElement('items');
const hintElement: HTMLParagraphElement = requireElement('hint');
const openLink: HTMLAnchorElement = requireElement('open');
const frame: HTMLIFrameElement = requireElement('frame');
const frameWrap: HTMLDivElement = requireElement('frame-wrap');
const stage: HTMLDivElement = requireElement('stage');
const zoomControls: HTMLDivElement = requireElement('zoom');
const zoomRange: HTMLInputElement = requireElement('zoom-range');
const zoomValue: HTMLOutputElement = requireElement('zoom-value');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');

// Новый документ мягко проявляется; старый остаётся видимым до загрузки,
// поэтому навигация не показывает пустой белый кадр.
frame.addEventListener('load', () => {
  if (motionPreference.matches || typeof frame.animate !== 'function') {
    return;
  }
  frame.animate([{ opacity: 0.65 }, { opacity: 1 }], {
    duration: 167,
    easing: 'cubic-bezier(0, 0, 0, 1)',
  });
});

let projects: ProjectInfo[] = [];
let currentId: string | null = null;
let currentUrl: string | null = null;
let currentSize: CanvasSize | null = null;
let zoomMode: ZoomMode = 'fit';
let freeScale = 1;

const readHashId = () => {
  const raw = decodeURIComponent(location.hash.replace(HASH_PREFIX_RE, ''));
  return raw === '' ? null : raw;
};

const clampScale = (scale: number) => Math.min(4, Math.max(0.05, scale));

const syncZoom = () => {
  if (currentSize === null) {
    zoomControls.hidden = true;
    stage.style.cssText = '';
    frame.style.cssText = '';
    return;
  }
  zoomControls.hidden = false;
  // clientWidth/Height не учитывают скроллбары: «вписать» не переполняет
  // область и не вызывает появление полос уже после вычисления масштаба.
  const box = frameWrap;
  let scale = freeScale;
  if (zoomMode === 'fit') {
    scale = Math.min(box.clientWidth / currentSize.width, box.clientHeight / currentSize.height);
  } else if (zoomMode === 'width') {
    scale = box.clientWidth / currentSize.width;
  }
  const applied = clampScale(scale);
  // Целые размеры не дают субпиксельного переполнения и «дрожания» полос.
  stage.style.width = `${Math.floor(currentSize.width * applied)}px`;
  stage.style.height = `${Math.floor(currentSize.height * applied)}px`;
  frame.style.width = `${currentSize.width}px`;
  frame.style.height = `${currentSize.height}px`;
  frame.style.transform = `scale(${applied})`;
  frame.style.transformOrigin = '0 0';
  zoomValue.textContent = `${Math.round(applied * 100)}%`;
  zoomRange.value = String(Math.round(Math.min(200, Math.max(25, applied * 100))));
};

const selectProject = (project: ProjectInfo) => {
  currentId = project.id;
  location.hash = `#${project.id}`;
};

const syncActive = () => {
  let current: HTMLButtonElement | null = null;
  for (const button of items.querySelectorAll<HTMLButtonElement>('button[data-project]')) {
    const page = button.dataset.url;
    const active =
      button.dataset.project === currentId && (page === undefined || page === currentUrl);
    button.classList.toggle('active', active);
    if (active && page !== undefined) {
      button.setAttribute('aria-current', 'page');
      current = button;
    } else {
      button.removeAttribute('aria-current');
    }
  }
  // Держим текущую страницу в поле зрения длинного списка сцен.
  current?.scrollIntoView({ block: 'nearest' });
};

const openUrl = (url: string, size: CanvasSize | null = null) => {
  currentUrl = url;
  currentSize = size;
  zoomMode = 'fit';
  freeScale = 1;
  frame.src = url;
  openLink.href = url;
  openLink.hidden = false;
  syncActive();
  syncZoom();
};

const pageCanvas = (page: ProjectPage): CanvasSize | null =>
  page.width === null || page.height === null ? null : { height: page.height, width: page.width };

const openPage = (page: ProjectPage) => {
  openUrl(page.url, pageCanvas(page));
};

const openDefaultPage = (project: ProjectInfo) => {
  if (project.url) {
    openUrl(project.url);
    return;
  }
  const [page] = project.pages;
  if (page) {
    openPage(page);
    return;
  }
  currentUrl = null;
  currentSize = null;
  frame.src = 'about:blank';
  openLink.hidden = true;
  syncActive();
  syncZoom();
};

const buildMenu = () => {
  const list = document.createDocumentFragment();
  for (const project of projects) {
    const item = document.createElement('li');
    item.className = 'item';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = project.label;
    button.dataset.project = project.id;
    if (project.url) {
      const { url } = project;
      button.dataset.url = url;
      button.addEventListener('click', () => {
        selectProject(project);
        openUrl(url);
      });
    } else if (project.pages.length) {
      button.addEventListener('click', () => {
        selectProject(project);
        openDefaultPage(project);
      });
    } else {
      button.disabled = true;
      if (project.hint) {
        button.title = project.hint;
      }
    }
    item.append(button);
    if (project.pages.length) {
      const subitems = document.createElement('ul');
      subitems.className = 'subitems';
      for (const page of project.pages) {
        const subitem = document.createElement('li');
        const pageButton = document.createElement('button');
        pageButton.type = 'button';
        pageButton.dataset.project = project.id;
        pageButton.dataset.url = page.url;
        pageButton.textContent = page.label;
        pageButton.addEventListener('click', () => {
          selectProject(project);
          openPage(page);
        });
        subitem.append(pageButton);
        subitems.append(subitem);
      }
      item.append(subitems);
    }
    list.append(item);
  }
  items.replaceChildren(list);
};

const refreshProjects = async () => {
  const response = await fetch('/projects.json');
  if (!response.ok) {
    return;
  }
  const document_: ProjectsDocument = await response.json();
  ({ projects } = document_);
  buildMenu();
  const project = projects.find((entry) => entry.id === currentId);
  const page = project?.pages.find((entry) => entry.url === currentUrl);
  if (project && page) {
    currentSize = pageCanvas(page);
    syncZoom();
  } else if (project && project.url !== currentUrl) {
    openDefaultPage(project);
  }
  // buildMenu пересоздаёт кнопки, поэтому подсветку восстанавливаем всегда.
  syncActive();
};

import.meta.hot?.on('projects-changed', refreshProjects);
await refreshProjects();

const requested = readHashId();
const requestedId =
  requested && projects.some((entry) => entry.id === requested) ? requested : null;
const initialId =
  requestedId ?? projects.find((entry) => entry.url || entry.pages.length)?.id ?? null;
const initial = initialId === null ? null : projects.find((entry) => entry.id === initialId);
if (initial) {
  currentId = initial.id;
  location.hash = `#${initial.id}`;
  openDefaultPage(initial);
} else {
  hintElement.hidden = false;
  hintElement.textContent = 'Проекты не переданы. Запустите `bun run dev` в корне репозитория.';
}

for (const button of zoomControls.querySelectorAll<HTMLButtonElement>('button[data-zoom]')) {
  button.addEventListener('click', () => {
    const mode = button.getAttribute('data-zoom');
    if (mode === 'fit' || mode === 'width') {
      zoomMode = mode;
    } else {
      zoomMode = 'free';
      freeScale = 1;
    }
    syncZoom();
  });
}

zoomRange.addEventListener('input', () => {
  zoomMode = 'free';
  freeScale = Number(zoomRange.value) / 100;
  syncZoom();
});

window.addEventListener('resize', () => {
  if (currentSize !== null && zoomMode !== 'free') {
    syncZoom();
  }
});

window.addEventListener('hashchange', () => {
  const id = readHashId();
  if (id === null || id === currentId) {
    return;
  }
  const project = projects.find((entry) => entry.id === id);
  if (!project) {
    return;
  }
  currentId = id;
  openDefaultPage(project);
});
