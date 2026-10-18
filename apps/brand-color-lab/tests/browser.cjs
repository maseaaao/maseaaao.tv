const { chromium } = require("playwright");
const assert = require("assert"),
  { pathToFileURL } = require("url");
(async () => {
  const b = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
      : {}),
  });
  const context = await b.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    pathToFileURL(require("path").resolve(__dirname, "../index.html")).href,
  );
  await page.waitForFunction(
    () => !document.getElementById("generate").disabled,
  );
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(244, 243, 236)");
  const id = await page.evaluate(() => current.id);
  await page.locator("#favorites-toggle").click();
  assert(await page.locator("#list-empty").isVisible());
  assert.equal(await page.locator(".history-row").count(), 0);
  await page.locator("#history-close").click();
  await page.locator("#favorite").click();
  await page.waitForFunction(
    () => !document.getElementById("favorite").disabled,
  );
  assert.equal(
    await page.locator("#favorite").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("#favorites-count").textContent(), "1");
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("generate").disabled,
  );
  assert.equal(
    await page.locator("#favorite").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("#favorites-count").textContent(), "1");
  await page.locator("#generate").click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("#favorite").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#favorites-toggle").click();
  await page.waitForSelector(".history-row");
  assert.equal(await page.locator(".history-row").count(), 1);
  await page.locator(".history-row").click();
  assert.equal(await page.evaluate(() => current.id), id);
  await page.locator("#history-close").click();
  await page.evaluate(() => {
    window.exportedBlob = null;
    URL.createObjectURL = (blob) => {
      window.exportedBlob = blob;
      return "blob:test";
    };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.locator("#history-toggle").click();
  await page
    .getByRole("button", { name: "Экспорт истории", exact: true })
    .click();
  const exported = JSON.parse(await page.evaluate(() => exportedBlob.text()));
  assert.equal(exported.palettes.filter((p) => p.favorite).length, 1);
  const imported = {
    ...exported.palettes.find((p) => p.favorite),
    id: "imported-favorite",
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "favorites.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        palettes: [
          imported,
          { ...imported, id: "legacy", favorite: undefined },
        ],
      }),
    ),
  });
  await page.waitForFunction(() => favoritePalettes.length === 2);
  await page.waitForTimeout(100);
  await page.locator("#tab-favorites").click();
  await page.waitForTimeout(60);
  assert.equal(await page.locator(".history-row").count(), 2);
  await page.locator("#history-close").click();
  await page.locator("#favorite").click();
  await page.waitForFunction(
    () => !document.getElementById("favorite").disabled,
  );
  assert.equal(await page.locator("#favorites-count").textContent(), "1");
  assert.equal(
    await page.evaluate(() => palettes.some((p) => p.id === current.id)),
    true,
  );
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("generate").disabled,
  );
  assert.equal(
    await page.locator("#favorite").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("#favorites-count").textContent(), "1");
  await page.locator("#favorites-toggle").click();
  await page.evaluate(() => {
    const p = palettes[0];
    for (let i = 0; i < 10000; i++)
      palettes.push({ ...p, id: "virtual-" + i, favorite: true });
    updateCount();
    renderHistory();
  });
  assert((await page.locator(".history-row").count()) < 20);
  await page
    .locator("#history-scroll")
    .evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator(".history-row").last().getAttribute("data-palette-id"),
    "virtual-9999",
  );
  assert((await page.locator(".history-row").count()) < 20);
  await page.locator("#tab-history").click();
  assert.equal(
    await page.locator("#history-scroll").evaluate((e) => e.scrollTop),
    0,
  );
  await page.locator("#history-close").click();
  await page.evaluate(() => {
    palettes = palettes.filter((p) => !p.id.startsWith("virtual-"));
    updateCount();
    document.getElementById("toast").textContent = "";
  });
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [
    [1440, 900],
    [1440, 600],
    [1280, 720],
    [390, 844],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const layout = await page.evaluate(() => {
      const text = document.querySelector(".wordmarks").getBoundingClientRect(),
        avatars = document.getElementById("avatars").getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        overlap:
          text.bottom >=
          document.querySelector(".palette").getBoundingClientRect().top,
        headerOverlap:
          avatars.top <=
          document.querySelector("header").getBoundingClientRect().bottom,
      };
    });
    assert(
      !layout.overflow && !layout.overlap && !layout.headerOverlap,
      JSON.stringify({ width, height, layout }),
    );
  }
  await page.evaluate(() => {
    URL.createObjectURL = function (blob) {
      window.exportedBlob = blob;
      return "blob:test";
    };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#favorites-toggle").click();
  await page
    .getByRole("button", { name: "Экспорт избранного", exact: true })
    .click();
  const favoritesExport = JSON.parse(
    await page.evaluate(() => exportedBlob.text()),
  );
  assert.equal(favoritesExport.type, "favorites");
  assert(favoritesExport.palettes.length > 0);
  assert(favoritesExport.palettes.every((p) => p.favorite === true));
  assert.equal(
    favoritesExport.palettes.length,
    await page.evaluate(() => favoritePalettes.length),
  );
  const beforeImport = await page.evaluate(() => ({
    count: palettes.length,
    existing: palettes.find((p) => !p.favorite),
  }));
  const newFavorite = {
    ...beforeImport.existing,
    id: "favorites-only-import",
    favorite: false,
  };
  const favoritesFile = {
    name: "favorites-only.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        type: "favorites",
        palettes: [
          { ...beforeImport.existing, bg: "#123456" },
          newFavorite,
          newFavorite,
        ],
      }),
    ),
  };
  await page.locator("input[type=file]").setInputFiles(favoritesFile);
  await page.waitForFunction(
    () =>
      document.getElementById("toast").textContent ===
      "Добавлено палитр: 1 · Отмечено существующих: 1",
  );
  assert.equal(
    await page.evaluate(() => palettes.length),
    beforeImport.count + 1,
  );
  const promoted = await page.evaluate(
    (id) => palettes.find((p) => p.id === id),
    beforeImport.existing.id,
  );
  assert.equal(promoted.favorite, true);
  assert.equal(promoted.bg, beforeImport.existing.bg);
  await page.locator("input[type=file]").setInputFiles(favoritesFile);
  await page.waitForFunction(
    () =>
      document.getElementById("toast").textContent ===
      "Добавлено палитр: 0 · Отмечено существующих: 0",
  );
  assert.equal(
    await page.evaluate(() => palettes.length),
    beforeImport.count + 1,
  );
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("generate").disabled,
  );
  assert.equal(
    await page.evaluate(
      (id) => palettes.find((p) => p.id === id).favorite,
      beforeImport.existing.id,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => palettes.find((p) => p.id === "favorites-only-import").favorite,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: add/remove favorites, reload persistence, separate filtered list and empty state, selection, history preserved, export/import and legacy import, favorites-only export/import with deduplication and persistence, 10000-favorite virtualization, tab scroll reset, 5 responsive layouts, no browser errors.",
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
