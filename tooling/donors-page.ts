// Shared renderer and DonationAlerts reader for the donor panel. Used by the local
// standalone build and by the Cloudflare Worker that serves the live page.

const API = 'https://www.donationalerts.com/api/v1';
const WIDGET_PATH = /\/widget\/stream-stats\/(\d+)/;

interface Donation {
  donator_info: { name: string; user_id: number | null };
  origin_amount: number;
  origin_currency: string;
}

export interface Payload {
  interval: number;
  rows: Row[];
  updatedAt: string;
}

interface Row {
  additional: string;
  main: string;
}

interface StatResponse {
  data: { currency: string; display_type: string; donations: Donation[] };
}

interface WidgetSettings {
  additionalTemplate: string;
  displayMode: string;
  rowsNumber: number;
  template: string;
  widgetSpeed: number;
}

interface WidgetResponse {
  data: { id: number; json: { settings: WidgetSettings }; title: string };
}

interface PageOptions {
  css: string;
  dataUrl?: string;
  initial?: Payload;
  title?: string;
}

async function readJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    // Keep secrets out of logs: report the path, never the query string.
    throw new Error(`${response.status} ${response.statusText} for ${new URL(url).pathname}`);
  }
  return (await response.json()) as T;
}

function fillTemplate(template: string, name: string, amount: string): string {
  return template.replaceAll('{username}', name).replaceAll('{amount}', amount).trim();
}

function buildRows(settings: WidgetSettings, donations: Donation[]): Row[] {
  const mainTemplate = settings.template || '{username} - {amount}';
  const additionalTemplate = settings.additionalTemplate || '';
  const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  return donations.slice(0, settings.rowsNumber).map((donation) => {
    const name = donation.donator_info.name === 'Anonymous' ? 'Аноним' : donation.donator_info.name;
    const amount = `${format.format(donation.origin_amount)} ${donation.origin_currency}`;
    return {
      additional: additionalTemplate ? fillTemplate(additionalTemplate, name, amount) : '',
      main: fillTemplate(mainTemplate, name, amount),
    };
  });
}

function widgetLocation(rawUrl: string): { id: string; token: string } {
  const url = new URL(rawUrl);
  const token = url.searchParams.get('token');
  const id = url.pathname.match(WIDGET_PATH)?.[1];
  if (!id) {
    throw new Error('URL is not a DonationAlerts stream-stats widget link');
  }
  if (!token) {
    throw new Error('Widget URL has no token query parameter');
  }
  return { id, token };
}

export async function collectWidget(
  widgetUrl: string,
  interval: number,
): Promise<{ payload: Payload; title: string }> {
  const { id, token } = widgetLocation(widgetUrl);
  const auth = await readJson<{ data?: { token?: string } }>(
    `${API}/token/widget?token=${encodeURIComponent(token)}`,
  );
  const jwt = auth.data?.token;
  if (!jwt) {
    throw new Error('DonationAlerts did not return a widget token');
  }
  const headers = { Accept: 'application/json', Authorization: `Bearer ${jwt}` };
  const [widget, stats] = await Promise.all([
    readJson<WidgetResponse>(`${API}/widgets/stat/${id}`, headers),
    readJson<StatResponse>(`${API}/widgets/stat/${id}/stat`, headers),
  ]);
  if (stats.data.display_type !== 'latest_donations') {
    throw new Error(`Unsupported display type: ${stats.data.display_type}`);
  }
  return {
    payload: {
      interval,
      rows: buildRows(widget.data.json.settings, stats.data.donations),
      updatedAt: new Date().toISOString(),
    },
    title: widget.data.title,
  };
}

export function signature(payload: Payload): string {
  return payload.rows.map((row) => `${row.main}\u0000${row.additional}`).join('\n');
}

