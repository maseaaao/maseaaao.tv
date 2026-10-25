import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

interface OptimizationResult {
  file: string;
  kind: 'kept' | 'failed' | 'optimized';
  message?: string;
  saved: number;
}
const errorCode = (error: unknown): unknown =>
  error instanceof Error && 'code' in error ? error.code : undefined;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DEFAULT_TARGETS = [
  'dist/artwork/banners',
  'dist/artwork/brand',
  'dist/artwork/scenes',
  'dist/artwork/twitch-description',
  'dist/artwork/wallpapers',
];
const protectedFiles = new Set(
  ['artwork/logo/logo.png', 'apps/website/public/assets/maseaaao.tv.png'].map((name) =>
    path.join(REPO_ROOT, name),
  ),
);
const IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp']);
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

async function main() {
  const targets = process.argv.slice(2);
  const roots = targets.length > 0 ? targets : DEFAULT_TARGETS;
  const files: string[] = [];

  for (const root of roots) {
    // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
    await collectImageFiles(path.resolve(REPO_ROOT, root), files);
  }

  if (files.length === 0) {
    console.log('No optimizable images found.');
    return;
  }

  const results: OptimizationResult[] = [];

  for (const file of files.sort((left, right) => left.localeCompare(right, 'en'))) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
      results.push(await optimizeImage(file));
    } catch (error) {
      results.push({
        file,
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        saved: 0,
      });
    }
  }

  printSummary(results);
}

async function collectImageFiles(directoryPath: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        // biome-ignore lint/performance/noAwaitInLoops: Process assets sequentially to bound Chromium and image encoder memory.
        await collectImageFiles(entryPath, files);
      }

      continue;
    }

    if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
}

async function optimizeImage(file: string): Promise<OptimizationResult> {
  if (protectedFiles.has(file)) {
    return { file, kind: 'kept', message: 'protected original', saved: 0 };
  }
  const extension = path.extname(file).toLowerCase();
  let format: 'jpeg' | 'png' | 'webp';
  if (extension === '.jpg' || extension === '.jpeg') {
    format = 'jpeg';
  } else if (extension === '.png') {
    format = 'png';
  } else {
    format = 'webp';
  }
  const options = {
    jpeg: { mozjpeg: true, quality: 100 },
    png: { adaptiveFiltering: true, compressionLevel: 9, effort: 10 },
    webp: { effort: 6, lossless: true },
  };
  const input = await fs.readFile(file);
  const output = await sharp(input, { animated: format !== 'jpeg' })
    .keepMetadata()
    .toFormat(format, options[format])
    .toBuffer();
  if (output.length >= input.length) {
    return { file, kind: 'kept', saved: 0 };
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maseaaao-images-'));
  try {
    const temporary = path.join(directory, `optimized${extension}`);
    await fs.writeFile(temporary, output);
    try {
      await replaceFile(temporary, file);
    } catch (error) {
      if (errorCode(error) !== 'EPERM' && errorCode(error) !== 'EACCES') {
        throw error;
      }
      return {
        file,
        kind: 'kept',
        message: `optimized copy was smaller but could not replace original (${errorCode(error)})`,
        saved: 0,
      };
    }
    return { file, kind: 'optimized', saved: input.length - output.length };
  } finally {
    await fs.rm(directory, { force: true, recursive: true }).catch(() => {
      /* Очистка временной директории не критична: файл может уже отсутствовать. */
    });
  }
}

async function replaceFile(sourceFile: string, destinationFile: string) {
  try {
    await fs.rename(sourceFile, destinationFile);
    return;
  } catch (error) {
    if (errorCode(error) === 'EXDEV') {
      await fs.copyFile(sourceFile, destinationFile);
      await fs.rm(sourceFile, { force: true });
      return;
    }

    if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'EPERM') {
      throw error;
    }
  }

  await fs.rm(destinationFile, { force: true });
  await fs.rename(sourceFile, destinationFile);
}

function printSummary(results: OptimizationResult[]) {
  let optimized = 0;
  let kept = 0;
  let failed = 0;
  let saved = 0;

  for (const result of results) {
    const relativeFile = path.relative(REPO_ROOT, result.file);

    if (result.kind === 'optimized') {
      optimized += 1;
      saved += result.saved;
      console.log(`[ok] ${relativeFile} saved ${formatBytes(result.saved)}`);
    } else if (result.kind === 'kept') {
      kept += 1;
      console.log(`[keep] ${relativeFile}${result.message ? `: ${result.message}` : ''}`);
    } else {
      failed += 1;
      console.warn(`[fail] ${relativeFile}: ${result.message}`);
    }
  }

  console.log(
    `Optimized ${optimized} image(s), kept ${kept}, failed ${failed}. Saved ${formatBytes(saved)}.`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

await main().catch((error) => {
  console.error(error?.message ?? 'Image optimization failed.');
  process.exitCode = 1;
});
