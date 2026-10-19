import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import OutputStats from './OutputStats.vue';
import './styles.css';

export function renderPage(name) {
  if (name !== 'index.html') throw Error(`Unknown widget page: ${name}`);
  return renderToString(createSSRApp({ render: () => h(OutputStats) }));
}