const BEHAVIOR = `(function () {
  var list = document.getElementById('list');
  var state = { payload: null, index: 0, current: null, timer: null, signature: '' };
  var dataUrl = window.__DONORS_DATA__;
  function signature(payload) {
    return payload.rows.map(function (row) { return row.main + '\\u0000' + row.additional; }).join('\\n');
  }
  function createRow(row) {
    var item = document.createElement('div');
    item.className = 'stats-list-item';
    var main = document.createElement('div');
    main.className = 'stats-item-main-row';
    main.textContent = row.main;
    item.appendChild(main);
    if (row.additional) {
      var extra = document.createElement('div');
      extra.className = 'stats-item-additional-row';
      extra.textContent = row.additional;
      item.appendChild(extra);
    }
    return item;
  }
  function show(row) {
    var item = createRow(row);
    item.classList.add('fade-in-out-enter', 'fade-in-out-enter-active', 'fade-in-out-enter-from');
    list.appendChild(item);
    void item.offsetWidth;
    item.classList.remove('fade-in-out-enter-from', 'fade-in-out-enter');
    setTimeout(function () { item.classList.remove('fade-in-out-enter-active'); }, 520);
    var previous = state.current;
    state.current = item;
    if (previous) {
      previous.classList.add('fade-in-out-leave-to');
      setTimeout(function () { previous.remove(); }, 520);
    }
  }
  function start() {
    if (state.timer) clearInterval(state.timer);
    state.index = 0;
    if (!state.payload || !state.payload.rows.length) return;
    show(state.payload.rows[0]);
    if (state.payload.rows.length > 1) {
      state.timer = setInterval(function () {
        state.index = (state.index + 1) % state.payload.rows.length;
        show(state.payload.rows[state.index]);
      }, state.payload.interval);
    }
  }
  function apply(payload) {
    if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) return;
    var next = signature(payload);
    if (next === state.signature) return;
    state.payload = payload;
    state.signature = next;
    start();
  }
  function poll() {
    if (dataUrl) {
      fetch(dataUrl, { cache: 'no-store' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) { if (payload) apply(payload); })
        .catch(function () {});
      return;
    }
    var script = document.createElement('script');
    script.src = 'data.js?t=' + Date.now();
    script.onload = function () {
      script.remove();
      if (window.__DONORS_LIVE__) {
        apply(window.__DONORS_LIVE__);
        window.__DONORS_LIVE__ = null;
      }
    };
    script.onerror = function () { script.remove(); };
    document.head.appendChild(script);
  }
  if (window.__DONORS__) {
    state.payload = window.__DONORS__;
    state.signature = signature(state.payload);
    start();
  }
  poll();
  setInterval(poll, dataUrl ? 15000 : 10000);
})();`;

function escapeTitle(title: string): string {
  return title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderPage(options: PageOptions): string {
  const initial = options.initial ? JSON.stringify(options.initial) : 'null';
  const dataUrl = options.dataUrl ? JSON.stringify(options.dataUrl) : 'null';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:,">
<title>${escapeTitle(options.title ?? 'Донаты')}</title>
<style>${options.css}</style>
<style>
html, body { width: 100%; height: 100%; }
body { display: flex; flex-direction: column; justify-content: flex-end; }
.widget-stream-stats .stats-item-main-row,
.widget-stream-stats .stats-item-additional-row { text-align: center; }
/* The published page is a compact strip: same panel as the OBS source but
   shorter (92 px instead of 114 px), with the two text lines scaled to fit. */
.widget-stream-stats .stats-list { height: 92px; }
.widget-stream-stats .stats-item-main-row {
  font-size: clamp(30px, 3.6vw, 36px) !important;
}
.widget-stream-stats .stats-item-additional-row {
  font-size: clamp(20px, 2.4vw, 24px) !important;
}
</style>
</head>
<body>
<div class="widget-stream-stats">
<div class="stats-list" id="list"></div>
</div>
<script>window.__DONORS__ = ${initial}; window.__DONORS_DATA__ = ${dataUrl};</script>
<script>${BEHAVIOR}</script>
</body>
</html>
`;
}
