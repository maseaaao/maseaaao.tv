type Platform = 'youtube' | 'twitch';
const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const IS_TV_MODE = SEARCH_PARAMS.get('tv') === '1';

if (IS_TV_MODE) {
  document.body.classList.add('is-tv-mode');
}

const STREAMS = {
  twitch: {
    allow: 'autoplay; fullscreen',
    get src() {
      const parent = window.location.hostname;

      if (!parent) {
        throw new Error('Twitch iframe requires a real hostname.');
      }

      const params = new URLSearchParams({
        autoplay: 'true',
        channel: 'maseaaao',
        muted: 'true',
        parent,
      });

      return `https://player.twitch.tv/?${params.toString()}`;
    },
    title: 'Twitch live',
  },
  youtube: {
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    get src() {
      const params = new URLSearchParams({
        autoplay: '1',
        channel: 'UCyJNPWpOcPfMo5csKa27yGg',
        mute: IS_TV_MODE ? '0' : '1',
      });

      return `https://www.youtube.com/embed/live_stream?${params.toString()}`;
    },
    title: 'YouTube live',
  },
};

function getElements(platform: Platform) {
  const card = document.querySelector<HTMLElement>(`[data-platform="${platform}"]`) as HTMLElement;

  return {
    card,
    slot: card.querySelector<HTMLElement>('[data-slot]') as HTMLElement,
    status: card.querySelector<HTMLElement>('[data-status]') as HTMLElement,
  };
}

function setPlaceholder(slot: Element, platform: Platform) {
  const label = {
    twitch: 'Twitch-плеер не загружен',
    youtube: 'YouTube-плеер не загружен',
  }[platform];

  slot.replaceChildren(
    Object.assign(document.createElement('div'), {
      className: 'placeholder',
      textContent: label,
    }),
  );
}

function setError(slot: Element, status: Element, message: string) {
  slot.replaceChildren(
    Object.assign(document.createElement('div'), {
      className: 'placeholder',
      textContent: message,
    }),
  );

  status.textContent = 'ошибка';
}

function addPlayer(platform: Platform) {
  const config = STREAMS[platform];
  const { slot, status } = getElements(platform);

  if (slot.querySelector('iframe')) {
    status.textContent = 'iframe уже создан';
    return;
  }

  try {
    const iframe = document.createElement('iframe');

    iframe.title = config.title;
    iframe.src = config.src;
    iframe.allow = config.allow;
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';

    slot.replaceChildren(iframe);
    status.textContent = 'iframe создан';
  } catch (error) {
    setError(slot, status, error instanceof Error ? error.message : 'Не удалось создать iframe');
  }
}

function removePlayer(platform: Platform) {
  const { slot, status } = getElements(platform);

  slot.replaceChildren();
  setPlaceholder(slot, platform);
  status.textContent = 'iframe не создан';
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');

  if (!button) {
    return;
  }

  const { action } = button.dataset;
  const card = button.closest<HTMLElement>('[data-platform]');
  const platforms = Object.keys(STREAMS) as Platform[];

  if (action === 'add-all') {
    platforms.forEach(addPlayer);
    return;
  }

  if (action === 'remove-all') {
    platforms.forEach(removePlayer);
    return;
  }

  if (!card) {
    return;
  }

  const platform = card.dataset.platform as Platform;

  if (action === 'add') {
    addPlayer(platform);
  }

  if (action === 'remove') {
    removePlayer(platform);
  }
});

if (IS_TV_MODE) {
  (Object.keys(STREAMS) as Platform[]).forEach(addPlayer);
}
