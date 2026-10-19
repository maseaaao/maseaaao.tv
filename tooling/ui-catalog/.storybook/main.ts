import type { StorybookConfig } from '@storybook/vue3-vite';

const config: StorybookConfig = {
  staticDirs: ['../../../apps/website/public'],
  stories: ['../src/**/*.stories.ts', '../../../packages/ui/**/*.stories.ts'],
  framework: { name: '@storybook/vue3-vite', options: { docgen: 'vue-component-meta' } },
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  core: { disableTelemetry: true },
};
export default config;
