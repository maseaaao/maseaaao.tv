import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_TARGETS = ["apps/website/public", "artwork"];
const IMAGE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

async function main() {
  const targets = process.argv.slice(2);
  const roots = targets.length > 0 ? targets : DEFAULT_TARGETS;
  const files = [];

  for (const root of roots) {
    const rootPath = resolveRepoPath(root);
    await collectImageFiles(rootPath, files);
  }

  if (files.length === 0) {
    console.log("No optimizable images found.");
    return;
  }

  const results = [];

  for (const file of files.sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    try {
      results.push(await optimizeImage(file));
    } catch (error) {
      results.push({
        file,
        kind: "failed",
        message: error?.message ?? "Unknown error",
        saved: 0,
      });
    }
  }

  printSummary(results);
}

function resolveRepoPath(value) {
  if (path.isAbsolute(value)) {
    return path.resolve(value);
  }

  return path.resolve(REPO_ROOT, value);
}

async function collectImageFiles(directoryPath, files) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await collectImageFiles(entryPath, files);
      }

      continue;
    }

    if (
      entry.isFile() &&
      IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(entryPath);
    }
  }
}

async function optimizeImage(file) {
  const extension = path.extname(file).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return optimizeJpeg(file);
  }

  if (extension === ".png") {
    return optimizeWithSharp(file, "png");
  }

  return optimizeWithSharp(file, "webp");
}

async function optimizeJpeg(file) {
  const workDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "maseaaao-images-"),
  );
  const outputFile = path.join(workDirectory, "optimized.jpg");
  const originalSize = await getFileSize(file);

  try {
    const input = await fs.readFile(file);
    await sharp(input)
      .keepMetadata()
      .jpeg({ mozjpeg: true, quality: 100 })
      .toFile(outputFile);

    return await keepIfSmaller(file, outputFile, originalSize);
  } catch (error) {
    await removeIfExists(outputFile);
    throw error;
  } finally {
    await fs
      .rm(workDirectory, { force: true, recursive: true })
      .catch(() => {});
  }
}

async function optimizeWithSharp(file, format) {
  const workDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "maseaaao-images-"),
  );
  const tempFile = path.join(
    workDirectory,
    `optimized${path.extname(file).toLowerCase()}`,
  );
  const originalSize = await getFileSize(file);
  const input = await fs.readFile(file);
  const image = sharp(input, { animated: true }).keepMetadata();

  try {
    let output;

    if (format === "png") {
      output = await image
        .png({
          adaptiveFiltering: true,
          compressionLevel: 9,
          effort: 10,
        })
        .toBuffer();
    } else {
      output = await image
        .webp({
          effort: 6,
          lossless: true,
        })
        .toBuffer();
    }

    await fs.writeFile(tempFile, output);

    return await keepIfSmaller(file, tempFile, originalSize);
  } catch (error) {
    await removeIfExists(tempFile);
    throw error;
  } finally {
    await fs
      .rm(workDirectory, { force: true, recursive: true })
      .catch(() => {});
  }
}

async function keepIfSmaller(file, tempFile, originalSize) {
  const optimizedSize = await getFileSize(tempFile);

  if (optimizedSize >= originalSize) {
    await removeIfExists(tempFile);
    return {
      file,
      kind: "kept",
      saved: 0,
    };
  }

  try {
    await replaceFile(tempFile, file);
  } catch (error) {
    await removeIfExists(tempFile);

    if (error?.code === "EPERM" || error?.code === "EACCES") {
      return {
        file,
        kind: "kept",
        message: `optimized copy was smaller but could not replace original (${error.code})`,
        saved: 0,
      };
    }

    throw error;
  }

  return {
    file,
    kind: "optimized",
    saved: originalSize - optimizedSize,
  };
}

async function getFileSize(file) {
  const stats = await fs.stat(file);
  return stats.size;
}

async function removeIfExists(file) {
  await fs.rm(file, { force: true }).catch(() => {});
}

async function replaceFile(sourceFile, destinationFile) {
  try {
    await fs.rename(sourceFile, destinationFile);
    return;
  } catch (error) {
    if (error?.code === "EXDEV") {
      await fs.copyFile(sourceFile, destinationFile);
      await fs.rm(sourceFile, { force: true });
      return;
    }

    if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
      throw error;
    }
  }

  await fs.rm(destinationFile, { force: true });
  await fs.rename(sourceFile, destinationFile);
}

function printSummary(results) {
  let optimized = 0;
  let kept = 0;
  let failed = 0;
  let saved = 0;

  for (const result of results) {
    const relativeFile = path.relative(REPO_ROOT, result.file);

    if (result.kind === "optimized") {
      optimized += 1;
      saved += result.saved;
      console.log(`[ok] ${relativeFile} saved ${formatBytes(result.saved)}`);
    } else if (result.kind === "kept") {
      kept += 1;
      console.log(
        `[keep] ${relativeFile}${result.message ? `: ${result.message}` : ""}`,
      );
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

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

await main().catch((error) => {
  console.error(error?.message ?? "Image optimization failed.");
  process.exitCode = 1;
});
