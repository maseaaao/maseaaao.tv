import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import vue from '@vitejs/plugin-vue';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    vue(),
    storybookTest({ configDir: fileURLToPath(new URL('./.storybook', import.meta.url)) }),
  ],
  test: {
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { executablePath: process.env.CHROME_BIN } }),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
});
