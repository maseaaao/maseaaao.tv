import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The transitive `source` task of the task graph.
//
// It exists so that a change in a shared package propagates to every product
// that consumes it, without building anything. The task hashes the sources of
// its own package, so Turbo can tell whether the consumers may be reused.
//
// The task prints the source digest and writes nothing: the products keep
// their own build outputs, and the digests stay reproducible.
//
// The script is invoked through the workspace root and receives the package
// directory as an argument, so it never depends on the working directory.

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = resolve(process.argv[2] ?? process.cwd());
const ignored = new Set([
  'node_modules',
  'dist',
  'bin',
  'obj',
  'rendered',
  '.turbo',
  '.build-cache',
]);
const extensions = new Set([
  '.ts',
  '.tsx',
  '.vue',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.md',
]);

function collect(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path, files);
    else if (entry.isFile() && extensions.has(path.slice(path.lastIndexOf('.')))) files.push(path);
  }
  return files;
}

const files = collect(packageRoot).sort();
let bytes = 0;
for (const file of files) bytes += statSync(file).size;
console.log(
  `Source digest for ${relative(root, packageRoot) || '.'}: ${files.length} files, ${bytes} bytes`,
);
