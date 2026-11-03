interface Goal {
  current: number;
  target: number;
  type?: string;
}

const params = new URLSearchParams(location.search);
const layout = params.get('layout') === 'goal';
const goalEnabled = layout || params.get('goal') === '1';
const demo = params.get('demo') === '1';
const actionName = params.get('action') || 'Creator Goal';
const socketUrl = params.get('ws') || 'ws://127.0.0.1:8080';

const strip = document.querySelector<HTMLElement>('.strip');
const count = document.querySelector<HTMLElement>('.goal-count');
const currentText = document.querySelector<HTMLElement>('.goal-current');
const targetText = document.querySelector<HTMLElement>('.goal-target');
const line = document.querySelector<HTMLElement>('.goal-line');
const lineFill = line?.querySelector<HTMLElement>('i') ?? null;
const block = document.querySelector<HTMLElement>('.goal-block');
const blockCurrent = document.querySelector<HTMLElement>('.goal-block__current');
const blockTarget = document.querySelector<HTMLElement>('.goal-block__target');
const blockLeft = document.querySelector<HTMLElement>('.goal-block__left');
const blockBar = document.querySelector<HTMLElement>('.goal-block__bar i');

if (layout && strip) {
  strip.hidden = true;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.round(value)));
}

function render(goal: Goal | null): void {
  const active = Boolean(goal && Number.isFinite(goal.target) && goal.target > 0);
  if (count) {
    count.hidden = !active || layout;
  }
  if (line) {
    line.hidden = !active || layout;
  }
  if (block) {
    block.hidden = !(active && layout);
  }
  if (!(active && goal)) {
    return;
  }

  const total = Math.max(1, goal.target);
  const percent = Math.min(100, Math.max(0, (goal.current / total) * 100));
  const left = Math.max(0, Math.round(goal.target - goal.current));

  if (currentText) {
    currentText.textContent = formatNumber(goal.current);
  }
  if (targetText) {
    targetText.textContent = `/${formatNumber(goal.target)}`;
  }
  if (lineFill) {
    lineFill.style.width = `${percent}%`;
  }

  if (blockCurrent) {
    blockCurrent.textContent = formatNumber(goal.current);
  }
  if (blockTarget) {
    blockTarget.textContent = `/${formatNumber(goal.target)}`;
  }
  if (blockLeft) {
    blockLeft.textContent = left === 0 ? 'ЦЕЛЬ ДОСТИГНУТА' : `ОСТАЛОСЬ ${formatNumber(left)}`;
  }
  if (blockBar) {
    blockBar.style.width = `${percent}%`;
  }
}

function parseGoal(value: unknown): Goal | null {
  let data: unknown = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const current = Number(record.current);
  const target = Number(record.target);
  if (!(Number.isFinite(current) && Number.isFinite(target)) || target <= 0) {
    return null;
  }
  return {
    current,
    target,
    type: typeof record.type === 'string' ? record.type : undefined,
  };
}

if (!goalEnabled) {
  render(null);
} else if (demo) {
  render({ current: 18, target: 20, type: 'follower' });
} else {
  let socket: WebSocket | null = null;
  let poll: number | undefined;
  let reconnect: number | undefined;

  const request = (): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        action: { name: actionName },
        id: `goal-action-${Date.now()}`,
        request: 'DoAction',
      }),
    );
    socket.send(JSON.stringify({ id: `goal-globals-${Date.now()}`, request: 'GetGlobals' }));
  };

  const connect = (): void => {
    socket = new WebSocket(socketUrl);
    socket.addEventListener('open', () => {
      request();
      poll = window.setInterval(request, 30_000);
    });
    socket.addEventListener('message', (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const record = message as Record<string, unknown>;
      const store = (record.variables ?? record.globals) as Record<string, unknown> | undefined;
      if (typeof store !== 'object' || store === null) {
        return;
      }
      const raw = store.twitchGoal;
      if (raw === undefined) {
        return;
      }
      const value =
        typeof raw === 'object' && raw !== null && 'value' in raw
          ? (raw as { value: unknown }).value
          : raw;
      render(parseGoal(value));
    });
    socket.addEventListener('close', () => {
      window.clearInterval(poll);
      reconnect = window.setTimeout(connect, 5000);
    });
  };

  connect();
  window.addEventListener('beforeunload', () => {
    window.clearInterval(poll);
    window.clearTimeout(reconnect);
    socket?.close();
  });
}
