import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const DEFAULT_BASE_WIDTH = 2560;
const DEFAULT_BASE_HEIGHT = 1440;
const DEFAULT_CAPTURE_FORMAT = "webp";
const DEFAULT_CAPTURE_QUALITY = 100;
const SCENE_TIMEOUT_MS = 20000;
const SCRIPT_PATH = path.resolve(
  process.argv[1] ?? "scripts/render-scenes.mjs",
);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const options = parseCliOptions(process.argv.slice(2));
const BASE_WIDTH = readPositiveIntegerOption(
  options.width,
  "--width",
  DEFAULT_BASE_WIDTH,
);
const BASE_HEIGHT = readPositiveIntegerOption(
  options.height,
  "--height",
  DEFAULT_BASE_HEIGHT,
);
const CAPTURE_FORMAT = readCaptureFormatOption(options.format);
const CAPTURE_QUALITY = readScreenshotQualityOption(
  options.quality,
  "--quality",
  DEFAULT_CAPTURE_QUALITY,
);
const TRANSPARENT_BACKGROUND = readBooleanFlagOption(
  options.transparent,
  "--transparent",
  false,
);
const SCENES_DIR = resolveRepoPath(options.scenesDir ?? "src/scenes");
const OUTPUT_DIR = options.outputDir
  ? resolveRepoPath(options.outputDir)
  : path.join(SCENES_DIR, "rendered");
const SCENE_FILE = options.scene;

if (
  SCENE_FILE &&
  (path.basename(SCENE_FILE) !== SCENE_FILE ||
    path.extname(SCENE_FILE).toLowerCase() !== ".html")
) {
  throw new Error("--scene must be the name of one HTML file in --scenes-dir.");
}

if (TRANSPARENT_BACKGROUND && CAPTURE_FORMAT === "jpeg") {
  throw new Error(
    "--transparent requires png or webp because jpeg does not support alpha.",
  );
}

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
]);

