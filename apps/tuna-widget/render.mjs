import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import TunaFrame from './src/TunaFrame.vue';
import './src/styles.css';

export function renderPage(name) {
  if (name !== 'obs-tuna-widget.html') throw Error(`Unknown Tuna page: ${name}`);
  return renderToString(createSSRApp({ render: () => h(TunaFrame) }));
}
