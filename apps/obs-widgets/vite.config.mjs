import { standaloneConfig } from '@maseaaao/build-config';
import { prepareVuePages, vuePagePlugin } from '@maseaaao/build-config/static';
import { fileURLToPath } from 'node:url';

export default async ({ mode: product }) => {
  if (product !== 'social-strip') throw Error('Unknown standalone widget');
  const root = fileURLToPath(new URL('./src/' + product, import.meta.url));
  const { renderPage, styleFile } = await prepareVuePages({
    root,
    ssrEntry: 'render.mjs',
    cacheDir: fileURLToPath(new URL('../../.build-cache/widgets/' + product, import.meta.url)),
  });
  const config = standaloneConfig({
    root,
    outDir: '../../dist/' + product,
    fileName: 'index.html',
  });
  config.plugins.push(vuePagePlugin({ root, renderPage, styleFile, pageName: 'index.html' }));
  config.plugins.push({
    name: 'static-widget-contract',
    generateBundle(_options, bundle) {
      let bytes = 0;
      for (const entry of Object.values(bundle)) {
        if (entry.type !== 'chunk') continue;
        bytes += Buffer.byteLength(entry.code);
        if (Object.keys(entry.modules).some((id) => /[/\\](?:@vue|vue)[/\\]/.test(id)))
          throw Error('Static widgets must not ship Vue runtime or compiler');
      }
      if (bytes > 35000) throw Error(`Widget JS budget exceeded: ${bytes} > 35000`);
    },
  });
  return { ...config, publicDir: 'public' };
};
