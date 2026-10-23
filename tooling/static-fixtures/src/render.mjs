import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import ArtworkCard from './ArtworkCard.vue';
import CounterCard from './CounterCard.vue';
import StaticCard from './StaticCard.vue';
import './style.css';

const pages = {
  'index.html': StaticCard,
  'interactive.html': CounterCard,
  'examples/artwork.html': ArtworkCard,
};
export function renderPage(name) {
  const page = pages[name];
  if (!page) throw Error(`Unknown page: ${name}`);
  return renderToString(createSSRApp({ render: () => h(page) }));
}
