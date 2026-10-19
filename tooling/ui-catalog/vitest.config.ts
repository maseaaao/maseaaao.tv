import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { fileURLToPath } from 'node:url';

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
