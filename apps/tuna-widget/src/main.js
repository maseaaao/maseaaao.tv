(() => {
  const query = new URLSearchParams(location.search);
  const debug = query.get('debug') === '1';
  const trace = (event, error) => {
    if (debug)
      console.debug('[tuna-widget]', event, error instanceof Error ? error.message : String(error));
  };

  const num = (name, fallback, min = -Infinity, max = Infinity) => {
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
    poll: num('poll', 1000, 100, 60_000),

    start: num('start', 7_000, 0, 600_000),
    show: num('show', 7_000, 0, 600_000),
    anim: num('anim', 1_000, 0, 60_000),

    idle: num('idle', 0, 0, 1),
    opaque: query.get('opaque') === '1',
    softReveal: query.get('opaque') === '1' && query.get('reveal') === 'soft',

    art: num('art', 700, 0, 10_000),
    swap: num('swap', 420, 0, 5_000),
    retry: num('retry', 900, 100, 10_000),
    tries: Math.round(num('tries', 3, 1, 8)),

    timeout: num('timeout', 4_000, 500, 30_000),
    fail: Math.round(num('fail', 3, 1, 20)),

    img: num('img', 1, 0.5, 1.5),
    ui: num('ui', 1, 0.25, 3),

    port: Math.round(num('port', 1608, 1, 65_535)),
  };

  cfg.url = `http://localhost:${cfg.port}/`;

  const el = {
    root: document.documentElement,
    player: document.querySelector('#player'),
    surface: document.querySelector('#surface'),
    coverFrame: document.querySelector('#cover-frame'),
    content: document.querySelector('#content'),
    trackText: document.querySelector('#track-text'),
    glows: [...document.querySelectorAll('.artwork-glow')],
    covers: [document.querySelector('#cover-a'), document.querySelector('#cover-b')],
    title: document.querySelector('#title'),
    subtitle: document.querySelector('#subtitle'),
  };

  const state = {
    firstPoll: true,

    playing: false,
    trackKey: '',

    idleTimer: 0,
    fadeAnimation: null,
    presenceAnimations: [],
    textSwap: null,
    errorCount: 0,

    artworkToken: 0,
    artworkTrackKey: '',
    artworkSignature: '',
    artworkSource: '',
    previousArtworkSource: '',
    lastAppliedArtworkSource: '',
    artworkChangedAt: 0,
    artworkStatus: 'idle',
    artworkRetryAt: 0,
    artworkSlot: -1,
    artworkSwapUntil: 0,
    artworkObjectUrls: ['', ''],
  };

  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const configuredMotion = { anim: cfg.anim, swap: cfg.swap };
  const updateMotion = () => {
    const reduced = query.get('motion') !== '1' && motionPreference.matches;
    cfg.anim = reduced ? 0 : configuredMotion.anim;
    cfg.swap = reduced ? 0 : configuredMotion.swap;
    el.root.style.setProperty('--art-swap', `${cfg.swap}ms`);
    if (!reduced) return;
    // End at the already committed target, never replay a reveal or reset its timer.
    state.fadeAnimation?.cancel();
    state.fadeAnimation = null;
    state.presenceAnimations.forEach((animation) => {
      animation.cancel();
    });
    state.presenceAnimations = [];
    state.textSwap?.finish();
  };
  updateMotion();
  motionPreference.addEventListener('change', updateMotion);
  if (cfg.opaque) el.root.dataset.opaque = '1';
  if (cfg.softReveal) el.root.dataset.reveal = 'soft';

  const sleep = (duration) =>
    new Promise((resolve) => {
      setTimeout(resolve, duration);
    });

  const clearIdle = () => {
    if (!state.idleTimer) {
      return;
    }

    clearTimeout(state.idleTimer);
    state.idleTimer = 0;
  };

  // Sample a gently underdamped response once; no continuous JS frame loop.
  // Opacity and focus resolve separately, before the spatial settling finishes.
  const springTransforms = (from, to) => {
    const a = new DOMMatrixReadOnly(from);
    const b = new DOMMatrixReadOnly(to);
    const fields = ['a', 'b', 'c', 'd', 'e', 'f'];
    const response = (t) => 1 - Math.exp(-8 * t) * (Math.cos(10 * t) + 0.8 * Math.sin(10 * t));
    const end = response(1);
    return Array.from({ length: 33 }, (_, index) => {
      const t = index / 32;
      const progress = response(t) / end;
      const values = fields.map((key) => a[key] + (b[key] - a[key]) * progress);
      return { offset: t, transform: `matrix(${values.join(',')})` };
    });
  };

  const presenceProperty = (node, property, from, to, duration, delay = 0) => {
    node.style[property] = to;
    const resolved = getComputedStyle(node)[property];
    if (duration === 0 || from === resolved) return;
    const transforms = property === 'transform';
    const frames = transforms
      ? springTransforms(from, resolved)
      : [{ [property]: from }, { [property]: resolved }];
    const animation = node.animate(frames, {
      duration,
      delay,
      easing: transforms ? 'linear' : 'ease-out',
      fill: 'both',
    });
    state.presenceAnimations.push(animation);
    void animation.finished
      .then(() => {
        if (!state.presenceAnimations.includes(animation)) return;
        animation.cancel();
        state.presenceAnimations = state.presenceAnimations.filter((item) => item !== animation);
      })
      .catch(() => {});
  };

  const softPresence = (target, duration) => {
    const layers = [el.player, el.surface, el.coverFrame, el.content];
    // Capture the presented pose before cancelling, so a new track or pause can
    // reverse an unfinished transition without snapping back to an endpoint.
    const current = layers.map((node) => {
      const style = getComputedStyle(node);
      return { opacity: style.opacity, transform: style.transform, filter: style.filter };
    });
    for (const animation of state.presenceAnimations) animation.cancel();
    state.presenceAnimations = [];
    const visible = target > 0;
    const backdropDelay = visible ? 0 : duration * 0.24;
    const backdropDuration = visible ? duration : duration * 0.76;
    const contentDelay = visible && Number(current[1].opacity) < 0.999 ? duration * 0.24 : 0;
    presenceProperty(
      el.player,
      'transform',
      current[0].transform,
      `translateY(${visible ? (1 - target) * 100 : 0}%)`,
      duration,
    );
    presenceProperty(
      el.surface,
      'transform',
      current[1].transform,
      visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.97, 0.9)',
      backdropDuration,
      backdropDelay,
    );
    presenceProperty(
      el.surface,
      'opacity',
      current[1].opacity,
      visible ? '1' : '0',
      visible ? duration * 0.2 : backdropDuration,
      backdropDelay,
    );
    for (const [index, node] of layers.entries()) {
      if (index < 2) continue;
      presenceProperty(
        node,
        'filter',
        current[index].filter,
        visible ? 'blur(0px)' : 'blur(3px)',
        Math.min(duration * 0.28, 120),
        contentDelay,
      );
      presenceProperty(
        node,
        'transform',
        current[index].transform,
        visible ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.985)',
        visible ? duration - contentDelay : duration * 0.24,
        contentDelay,
      );
      presenceProperty(
        node,
        'opacity',
        current[index].opacity,
        visible ? '1' : '0',
        duration * (visible ? 0.28 : 0.2),
        contentDelay,
      );
    }
  };

  const fade = (opacity, duration = cfg.anim) => {
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
      if (duration === 0 || currentTransform === targetTransform) return;
      const animation = el.player.animate(
        [{ transform: currentTransform }, { transform: targetTransform }],
        {
          duration,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'both',
        },
      );
      state.fadeAnimation = animation;
      void animation.finished
        .then(() => {
          if (state.fadeAnimation !== animation) return;
          animation.cancel();
          state.fadeAnimation = null;
        })
        .catch(() => {});
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

    void animation.finished
      .then(() => {
        if (state.fadeAnimation !== animation) {
          return;
        }

        animation.cancel();
        state.fadeAnimation = null;
      })
      .catch(() => {});
  };

  const scheduleIdle = (delay) => {
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

  const setPlaying = (playing) => {
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

  const normalize = (value) => {
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

  const readPlaying = (raw, title) => {
    const explicit = [raw.playing, raw.is_playing, raw.isPlaying];

    for (const value of explicit) {
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

  const parse = (raw) => {
    const title = normalize(raw.title ?? raw.song ?? raw.track ?? raw.name);

    return {
      id: normalize(raw.track_id ?? raw.trackId ?? raw.media_id ?? raw.mediaId ?? raw.id),
      title,
      artist: normalize(raw.artists ?? raw.artist ?? raw.album_artist ?? raw.albumArtist),
      album: normalize(raw.album),
      artwork: normalize(
        raw.cover_url ??
          raw.coverUrl ??
          raw.cover ??
          raw.artwork_url ??
          raw.artworkUrl ??
          raw.artwork,
      ),
      playing: readPlaying(raw, title),
    };
  };

  const trackKey = (track) => [track.id, track.title, track.artist].join('\0');

  const setText = (element, value) => {
    if (element.textContent !== value) {
      element.textContent = value;
    }
  };

  const renderText = (track) => {
    const title = track.title || 'Без названия';
    const subtitle = track.artist || track.album || '';
    if (state.textSwap) {
      // Coalesce rapid changes to the latest metadata. At most two text layers
      // exist, and a running transition finishes without a positional jump.
      state.textSwap.latest = track;
      return;
    }
    if (el.title.textContent === title && el.subtitle.textContent === subtitle) return;

    const animate =
      cfg.softReveal &&
      cfg.anim > 0 &&
      state.playing &&
      Number(getComputedStyle(el.content).opacity) > 0.999;
    const outgoing = animate ? el.trackText.cloneNode(true) : null;

    setText(el.title, title);
    setText(el.subtitle, subtitle);
    el.subtitle.hidden = !el.subtitle.textContent;
    if (!outgoing) return;

    outgoing.removeAttribute('id');
    outgoing.querySelectorAll('[id]').forEach((node) => {
      node.removeAttribute('id');
    });
    outgoing.setAttribute('aria-hidden', 'true');
    el.content.prepend(outgoing);
    const duration = Math.min(cfg.anim, 280);
    const shift = Math.min(12, el.coverFrame.clientHeight * 0.07);
    const options = { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' };
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
      latest: track,
      finish: () => {
        if (state.textSwap !== swap) return;
        animations.forEach((animation) => {
          animation.cancel();
        });
        outgoing.remove();
        state.textSwap = null;
        renderText(swap.latest);
      },
    };
    state.textSwap = swap;
    void Promise.all(animations.map((animation) => animation.finished))
      .then(swap.finish)
      .catch(() => {});
  };

  const releaseSlotLater = (slot) => {
    setTimeout(() => {
      const cover = el.covers[slot];

      if (cover.classList.contains('is-active')) {
        return;
      }

      cover.removeAttribute('src');
      cover.classList.remove('is-outgoing');
      el.glows[slot].removeAttribute('src');

      const objectUrl = state.artworkObjectUrls[slot];

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        state.artworkObjectUrls[slot] = '';
      }
    }, cfg.swap + 80);
  };

  const deactivateArtwork = () => {
    for (let slot = 0; slot < el.covers.length; slot += 1) {
      el.covers[slot].classList.remove('is-active');
      el.covers[slot].classList.remove('is-outgoing');
      el.glows[slot].classList.remove('is-active');
      releaseSlotLater(slot);
    }

    state.artworkSlot = -1;
    state.artworkSwapUntil = 0;
    el.player.dataset.cover = '0';
  };

  const isLocalHost = (hostname) =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';

  const artworkUrl = (src, token, attempt) => {
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

  const preloadImage = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;

      const finish = (callback, value) => {
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

  const loadArtworkResource = async (url) => {
    /*
     * Tuna's local webserver does not send CORS headers. Loading the
     * cache-busted URL directly through an image element avoids a noisy
     * failed fetch while still validating that the cover decoded.
     */
    await preloadImage(url.href);

    return {
      src: url.href,
      objectUrl: '',
    };
  };

  const releaseResource = (resource) => {
    if (resource.objectUrl) {
      URL.revokeObjectURL(resource.objectUrl);
    }
  };

  const applyArtwork = async (resource, rawSource, token) => {
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

    const nextCover = el.covers[nextSlot];
    const oldObjectUrl = state.artworkObjectUrls[nextSlot];

    nextCover.classList.remove('is-active');
    if (cfg.softReveal) {
      nextCover.style.transition = 'none';
      nextCover.classList.remove('is-outgoing');
      // Commit the empty slot before starting its next opacity transition.
      void nextCover.offsetWidth;
      nextCover.style.transition = '';
    }

    if (oldObjectUrl && oldObjectUrl !== resource.objectUrl) {
      URL.revokeObjectURL(oldObjectUrl);
    }

    state.artworkObjectUrls[nextSlot] = resource.objectUrl;

    nextCover.src = resource.src;
    el.glows[nextSlot].src = resource.src;

    el.player.dataset.cover = '1';

    nextCover.classList.add('is-active');
    el.glows[nextSlot].classList.add('is-active');

    if (previousSlot !== -1) {
      if (cfg.softReveal) el.covers[previousSlot].classList.add('is-outgoing');
      el.covers[previousSlot].classList.remove('is-active');
      el.glows[previousSlot].classList.remove('is-active');
      releaseSlotLater(previousSlot);
    }

    state.artworkSlot = nextSlot;
    state.artworkSwapUntil = performance.now() + cfg.swap;
    state.lastAppliedArtworkSource = rawSource;
    state.artworkStatus = 'ready';
  };

  const loadArtwork = async ({ src, token, delay, verifyStaticSource }) => {
    if (delay > 0) {
      await sleep(delay);
    }

    if (token !== state.artworkToken) {
      return;
    }

    let applied = false;
    let needsVerification = verifyStaticSource;

    for (let attempt = 0; attempt < cfg.tries; attempt += 1) {
      if (attempt > 0) {
        await sleep(cfg.retry);

        if (token !== state.artworkToken) {
          return;
        }
      }

      try {
        const url = artworkUrl(src, token, attempt);
        const resource = await loadArtworkResource(url);

        if (token !== state.artworkToken) {
          releaseResource(resource);
          return;
        }

        await applyArtwork(resource, src, token);
        if (token !== state.artworkToken) return;
        applied = true;

        /*
         * Tuna often serves every cover through the same URL.
         * On a track change, one additional forced refresh protects
         * against receiving the previous file while Tuna is replacing it.
         */
        if (needsVerification && attempt + 1 < cfg.tries) {
          needsVerification = false;
          continue;
        }

        return;
      } catch (error) {
        trace('cover retry ' + (attempt + 1) + '/' + cfg.tries, error);
        // The next attempt gets a new cache-busting URL.
      }
    }

    if (token !== state.artworkToken || applied) {
      return;
    }

    state.artworkStatus = 'failed';
    state.artworkRetryAt = performance.now() + Math.max(5_000, cfg.retry * 3);
    if (cfg.softReveal) deactivateArtwork();
  };

  const updateArtwork = (src, key, changed) => {
    const now = performance.now();

    if (changed || state.artworkTrackKey !== key) {
      state.previousArtworkSource = state.artworkSource || state.lastAppliedArtworkSource;

      state.artworkTrackKey = key;
      state.artworkSource = src;
      state.artworkSignature = `${key}\0${src}`;
      state.artworkChangedAt = now;
      state.artworkRetryAt = 0;

      const token = ++state.artworkToken;

      // Keep the presented cover until its replacement has loaded. Missing or
      // exhausted artwork falls back normally instead of retaining a wrong one.
      if (!cfg.softReveal || !src) deactivateArtwork();

      if (!src) {
        state.artworkStatus = 'empty';
        return;
      }

      state.artworkStatus = 'loading';

      void loadArtwork({
        src,
        token,
        delay: cfg.art,
        verifyStaticSource:
          state.previousArtworkSource !== '' && state.previousArtworkSource === src,
      });

      return;
    }

    if (!src) {
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

    const token = ++state.artworkToken;
    const elapsed = now - state.artworkChangedAt;

    void loadArtwork({
      src,
      token,
      delay: Math.max(0, cfg.art - elapsed),
      verifyStaticSource: state.previousArtworkSource !== '' && state.previousArtworkSource === src,
    });
  };

  const process = (track) => {
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
      void poll();
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
  void poll();
})();