async function main() {
  assertPathInside(REPO_ROOT, SCENES_DIR, "Scenes directory");
  await assertDirectoryExists(SCENES_DIR, path.relative(REPO_ROOT, SCENES_DIR));
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  const scenes = await discoverScenes();
  if (scenes.length === 0) {
    throw new Error(`No HTML scenes found in ${SCENES_DIR}.`);
  }

  const chromeBinary = await resolveChromeBinary();
  let server = null;
  let browser = null;
  let context = null;
  let failures = 0;

  try {
    server = await startStaticServer(REPO_ROOT);
    browser = await chromium.launch({
      executablePath: chromeBinary,
      headless: true,
      args: [
        "--disable-gpu",
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
      ],
    });
    context = await browser.newContext({
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      viewport: { width: BASE_WIDTH, height: BASE_HEIGHT },
    });

    console.log(`Serving ${REPO_ROOT} at ${server.origin}`);
    console.log(`Using Chrome: ${chromeBinary}`);
    console.log(
      `Rendering ${path.relative(REPO_ROOT, SCENES_DIR)} at ${BASE_WIDTH}x${BASE_HEIGHT}`,
    );

    for (const scene of scenes) {
      const page = await context.newPage();

      try {
        const sceneUrl = `${server.origin}${scene.urlPath}`;
        await page.goto(sceneUrl, {
          waitUntil: "load",
          timeout: SCENE_TIMEOUT_MS,
        });
        await waitForSceneReady(page, SCENE_TIMEOUT_MS);
        await page.waitForTimeout(250);

        const outputPath = path.join(
          OUTPUT_DIR,
          `${scene.basename}.${CAPTURE_FORMAT}`,
        );
        const bytes = await captureScreenshot(page);
        await writeAtomically(outputPath, bytes);
        console.log(
          `[ok] ${scene.fileName} -> ${path.relative(REPO_ROOT, outputPath)}`,
        );
      } catch (error) {
        failures += 1;
        console.error(`[fail] ${scene.fileName}: ${formatError(error)}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await Promise.allSettled([
      context?.close(),
      browser?.close(),
      closeServer(server?.server),
    ]);
  }

  if (failures > 0) {
    console.error(`Finished with ${failures} failed scene(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Rendered ${scenes.length} scene(s) to ${path.relative(REPO_ROOT, OUTPUT_DIR)}.`,
  );
}

async function assertDirectoryExists(directoryPath, label) {
  let stats;

  try {
    stats = await fs.promises.stat(directoryPath);
  } catch {
    throw new Error(
      `Expected ${label} at ${directoryPath}, but it was not found.`,
    );
  }

  if (!stats.isDirectory()) {
    throw new Error(
      `Expected ${label} at ${directoryPath}, but it is not a directory.`,
    );
  }
}

async function discoverScenes() {
  const entries = await fs.promises.readdir(SCENES_DIR, {
    withFileTypes: true,
  });

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".html" &&
        (!SCENE_FILE || entry.name === SCENE_FILE),
    )
    .map((entry) => ({
      basename: path.basename(entry.name, ".html"),
      fileName: entry.name,
      urlPath: toUrlPath(
        path.relative(REPO_ROOT, path.join(SCENES_DIR, entry.name)),
      ),
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));
}

function parseCliOptions(args) {
  const aliases = new Map([
    ["height", "height"],
    ["format", "format"],
    ["output-dir", "outputDir"],
    ["quality", "quality"],
    ["scene", "scene"],
    ["scenes-dir", "scenesDir"],
    ["transparent", "transparent"],
    ["width", "width"],
  ]);
  const booleanFlags = new Set(["transparent"]);
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const separatorIndex = arg.indexOf("=");
    const rawKey = arg.slice(
      2,
      separatorIndex === -1 ? undefined : separatorIndex,
    );
    const key = aliases.get(rawKey);
    if (!key) {
      throw new Error(`Unknown option: --${rawKey}`);
    }

    let value =
      separatorIndex === -1 ? undefined : arg.slice(separatorIndex + 1);
    if (booleanFlags.has(key)) {
      if (
        value === undefined &&
        (args[index + 1] === "true" || args[index + 1] === "false")
      ) {
        index += 1;
        value = args[index];
      }

      parsed[key] = value === undefined ? "true" : value;
      continue;
    }

    if (value === undefined) {
      index += 1;
      value = args[index];
    }

    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value for --${rawKey}.`);
    }

    parsed[key] = value;
  }

  return parsed;
}

function readBooleanFlagOption(value, label, fallback) {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${label} must be true or false when a value is provided.`);
}

function readPositiveIntegerOption(value, label, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    String(parsed) !== String(value)
  ) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function readCaptureFormatOption(value) {
  if (value === undefined) {
    return DEFAULT_CAPTURE_FORMAT;
  }

  const normalized = value.toLowerCase();
  if (normalized === "jpeg" || normalized === "png" || normalized === "webp") {
    return normalized;
  }

  throw new Error("--format must be one of: jpeg, png, webp.");
}

function readScreenshotQualityOption(value, label, fallback) {
  const parsed = readPositiveIntegerOption(value, label, fallback);

  if (parsed > 100) {
    throw new Error(`${label} must be between 1 and 100.`);
  }

  return parsed;
}

function resolveRepoPath(value) {
  if (path.isAbsolute(value)) {
    return path.resolve(value);
  }

  return path.resolve(REPO_ROOT, value);
}

function assertPathInside(rootDir, candidatePath, label) {
  const relativePath = path.relative(rootDir, candidatePath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return;
  }

  throw new Error(
    `${label} must be inside ${path.relative(REPO_ROOT, rootDir)}.`,
  );
}

function toUrlPath(relativePath) {
  const segments = relativePath
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment));
  return `/${segments.join("/")}`;
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        await handleStaticRequest(rootDir, request, response);
      } catch (error) {
        response.writeHead(500, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end(`Internal server error: ${error.message}`);
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.off("error", reject);
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        server,
      });
    });
  });
}

async function handleStaticRequest(rootDir, request, response) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed.");
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const filePath = resolveRequestPath(rootDir, url.pathname);

  if (!filePath) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden.");
    return;
  }

  let stats;

  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.");
    return;
  }

  if (!stats.isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found.");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType =
    CONTENT_TYPES.get(extension) ?? "application/octet-stream";
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": String(stats.size),
    "content-type": contentType,
  });

  if (method === "HEAD") {
    response.end();
    return;
  }

  const bytes = await fs.promises.readFile(filePath);
  response.end(bytes);
}

function resolveRequestPath(rootDir, urlPath) {
  let relativePath;

  try {
    relativePath = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  if (relativePath === "/" || relativePath === "") {
    relativePath = "/index.html";
  }

  if (relativePath.endsWith("/")) {
    relativePath = `${relativePath}index.html`;
  }

  const normalizedPath = path.normalize(relativePath.replace(/^[/\\]+/, ""));
  const absolutePath = path.resolve(rootDir, normalizedPath);
  const rootPrefix = rootDir.endsWith(path.sep)
    ? rootDir
    : `${rootDir}${path.sep}`;

  if (absolutePath !== rootDir && !absolutePath.startsWith(rootPrefix)) {
    return null;
  }

  return absolutePath;
}

async function resolveChromeBinary() {
  const candidates = [];

  if (process.env.CHROME_BIN) {
    candidates.push(process.env.CHROME_BIN);
  }

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  }

  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    );
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
    );
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      await fs.promises.access(candidate, fs.constants.F_OK);
      return candidate;
    } catch {
      // Keep scanning candidates.
    }
  }

  const hint = process.env.CHROME_BIN
    ? ` CHROME_BIN=${process.env.CHROME_BIN}`
    : "";
  throw new Error(`Google Chrome binary not found.${hint}`.trim());
}

async function waitForSceneReady(page, timeoutMs) {
  await page.evaluate(async (timeout) => {
    const requiredFonts = ["Inter", "Unbounded"];
    const requiredFontSample = "AaBb0123456789АБВабвЯя";

    const waitForImages = async () => {
      const imagePromises = Array.from(document.images, (image) => {
        const finalizeDecode = () => {
          if (typeof image.decode === "function") {
            return image.decode().catch(() => {});
          }

          return Promise.resolve();
        };

        if (image.complete) {
          if (image.naturalWidth === 0) {
            throw new Error(
              `Image failed to load: ${image.currentSrc || image.src || "<unknown>"}`,
            );
          }

          return finalizeDecode();
        }

        return new Promise((resolve, reject) => {
          const cleanup = () => {
            image.removeEventListener("load", handleLoad);
            image.removeEventListener("error", handleError);
          };

          const handleLoad = () => {
            cleanup();
            resolve();
          };

          const handleError = () => {
            cleanup();
            reject(
              new Error(
                `Image failed to load: ${image.currentSrc || image.src || "<unknown>"}`,
              ),
            );
          };

          image.addEventListener("load", handleLoad, { once: true });
          image.addEventListener("error", handleError, { once: true });
        }).then(finalizeDecode);
      });

      await Promise.all(imagePromises);
    };

    const normalizeFontFamily = (fontFamily) =>
      fontFamily.replace(/^["']|["']$/g, "");

    const waitForRequiredFonts = async () => {
      const visibleText = document.body.innerText.replace(/\s+/g, "");
      if (!visibleText) {
        return;
      }

      const fontFaces = Array.from(document.fonts);
      const missingRegistrations = requiredFonts.filter((fontFamily) => {
        return !fontFaces.some(
          (fontFace) => normalizeFontFamily(fontFace.family) === fontFamily,
        );
      });

      if (missingRegistrations.length > 0) {
        throw new Error(
          `Required fonts not registered: ${missingRegistrations.join(", ")}`,
        );
      }

      const missingFonts = [];

      for (const fontFamily of requiredFonts) {
        const fontDescriptor = `400 16px "${fontFamily}"`;
        await document.fonts.load(fontDescriptor, requiredFontSample);

        if (!document.fonts.check(fontDescriptor, requiredFontSample)) {
          missingFonts.push(fontFamily);
        }
      }

      if (missingFonts.length > 0) {
        throw new Error(`Required fonts not ready: ${missingFonts.join(", ")}`);
      }
    };

    const readyPromise = (async () => {
      await document.fonts.ready;
      await waitForRequiredFonts();
      await waitForImages();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    })();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Timed out after ${timeout}ms waiting for fonts and images.`,
          ),
        );
      }, timeout);
    });

    await Promise.race([readyPromise, timeoutPromise]);
  }, timeoutMs);
}

