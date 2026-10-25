// MASEAAAO — подсветка сообщений стримера и упоминаний
const HOST_NICK = 'maseaaao';
const MENTION_PATTERN = /(?:^|[^\p{L}\p{N}_])@?maseaaao(?=$|[^\p{L}\p{N}_])/iu;
let initialized = false;

function initChatBrand() {
  const log = document.getElementById('log');
  if (!log || initialized) {
    return;
  }
  initialized = true;

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }
        const from = (node.getAttribute('data-from') || '').toLowerCase();
        const message = node.querySelector('.message');
        const text = message?.textContent || '';
        if (from === HOST_NICK) {
          node.classList.add('host');
        } else if (MENTION_PATTERN.test(text)) {
          node.classList.add('mention');
        }
      }
    }
  }).observe(log, { childList: true });
}

document.addEventListener('onLoad', initChatBrand);
document.addEventListener('DOMContentLoaded', initChatBrand);
initChatBrand();
