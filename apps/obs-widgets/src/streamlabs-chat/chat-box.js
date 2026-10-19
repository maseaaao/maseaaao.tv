// MASEAAAO — подсветка сообщений стримера и упоминаний
const HOST_NICK = 'maseaaao';

function initChatBrand() {
  const log = document.getElementById('log');
  if (!log || initChatBrand.done) return;
  initChatBrand.done = true;

  new MutationObserver(function (mutations) {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const from = (node.getAttribute('data-from') || '').toLowerCase();
        const text = (node.textContent || '').toLowerCase();
        if (from === HOST_NICK) {
          node.classList.add('host');
        } else if (text.indexOf(HOST_NICK) !== -1) {
          node.classList.add('mention');
        }
      }
    }
  }).observe(log, { childList: true });
}

document.addEventListener('onLoad', initChatBrand);
document.addEventListener('DOMContentLoaded', initChatBrand);
initChatBrand();