async function captureScreenshot(page) {
  const screenshot = await page.screenshot({
    type: "png",
    fullPage: false,
    omitBackground: TRANSPARENT_BACKGROUND,
  });

  if (CAPTURE_FORMAT === "png") {
    return screenshot;
  }

  let formatOptions;
  if (CAPTURE_FORMAT === "jpeg") {
    formatOptions = { quality: CAPTURE_QUALITY, chromaSubsampling: "4:4:4" };
  } else if (CAPTURE_FORMAT === "webp" && TRANSPARENT_BACKGROUND) {
    formatOptions = { lossless: true };
  } else {
    formatOptions = { quality: CAPTURE_QUALITY };
  }

  return sharp(screenshot).toFormat(CAPTURE_FORMAT, formatOptions).toBuffer();
}

async function writeAtomically(destinationPath, bytes) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, bytes);

  try {
    await fs.promises.rename(tempPath, destinationPath);
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "EPERM") {
      throw error;
    }

    await fs.promises.rm(destinationPath, { force: true });
    await fs.promises.rename(tempPath, destinationPath);
  }
}

async function closeServer(server) {
  if (!server || !server.listening) {
    return;
  }

  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function formatError(error) {
  if (!error || typeof error.message !== "string") {
    return "Unknown error.";
  }

  return error.message.split("\n")[0];
}

await main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
