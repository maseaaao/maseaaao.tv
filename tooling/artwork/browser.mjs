import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

export function launchBrowser() {
  const customExecutable = process.env.CHROME_BIN || process.env.CHROME_PATH;
  const executablePath = customExecutable || chromium.executablePath();
  if (!existsSync(executablePath)) {
    throw new Error(
      `Chromium executable not found: ${executablePath}. Run "npm run browser:install" or set CHROME_BIN / CHROME_PATH.`,
    );
  }
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}
