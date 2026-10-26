import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { withGlobal } from '@sinonjs/fake-timers';
import { Transpiler } from 'bun';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const script = new Transpiler({ loader: 'ts' }).transformSync(
  readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'),
);
const setup = (demo = false) => {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: `http://localhost/?poll=100&art=0&anim=0&swap=0${demo ? '&demo=1' : ''}`,
  });
  const { window } = dom;
  const clock = withGlobal(window).install({
    toFake: ['setTimeout', 'clearTimeout', 'performance'],
  });
  const loads: (() => void)[] = [];
  let cover = 'http://localhost:1608/cover.png';
  let requests = 0;
  window.fetch = () => {
    requests += 1;
    return Promise.resolve(
      Response.json({
        artists: ['Artist'],
        cover_url: cover,
        status: 'playing',
        title: 'Track',
      }),
    );
  };
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      addEventListener() {
        /* fixed reduced motion */
      },
      matches: true,
    }),
  });
  Object.defineProperty(window, 'Image', {
    value: class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 100;
      naturalHeight = 100;
      set src(value: string) {
        if (value) {
          loads.push(() => this.onload?.());
        }
      }
    },
  });
  window.eval(script);
  return {
    clock,
    close() {
      clock.uninstall();
      window.close();
    },
    document: window.document,
    loads,
    requests: () => requests,
    setCover(value: string) {
      cover = value;
    },
  };
};

it('demo displays a track without fetching Tuna or loading external artwork', async () => {
  const widget = setup(true);
  try {
    await widget.clock.tickAsync(300);
    expect(widget.requests()).toBe(0);
    expect(widget.loads).toHaveLength(0);
    expect(widget.document.querySelector('#title')?.textContent).toBe('Предпросмотр виджета');
  } finally {
    widget.close();
  }
});

it('clears an already displayed cover when the same track loses its artwork URL', async () => {
  const widget = setup();
  try {
    await widget.clock.tickAsync(0);
    widget.loads.shift()?.();
    await widget.clock.tickAsync(0);
    expect(widget.document.querySelector('#player')?.getAttribute('data-cover')).toBe('1');
    widget.setCover('');
    await widget.clock.tickAsync(100);
    expect(widget.document.querySelector('#player')?.getAttribute('data-cover')).toBe('0');
    expect(widget.document.querySelector('.cover-image.is-active')).toBeNull();
    await widget.clock.tickAsync(80);
    expect(widget.document.querySelector('.cover-image[src]')).toBeNull();
  } finally {
    widget.close();
  }
});

it('ignores a pending cover after an empty URL and can load the URL again later', async () => {
  const widget = setup();
  try {
    await widget.clock.tickAsync(0);
    const oldLoad = widget.loads.shift();
    widget.setCover('');
    await widget.clock.tickAsync(100);
    oldLoad?.();
    await widget.clock.tickAsync(0);
    expect(widget.document.querySelector('#player')?.getAttribute('data-cover')).toBe('0');
    widget.setCover('http://localhost:1608/cover.png');
    await widget.clock.tickAsync(100);
    widget.loads.shift()?.();
    await widget.clock.tickAsync(0);
    expect(widget.document.querySelector('#player')?.getAttribute('data-cover')).toBe('1');
  } finally {
    widget.close();
  }
});
