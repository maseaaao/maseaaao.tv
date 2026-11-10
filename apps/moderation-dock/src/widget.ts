import { type CurrentDonation, fetchCurrent } from './api';

const AMOUNT_TRAILING_ZERO = /\.0+$/;
const AMOUNT_ONE_DECIMAL_ZERO = /(\.\d)0$/;

function currencyLabel(currency: string): string {
  const code = (currency || '').toUpperCase();
  if (code === 'RUB' || code === 'RUR') {
    return '₽';
  }
  if (code === 'USD') {
    return '$';
  }
  if (code === 'EUR') {
    return '€';
  }
  if (code === 'KZT') {
    return '₸';
  }
  if (code === 'UAH') {
    return '₴';
  }
  return code;
}

function amountLabel(amount: string, currency: string): string {
  const clean = (amount || '')
    .replace(AMOUNT_TRAILING_ZERO, '')
    .replace(AMOUNT_ONE_DECIMAL_ZERO, '$1');
  return [clean, currencyLabel(currency)].filter(Boolean).join(' ');
}

export function mountWidget(root: HTMLElement): void {
  root.innerHTML = `
    <div class="alert-stage">
      <article class="donation-card" id="donation-card" aria-live="polite">
        <div class="donation-card__eyebrow">донат</div>
        <p class="donation-card__title">
          <span class="donation-card__name" id="donation-name"></span>
          <span class="connector"> — </span>
          <span class="donation-card__amount" id="donation-amount"></span>
        </p>
        <p class="donation-card__message" id="donation-message"></p>
        <audio class="donation-card__voice-audio" id="donation-audio" preload="auto"></audio>
      </article>
    </div>
  `;

  const card = document.querySelector<HTMLElement>('#donation-card');
  const name = document.querySelector<HTMLElement>('#donation-name');
  const amount = document.querySelector<HTMLElement>('#donation-amount');
  const message = document.querySelector<HTMLElement>('#donation-message');
  const audio = document.querySelector<HTMLAudioElement>('#donation-audio');
  if (!(card && name && amount && message && audio)) {
    throw new Error('Widget markup is incomplete');
  }

  let activeToken = '';
  let heldUntil = 0;

  const hide = () => {
    card.classList.remove('show');
    heldUntil = 0;
    window.setTimeout(() => {
      if (!card.classList.contains('show')) {
        name.textContent = '';
        amount.textContent = '';
        message.textContent = '';
      }
    }, 300);
  };

  const show = (data: CurrentDonation) => {
    const { item } = data;
    if (!item) {
      return;
    }
    name.textContent = item.username || 'Аноним';
    amount.textContent = amountLabel(item.amount, item.currency);
    const voice = item.kind === 'audio';
    message.textContent =
      voice || item.message === '[голосовое сообщение]' ? '' : item.message || '';
    card.classList.remove('show');
    // Force a layout read so a consecutive donation restarts the entrance animation.
    card.getBoundingClientRect();
    card.classList.add('show');
    heldUntil = Date.now() + (data.displaySeconds || 15) * 1000 + 1500;

    if (voice && item.audioUrl) {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.src = item.audioUrl;
        audio.load();
        audio.play().catch(() => undefined);
      } catch {
        /* The visual alert still appears if the browser blocks audio. */
      }
    } else {
      audio.pause();
      audio.removeAttribute('src');
    }
  };

  audio.addEventListener('ended', () => {
    if (activeToken && Date.now() > heldUntil) {
      hide();
    }
  });

  const poll = async () => {
    try {
      const data = await fetchCurrent();
      if (!(data.active && data.item)) {
        // Keep the card while the provider voice is still playing, but never longer than ~60 s.
        if (activeToken && (audio.paused || audio.ended || Date.now() > heldUntil + 45_000)) {
          activeToken = '';
          hide();
        }
        return;
      }
      if (data.token && data.token !== activeToken) {
        activeToken = data.token;
        show(data);
      }
    } catch {
      // Streamer.bot may be restarting; keep the last frame and retry.
    }
  };

  poll().catch(() => undefined);
  window.setInterval(() => {
    if (!document.hidden) {
      poll().catch(() => undefined);
    }
  }, 350);
}
