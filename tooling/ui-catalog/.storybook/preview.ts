import type { Preview } from '@storybook/vue3-vite';
import '@maseaaao/design/tokens.css';
import '@maseaaao/design/fonts-400.css';
import '@maseaaao/design/fonts-600.css';

const preview: Preview = {
  parameters: { a11y: { test: 'error' }, layout: 'padded' },
};
export default preview;
