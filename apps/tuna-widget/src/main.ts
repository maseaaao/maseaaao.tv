interface LayerStyle {
  filter: string;
  opacity: string;
  transform: string;
}
interface Track {
  album: string;
  artist: string;
  artwork: string;
  id: string;
  playing: boolean;
  title: string;
}
interface ArtworkResource {
  objectUrl: string;
  src: string;
}
interface TextSwap {
  finish: () => void;
  latest: Track;
}

(() => {
  const query = new URLSearchParams(location.search);
  const demo = query.get('demo') === '1';
  const debug = query.get('debug') === '1';
  const trace = (event: string, error: unknown) => {
    if (debug) {
      console.debug('[tuna-widget]', event, error instanceof Error ? error.message : String(error));
    }
  };

  const num = (
    name: string,
    fallback: number,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
  ) => {
    const raw = query.get(name);

    if (raw === null || raw.trim() === '') {
      return fallback;
    }

    const value = Number(raw);

    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, value));
  };

  /*
   * URL params
   *
   * poll     polling interval, ms
   * start    full-opacity duration on first appearance, ms
   * show     full-opacity duration on track change, ms
   * anim     fade duration, ms
   * idle     opacity after show, 0 = fully hidden
   * opaque   1 = opaque reveal/conceal for overlapping OBS widgets
   * reveal   soft = layered material/content appearance (requires opaque=1)
   * motion   1 = explicitly enable OBS overlay motion despite the desktop preference
   * art      delay before loading a new cover, ms
   * swap     cover crossfade duration, ms
   * retry    delay between cover retries, ms
   * tries    maximum cover load attempts
   * timeout  request/image timeout, ms
   * fail     failed polls before hiding
   * img      cover scale
   * ui       overall UI scale
   * port     Tuna webserver port
   */
  const cfg = {
    anim: num('anim', 1000, 0, 60_000),

    art: num('art', 700, 0, 10_000),
    fail: Math.round(num('fail', 3, 1, 20)),

    idle: num('idle', 0, 0, 1),

    img: num('img', 1, 0.5, 1.5),
    opaque: query.get('opaque') === '1',
    poll: num('poll', 1000, 100, 60_000),

    port: Math.round(num('port', 1608, 1, 65_535)),
    retry: num('retry', 900, 100, 10_000),
    show: num('show', 7000, 0, 600_000),
    softReveal: query.get('opaque') === '1' && query.get('reveal') === 'soft',

    start: num('start', 7000, 0, 600_000),
    swap: num('swap', 420, 0, 5000),

    timeout: num('timeout', 4000, 500, 30_000),
    tries: Math.round(num('tries', 3, 1, 8)),
    ui: num('ui', 1, 0.25, 3),
  } as Record<
    | 'poll'
    | 'start'
    | 'show'
    | 'anim'
    | 'idle'
    | 'art'
    | 'swap'
    | 'retry'
    | 'tries'
    | 'timeout'
    | 'fail'
    | 'img'
    | 'ui'
    | 'port',
    number
  > & { url: string; opaque: boolean; softReveal: boolean };

  cfg.url = `http://localhost:${cfg.port}/`;

  const el = {
    content: document.querySelector('#content') as HTMLElement,
    coverFrame: document.querySelector('#cover-frame') as HTMLElement,
    covers: [
      document.querySelector('#cover-a') as HTMLImageElement,
      document.querySelector('#cover-b') as HTMLImageElement,
    ] as const,
    // The authored frame owns exactly two image slots.
    glows: [...document.querySelectorAll<HTMLImageElement>('.artwork-glow')] as [
      HTMLImageElement,
      HTMLImageElement,
    ],
    player: document.querySelector('#player') as HTMLElement,
    root: document.documentElement,
    subtitle: document.querySelector('#subtitle') as HTMLElement,
    surface: document.querySelector('#surface') as HTMLElement,
    title: document.querySelector('#title') as HTMLElement,
    trackText: document.querySelector('#track-text') as HTMLElement,
  };

  const state: {
    artworkChangedAt: number;
    artworkObjectUrls: [string, string];
    artworkRetryAt: number;
    artworkSignature: string;
    artworkSlot: -1 | 0 | 1;
    artworkSource: string;
    artworkStatus: 'empty' | 'failed' | 'idle' | 'loading' | 'ready';
    artworkSwapUntil: number;
    artworkToken: number;
    artworkTrackKey: string;
    errorCount: number;
    fadeAnimation: Animation | null;
    firstPoll: boolean;
    idleTimer: number;
    lastAppliedArtworkSource: string;
    playing: boolean;
    presenceAnimations: Animation[];
    previousArtworkSource: string;
    textSwap: TextSwap | null;
    trackKey: string;
  } = {
    artworkChangedAt: 0,
    artworkObjectUrls: ['', ''],
    artworkRetryAt: 0,
    artworkSignature: '',
    artworkSlot: -1,
    artworkSource: '',
    artworkStatus: 'idle',
    artworkSwapUntil: 0,
    artworkToken: 0,
    artworkTrackKey: '',
    errorCount: 0,
    fadeAnimation: null,
    firstPoll: true,
    idleTimer: 0,
    lastAppliedArtworkSource: '',
    playing: false,
    presenceAnimations: [],
    previousArtworkSource: '',
    textSwap: null,
    trackKey: '',
  };

  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const configuredMotion = { anim: cfg.anim, swap: cfg.swap };
  const updateMotion = () => {
    const reduced = query.get('motion') !== '1' && motionPreference.matches;
    cfg.anim = reduced ? 0 : configuredMotion.anim;
    cfg.swap = reduced ? 0 : configuredMotion.swap;
    el.root.style.setProperty('--art-swap', `${cfg.swap}ms`);
    if (!reduced) {
      return;
    }
    // End at the already committed target, never replay a reveal or reset its timer.
    state.fadeAnimation?.cancel();
    state.fadeAnimation = null;
    for (const animation of state.presenceAnimations) {
      animation.cancel();
    }
    state.presenceAnimations = [];
    state.textSwap?.finish();
  };
  updateMotion();
  motionPreference.addEventListener('change', updateMotion);
  if (cfg.opaque) {
    el.root.dataset.opaque = '1';
  }
  if (cfg.softReveal) {
    el.root.dataset.reveal = 'soft';
  }

  const sleep = (duration: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, duration);
    });

  /** Чтение геометрии синхронно форсирует перерасчёт рендера браузера. */
  const synchronizeRender = (element: HTMLElement) => element.offsetWidth;

  const clearIdle = () => {
    if (!state.idleTimer) {
      return;
    }

    clearTimeout(state.idleTimer);
    state.idleTimer = 0;
  };

  // Sample a gently underdamped response once; no continuous JS frame loop.
  // Opacity and focus resolve separately, before the spatial settling finishes.
  const springTransforms = (from: string, to: string) => {
    const a = new DOMMatrixReadOnly(from);
    const b = new DOMMatrixReadOnly(to);
    const fields = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
    const response = (t: number) =>
      1 - Math.exp(-8 * t) * (Math.cos(10 * t) + 0.8 * Math.sin(10 * t));
    const end = response(1);
    return Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      const progress = response(t) / end;
      const values = fields.map((key) => a[key] + (b[key] - a[key]) * progress);
      return { offset: t, transform: `matrix(${values.join(',')})` };
    });
  };

  const presenceProperty = (
    node: HTMLElement,
    property: 'transform' | 'opacity' | 'filter',
    from: string,
    to: string,
    duration: number,
    delay = 0,
  ) => {
    node.style[property] = to;
    const resolved = getComputedStyle(node)[property];
    if (duration === 0 || from === resolved) {
      return;
    }
    const transforms = property === 'transform';
    const frames = transforms
      ? springTransforms(from, resolved)
      : [{ [property]: from }, { [property]: resolved }];
    const animation = node.animate(frames, {
      delay,
      duration,
      easing: transforms ? 'linear' : 'ease-out',
      fill: 'both',
    });
    state.presenceAnimations.push(animation);
    animation.finished
      .then(() => {
        if (!state.presenceAnimations.includes(animation)) {
          return;
        }
        animation.cancel();
        state.presenceAnimations = state.presenceAnimations.filter((item) => item !== animation);
      })
      .catch(() => {
        /* Отмена не ошибка: анимация заменена более свежей. */
      });
  };

  const presenceMotions = (
    target: number,
    duration: number,
    current: [LayerStyle, LayerStyle, LayerStyle, LayerStyle],
  ): Parameters<typeof presenceProperty>[] => {
    const visible = target > 0;
    let playerTransform = 'translateY(0%)';
    let surfaceOpacity = '1';
    let surfaceTransform = 'translateY(0) scale(1)';
    let surfaceOpacityDuration = duration * 0.2;
    let backdropDelay = 0;
    let backdropDuration = duration;
    let contentDelay = 0;
    let layerTransform = 'translateY(0) scale(1)';
    let layerBlur = 'blur(0px)';
    let layerOpacity = '1';
    let layerOpacityDuration = duration * 0.28;
    let layerTransformDuration = duration;
    if (visible) {
      playerTransform = `translateY(${(1 - target) * 100}%)`;
      if (Number(current[1].opacity) < 0.999) {
        contentDelay = duration * 0.24;
      }
      layerTransformDuration = duration - contentDelay;
    } else {
      surfaceOpacity = '0';
      surfaceTransform = 'translateY(8px) scale(0.97, 0.9)';
      surfaceOpacityDuration = duration * 0.76;
      backdropDelay = duration * 0.24;
      backdropDuration = duration * 0.76;
      layerTransform = 'translateY(6px) scale(0.985)';
      layerBlur = 'blur(3px)';
      layerOpacity = '0';
      layerOpacityDuration = duration * 0.2;
      layerTransformDuration = duration * 0.24;
    }
    const motions: Parameters<typeof presenceProperty>[] = [
      [el.player, 'transform', current[0].transform, playerTransform, duration],
      [
        el.surface,
        'transform',
        current[1].transform,
        surfaceTransform,
        backdropDuration,
        backdropDelay,
      ],
      [
        el.surface,
        'opacity',
        current[1].opacity,
        surfaceOpacity,
        surfaceOpacityDuration,
        backdropDelay,
      ],
    ];
    const layers = [el.coverFrame, el.content];
    for (const [layerIndex, node] of layers.entries()) {
      const index = (layerIndex + 2) as 0 | 1 | 2 | 3;
      const style = current[index];
      motions.push(
        [node, 'filter', style.filter, layerBlur, Math.min(duration * 0.28, 120), contentDelay],
        [node, 'transform', style.transform, layerTransform, layerTransformDuration, contentDelay],
        [node, 'opacity', style.opacity, layerOpacity, layerOpacityDuration, contentDelay],
      );
    }
    return motions;
  };

  const softPresence = (target: number, duration: number) => {
    const layers = [el.player, el.surface, el.coverFrame, el.content];
    // Capture the presented pose before cancelling, so a new track or pause can
    // reverse an unfinished transition without snapping back to an endpoint.
    const current = layers.map((node) => {
      const style = getComputedStyle(node);
      return { filter: style.filter, opacity: style.opacity, transform: style.transform };
    }) as [LayerStyle, LayerStyle, LayerStyle, LayerStyle];
    for (const animation of state.presenceAnimations) {
      animation.cancel();
    }
    state.presenceAnimations = [];
    for (const [node, property, from, to, motionDuration, delay] of presenceMotions(
      target,
      duration,
      current,
    )) {
      presenceProperty(node, property, from, to, motionDuration, delay);
    }
  };

  const fade = (opacity: number, duration = cfg.anim) => {
    const target = Math.min(1, Math.max(0, opacity));
    if (cfg.softReveal) {
      softPresence(target, duration);
      return;
    }
    const style = getComputedStyle(el.player);
    const current = Number.parseFloat(style.opacity);
    const currentTransform = style.transform;

    if (state.fadeAnimation) {
      state.fadeAnimation.cancel();
      state.fadeAnimation = null;
    }

    // The optional shared-slot mode never blends music text with the widget
    // underneath. Its idle value controls the revealed fraction instead.
    if (cfg.opaque) {
      const transform = `translateY(${(1 - target) * 100}%)`;
      el.player.style.opacity = '1';
      el.player.style.transform = transform;
      const targetTransform = getComputedStyle(el.player).transform;
      if (duration === 0 || currentTransform === targetTransform) {
        return;
      }
      const animation = el.player.animate(
        [{ transform: currentTransform }, { transform: targetTransform }],
        {
          duration,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'both',
        },
      );
      state.fadeAnimation = animation;
      animation.finished
        .then(() => {
          if (state.fadeAnimation !== animation) {
            return;
          }
          animation.cancel();
          state.fadeAnimation = null;
        })
        .catch(() => {
          /* Отмена не ошибка: анимация заменена более свежей. */
        });
      return;
    }

    el.player.style.opacity = String(target);

    if (duration === 0 || !Number.isFinite(current) || Math.abs(current - target) < 0.001) {
      return;
    }

    const animation = el.player.animate([{ opacity: current }, { opacity: target }], {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });

    state.fadeAnimation = animation;

    animation.finished
      .then(() => {
        if (state.fadeAnimation !== animation) {
          return;
        }

        animation.cancel();
        state.fadeAnimation = null;
      })
      .catch(() => {
        /* Отмена не ошибка: анимация заменена более свежей. */
      });
  };

  const scheduleIdle = (delay: number) => {
    clearIdle();

    state.idleTimer = setTimeout(() => {
      state.idleTimer = 0;

      if (!state.playing) {
        return;
      }

      fade(cfg.idle);
    }, delay);
  };

  const highlight = (duration = cfg.show) => {
    clearIdle();
    fade(1);
    scheduleIdle(cfg.anim + duration);
  };

  const hide = () => {
    clearIdle();
    fade(0);
  };

  const setPlaying = (playing: boolean) => {
    state.playing = playing;
    el.player.dataset.play = playing ? '1' : '0';
  };

  const stop = () => {
    if (!state.playing) {
      return;
    }

    setPlaying(false);
    state.textSwap?.finish();
    hide();
  };

  const normalize = (value: unknown) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return item.trim();
          }

          if (item !== null && typeof item === 'object' && typeof item.name === 'string') {
            return item.name.trim();
          }

          return '';
        })
        .filter(Boolean)
        .join(', ');
    }

    return typeof value === 'string' ? value.trim() : '';
  };

  const explicitPlaying = (value: unknown): boolean | null => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 1 || value === 0) {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();

      if (normalized === '1' || normalized === 'true') {
        return true;
      }

      if (normalized === '0' || normalized === 'false') {
        return false;
      }
    }

    return null;
  };

  const readPlaying = (raw: Record<string, unknown>, title: string) => {
    for (const value of [raw.playing, raw.is_playing, raw.isPlaying]) {
      const resolved = explicitPlaying(value);

      if (resolved !== null) {
        return resolved;
      }
    }

    const status = normalize(
      raw.status ?? raw.playback_status ?? raw.playbackStatus ?? raw.state,
    ).toLowerCase();

    if (['playing', 'play'].includes(status)) {
      return true;
    }

    if (['paused', 'pause', 'stopped', 'stop', 'idle'].includes(status)) {
      return false;
    }

    return title.length > 0;
  };

  const parse = (raw: Record<string, unknown>) => {
    const title = normalize(raw.title ?? raw.song ?? raw.track ?? raw.name);

    return {
      album: normalize(raw.album),
      artist: normalize(raw.artists ?? raw.artist ?? raw.album_artist ?? raw.albumArtist),
      artwork: normalize(
        raw.cover_url ??
          raw.coverUrl ??
          raw.cover ??
          raw.artwork_url ??
          raw.artworkUrl ??
          raw.artwork,
      ),
      id: normalize(raw.track_id ?? raw.trackId ?? raw.media_id ?? raw.mediaId ?? raw.id),
      playing: readPlaying(raw, title),
      title,
    };
  };

  const trackKey = (track: Track) => [track.id, track.title, track.artist].join('\0');

  const setText = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) {
      element.textContent = value;
    }
  };

  const renderText = (track: Track) => {
    const title = track.title || 'Без названия';
    const subtitle = track.artist || track.album || '';
    if (state.textSwap) {
      // Coalesce rapid changes to the latest metadata. At most two text layers
      // exist, and a running transition finishes without a positional jump.
      state.textSwap.latest = track;
      return;
    }
    if (el.title.textContent === title && el.subtitle.textContent === subtitle) {
      return;
    }

    const animate =
      cfg.softReveal &&
      cfg.anim > 0 &&
      state.playing &&
      Number(getComputedStyle(el.content).opacity) > 0.999;
    const outgoing = animate ? (el.trackText.cloneNode(true) as HTMLElement) : null;

    setText(el.title, title);
    setText(el.subtitle, subtitle);
    el.subtitle.hidden = !el.subtitle.textContent;
    if (!outgoing) {
      return;
    }

    outgoing.removeAttribute('id');
    for (const node of outgoing.querySelectorAll('[id]')) {
      node.removeAttribute('id');
    }
    outgoing.setAttribute('aria-hidden', 'true');
    el.content.prepend(outgoing);
    const duration = Math.min(cfg.anim, 280);
    const shift = Math.min(12, el.coverFrame.clientHeight * 0.07);
    const options: KeyframeAnimationOptions = {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    };
    const animations = [
      outgoing.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: `translateY(${-shift}px)` },
        ],
        options,
      ),
      el.trackText.animate(
        [
          { opacity: 0, transform: `translateY(${shift}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        options,
      ),
    ];
    animations.push(
      outgoing.animate([{ filter: 'blur(0px)' }, { filter: 'blur(2px)' }], {
        duration: Math.min(duration, 90),
        fill: 'both',
      }),
      el.trackText.animate([{ filter: 'blur(3px)' }, { filter: 'blur(0px)' }], {
        duration: Math.min(duration, 120),
        fill: 'both',
      }),
    );
    const swap = {
      finish: () => {
        if (state.textSwap !== swap) {
          return;
        }
        for (const animation of animations) {
          animation.cancel();
        }
        outgoing.remove();
        state.textSwap = null;
        renderText(swap.latest);
      },
      latest: track,
    };
    state.textSwap = swap;
    Promise.all(animations.map((animation) => animation.finished))
      .then(swap.finish)
      .catch(() => {
        /* Отмена не ошибка: swap перезапущен более свежим изменением. */
      });
  };

  const releaseSlotLater = (slot: number) => {
    setTimeout(() => {
      const cover = el.covers[slot as 0 | 1];

      if (cover.classList.contains('is-active')) {
        return;
      }

      cover.removeAttribute('src');
      cover.classList.remove('is-outgoing');
      el.glows[slot as 0 | 1].removeAttribute('src');

      const objectUrl = state.artworkObjectUrls[slot];

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        state.artworkObjectUrls[slot] = '';
      }
    }, cfg.swap + 80);
  };

  const deactivateArtwork = () => {
    for (let slot = 0; slot < el.covers.length; slot += 1) {
      el.covers[slot as 0 | 1].classList.remove('is-active');
      el.covers[slot as 0 | 1].classList.remove('is-outgoing');
      el.glows[slot as 0 | 1].classList.remove('is-active');
      releaseSlotLater(slot);
    }

    state.artworkSlot = -1;
    state.artworkSwapUntil = 0;
    el.player.dataset.cover = '0';
  };

  const isLocalHost = (hostname: string) =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';

  const artworkUrl = (src: string, token: number, attempt: number) => {
    const url = new URL(src, cfg.url);

    /*
     * Cache busting is required for Tuna's local cover endpoint.
     * It is deliberately not added to arbitrary remote/signed URLs.
     */
    if ((url.protocol === 'http:' || url.protocol === 'https:') && isLocalHost(url.hostname)) {
      url.searchParams.set('_tuna', `${Date.now()}-${token}-${attempt}`);
    }

    return url;
  };

  const preloadImage = (src: string) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;

      const finish = <T>(callback: (value: T) => void, value: T) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);

        image.onload = null;
        image.onerror = null;

        callback(value);
      };

      const timer = setTimeout(() => {
        finish(reject, new Error('Artwork load timeout'));
        image.src = '';
      }, cfg.timeout);

      image.decoding = 'async';

      image.onload = () => {
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
          finish(reject, new Error('Artwork has invalid dimensions'));
          return;
        }

        finish(resolve, image);
      };

      image.onerror = () => {
        finish(reject, new Error('Artwork load failed'));
      };

      image.src = src;
    });

  const loadArtworkResource = async (url: URL) => {
    /*
     * Tuna's local webserver does not send CORS headers. Loading the
     * cache-busted URL directly through an image element avoids a noisy
     * failed fetch while still validating that the cover decoded.
     */
    await preloadImage(url.href);

    return {
      objectUrl: '',
      src: url.href,
    };
  };

  const releaseResource = (resource: ArtworkResource) => {
    if (resource.objectUrl) {
      URL.revokeObjectURL(resource.objectUrl);
    }
  };

  const applyArtwork = async (resource: ArtworkResource, rawSource: string, token: number) => {
    // Let the current two-image composite settle before reusing its backing
    // slot. A newer token supersedes any replacement waiting here.
    if (cfg.softReveal && performance.now() < state.artworkSwapUntil) {
      await sleep(state.artworkSwapUntil - performance.now());
    }
    if (token !== state.artworkToken) {
      releaseResource(resource);
      return;
    }

    const nextSlot = state.artworkSlot === 0 ? 1 : 0;
    const previousSlot = state.artworkSlot;

    const nextCover = el.covers[nextSlot as 0 | 1];
    const oldObjectUrl = state.artworkObjectUrls[nextSlot];

    nextCover.classList.remove('is-active');
    if (cfg.softReveal) {
      nextCover.style.transition = 'none';
      nextCover.classList.remove('is-outgoing');
      // Commit the empty slot before starting its next opacity transition.
      synchronizeRender(nextCover);
      nextCover.style.transition = '';
    }

    if (oldObjectUrl && oldObjectUrl !== resource.objectUrl) {
      URL.revokeObjectURL(oldObjectUrl);
    }

    state.artworkObjectUrls[nextSlot] = resource.objectUrl;

    nextCover.src = resource.src;
    el.glows[nextSlot as 0 | 1].src = resource.src;

    el.player.dataset.cover = '1';

    nextCover.classList.add('is-active');
    el.glows[nextSlot as 0 | 1].classList.add('is-active');

    if (previousSlot !== -1) {
      if (cfg.softReveal) {
        el.covers[previousSlot as 0 | 1].classList.add('is-outgoing');
      }
      el.covers[previousSlot as 0 | 1].classList.remove('is-active');
      el.glows[previousSlot as 0 | 1].classList.remove('is-active');
      releaseSlotLater(previousSlot);
    }

    state.artworkSlot = nextSlot;
    state.artworkSwapUntil = performance.now() + cfg.swap;
    state.lastAppliedArtworkSource = rawSource;
    state.artworkStatus = 'ready';
  };

  const loadArtwork = async ({
    src,
    token,
    delay,
    verifyStaticSource,
  }: {
    src: string;
    token: number;
    delay: number;
    verifyStaticSource: boolean;
  }) => {
    if (delay > 0) {
      await sleep(delay);
    }
    if (token !== state.artworkToken) {
      return;
    }
    let needsVerification = verifyStaticSource;
    let applied = false;

    const attemptOnce = async (attempt: number): Promise<'done' | 'retry'> => {
      try {
        const url = artworkUrl(src, token, attempt);
        const resource = await loadArtworkResource(url);

        if (token !== state.artworkToken) {
          releaseResource(resource);
          return 'done';
        }

        await applyArtwork(resource, src, token);
        applied = true;
        if (token !== state.artworkToken) {
          return 'done';
        }

        /*
         * Tuna often serves every cover through the same URL.
         * On a track change, one additional forced refresh protects
         * against receiving the previous file while Tuna is replacing it.
         */
        if (needsVerification && attempt + 1 < cfg.tries) {
          needsVerification = false;
          return 'retry';
        }

        return 'done';
      } catch (error) {
        trace('cover retry ' + (attempt + 1) + '/' + cfg.tries, error);
        // The next attempt gets a new cache-busting URL.
        return 'retry';
      }
    };

    // Попытки строго последовательны: каждый повтор получает новый cache-busting
    // URL только после завершения предыдущего — иначе скорость ответа Tuna деградирует.
    const retry = async (attempt: number): Promise<void> => {
      if (attempt > 0) {
        await sleep(cfg.retry);
        if (token !== state.artworkToken) {
          return;
        }
      }
      const outcome = await attemptOnce(attempt);
      if (outcome === 'retry' && attempt + 1 < cfg.tries) {
        return retry(attempt + 1);
      }
    };

    await retry(0);

    if (token !== state.artworkToken || applied) {
      return;
    }

    state.artworkStatus = 'failed';
    state.artworkRetryAt = performance.now() + Math.max(5000, cfg.retry * 3);
    if (cfg.softReveal) {
      deactivateArtwork();
    }
  };

  const scheduleArtworkLoad = (options: {
    token: number;
    src: string;
    delay: number;
    verifyStaticSource: boolean;
  }) => {
    loadArtwork(options).catch((error: unknown) => {
      trace('artwork load failed', error);
    });
  };

  const onArtworkTrackChanged = (src: string, key: string, now: number) => {
    state.previousArtworkSource = state.artworkSource || state.lastAppliedArtworkSource;

    state.artworkTrackKey = key;
    state.artworkSource = src;
    state.artworkSignature = `${key}\0${src}`;
    state.artworkChangedAt = now;
    state.artworkRetryAt = 0;

    state.artworkToken += 1;
    const token = state.artworkToken;

    // Keep the presented cover until its replacement has loaded. Missing or
    // exhausted artwork falls back normally instead of retaining a wrong one.
    if (!(cfg.softReveal && src)) {
      deactivateArtwork();
    }

    if (!src) {
      state.artworkStatus = 'empty';
      return;
    }

    state.artworkStatus = 'loading';
    scheduleArtworkLoad({
      delay: cfg.art,
      src,
      token,
      verifyStaticSource: state.previousArtworkSource !== '' && state.previousArtworkSource === src,
    });
  };

  const updateArtwork = (src: string, key: string, changed: boolean) => {
    const now = performance.now();

    if (changed || state.artworkTrackKey !== key) {
      onArtworkTrackChanged(src, key, now);

      return;
    }

    if (!src) {
      if (state.artworkSource || state.artworkStatus !== 'empty') {
        onArtworkTrackChanged(src, key, now);
      }
      return;
    }

    const signature = `${key}\0${src}`;

    if (signature === state.artworkSignature) {
      if (state.artworkStatus === 'loading' || state.artworkStatus === 'ready') {
        return;
      }

      if (state.artworkStatus === 'failed' && now < state.artworkRetryAt) {
        return;
      }
    }

    state.artworkSource = src;
    state.artworkSignature = signature;
    state.artworkStatus = 'loading';

    state.artworkToken += 1;
    const token = state.artworkToken;
    const elapsed = now - state.artworkChangedAt;

    scheduleArtworkLoad({
      delay: Math.max(0, cfg.art - elapsed),
      src,
      token,
      verifyStaticSource: state.previousArtworkSource !== '' && state.previousArtworkSource === src,
    });
  };

  const process = (track: Track) => {
    const active = track.playing && track.title.length > 0;

    if (state.firstPoll) {
      state.firstPoll = false;

      if (!active) {
        return;
      }

      const nextKey = trackKey(track);

      renderText(track);
      updateArtwork(track.artwork, nextKey, true);

      state.trackKey = nextKey;

      setPlaying(true);
      highlight(cfg.start);

      return;
    }

    if (!active) {
      stop();
      return;
    }

    const nextKey = trackKey(track);
    const resumed = !state.playing;
    const changed = state.trackKey !== '' && state.trackKey !== nextKey;

    renderText(track);
    updateArtwork(track.artwork, nextKey, changed || state.trackKey === '');

    state.trackKey = nextKey;

    setPlaying(true);

    if (resumed || changed) {
      highlight();
    }
  };

  const request = async () => {
    if (demo) {
      process({
        album: 'Демонстрация',
        artist: 'Tuna',
        artwork: '',
        id: 'demo',
        playing: true,
        title: 'Предпросмотр виджета',
      });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, cfg.timeout);

    try {
      const response = await fetch(cfg.url, {
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Tuna HTTP ${response.status}`);
      }

      const raw = await response.json();

      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Tuna returned invalid JSON');
      }

      state.errorCount = 0;
      process(parse(raw));
    } catch (error) {
      state.errorCount += 1;
      trace('poll failed ' + state.errorCount + '/' + cfg.fail, error);

      /* One or two lost polls must not make the widget blink. */
      if (state.errorCount >= cfg.fail) {
        stop();
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const poll = async () => {
    await request();

    setTimeout(() => {
      poll().catch((error: unknown) => {
        trace('poll cycle failed', error);
      });
    }, cfg.poll);
  };

  /* Base composition: 420 × 82. */
  const resize = () => {
    const fitted = Math.min(innerHeight / 82, innerWidth / 420);
    const safe = Math.min(innerHeight / 70, innerWidth / 280);
    const scale = Math.max(0.1, Math.min(fitted * cfg.ui, safe));

    el.root.style.setProperty('--scale', String(scale));
    el.root.style.setProperty('--img', String(cfg.img));
  };

  addEventListener('resize', resize, {
    passive: true,
  });

  resize();
  poll().catch((error: unknown) => {
    trace('poll cycle failed', error);
  });
})();
