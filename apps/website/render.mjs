import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import HomePage from './src/components/HomePage.vue';
import CheckerPage from './src/components/CheckerPage.vue';
import DocsPage from './src/components/DocsPage.vue';
import ToolsPage from './src/components/ToolsPage.vue';
import StreamInfoPage from './src/components/StreamInfoPage.vue';
import TunaPage from './src/components/TunaPage.vue';
const pages = {
  'index.html': HomePage,
  'check.html': CheckerPage,
  'docs.html': DocsPage,
  'tools/index.html': ToolsPage,
  'tools/stream-info.html': StreamInfoPage,
  'tools/tuna-widget.html': TunaPage,
};
export function renderPage(name) {
  const component = pages[name];
  if (!component) throw Error(`Unknown website page: ${name}`);
  return renderToString(createSSRApp({ render: () => h(component) }));
}
