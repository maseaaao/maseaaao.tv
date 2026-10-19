(() => {
  'use strict';

  const query = new URLSearchParams(location.search);
  const debug = query.get('debug') === '1';
  const trace = (event, error) => {
    if (debug) console.debug('[tuna-widget]', event, error instanceof Error ? error.message : String(error));
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
    artworkObjectUrls: ['', ''],
  };

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cfg.anim = 0;
    cfg.swap = 0;
  }
  el.root.style.setProperty('--art-swap', `${cfg.swap}ms`);

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

  const fade = (opacity, duration = cfg.anim) => {
    const target = Math.min(1, Math.max(0, opacity));
    const current = Number.parseFloat(getComputedStyle(el.player).opacity);

    if (state.fadeAnimation) {
      state.fadeAnimation.cancel();
      state.fadeAnimation = null;
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
    const meta = [];

    if (track.artist) {
      meta.push(track.artist);
    }

    if (
      track.album &&
      track.album.localeCompare(track.artist, undefined, {
        sensitivity: 'accent',
      }) !== 0
    ) {
      meta.push(track.album);
    }

    setText(el.title, title);
    setText(el.subtitle, track.artist || track.album);
    el.subtitle.hidden = !el.subtitle.textContent;
  };

  const releaseSlotLater = (slot) => {
    setTimeout(() => {
      const cover = el.covers[slot];

      if (cover.classList.contains('is-active')) {
        return;
      }

      cover.removeAttribute('src');
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
      el.glows[slot].classList.remove('is-active');
      releaseSlotLater(slot);
    }

    state.artworkSlot = -1;
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

  const applyArtwork = (resource, rawSource, token) => {
    if (token !== state.artworkToken) {
      releaseResource(resource);
      return;
    }

    const nextSlot = state.artworkSlot === 0 ? 1 : 0;
    const previousSlot = state.artworkSlot;

    const nextCover = el.covers[nextSlot];
    const oldObjectUrl = state.artworkObjectUrls[nextSlot];

    nextCover.classList.remove('is-active');

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
      el.covers[previousSlot].classList.remove('is-active');
      el.glows[previousSlot].classList.remove('is-active');
      releaseSlotLater(previousSlot);
    }

    state.artworkSlot = nextSlot;
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

        applyArtwork(resource, src, token);
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

      deactivateArtwork();

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
