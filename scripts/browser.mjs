import {chromium} from "playwright-core";

export function launchBrowser() {
  const executablePath = process.env.CHROME_BIN || process.env.CHROME_PATH;
  return chromium.launch({
    ...(executablePath ? {executablePath} : {}),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}
