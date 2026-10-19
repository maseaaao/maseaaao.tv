import atImport from 'postcss-import';
import url from 'postcss-url';
export function providerPlugins() {
  return [atImport(), url({ url: 'inline', maxSize: 200 })];
}
