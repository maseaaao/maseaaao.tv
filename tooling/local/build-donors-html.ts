// Builds a standalone DonationAlerts stream-stats page with the repository CSS baked in.
// Hosts without a custom CSS field (TikTok LIVE Studio) can open the file directly or
// load it from the optional local server. The token never enters the repository: pass the
// widget URL with --url or keep it in .runtime/da-donors.url, which is ignored by git.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectWidget, type Payload, renderPage, signature } from '../donors-page.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_OUTPUT = path.join(ROOT, '.runtime/da-donors/stream-stats.html');
const DEFAULT_URL_FILE = path.join(ROOT, '.runtime/da-donors.url');
const DEFAULT_CSS = path.join(ROOT, 'dist/obs-widgets/donors/donationalerts-stream-stats.css');

interface Options {
  css: string;
  interval: number;
  out: string;
  port: number;
  serve: boolean;
  url?: string;
  watch: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    css: DEFAULT_CSS,
    interval: 6000,
    out: DEFAULT_OUTPUT,
    port: 7411,
    serve: false,
    watch: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      const next = argv[index];
      if (!next || next.startsWith('-')) {
        throw new Error(`Missing value for ${argument}`);
      }
      return next;
    };
    switch (argument) {
      case '--url':
        options.url = value();
        break;
      case '--out':
        options.out = path.resolve(value());
        break;
      case '--css':
        options.css = path.resolve(value());
        break;
      case '--interval':
        options.interval = Number(value());
        if (!Number.isFinite(options.interval) || options.interval < 1000) {
          throw new Error('--interval must be at least 1000 ms');
        }
        break;
      case '--watch':
        options.watch = true;
        break;
      case '--serve':
        options.serve = true;
        break;
      case '--port':
        options.port = Number(value());
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
          throw new Error('--port must be a valid TCP port');
        }
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function dataSource(payload: Payload): string {
  return `window.__DONORS_LIVE__ = ${JSON.stringify(payload)};\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const css = await readFile(options.css, 'utf8').catch(() => {
    throw new Error(`Donor CSS not found at ${options.css}; run "bun run build:widgets" first`);
  });
  const rawUrl =
    options.url ??
    (
      await readFile(DEFAULT_URL_FILE, 'utf8').catch(() => {
        throw new Error(`Pass --url or put the widget link into ${DEFAULT_URL_FILE}`);
      })
    ).trim();
  const dataPath = path.join(path.dirname(options.out), 'data.js');

  let { payload, title } = await collectWidget(rawUrl, options.interval);
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, renderPage({ css, initial: payload, title }));
  await writeFile(dataPath, dataSource(payload));
  console.log(`Wrote ${options.out}`);
  if (!options.serve) {
    console.log(
      `Open in TikTok LIVE Studio as a Browser/Link source: ${pathToFileURL(options.out).href}`,
    );
  }
  console.log(`Rows: ${payload.rows.length}, interval: ${payload.interval} ms`);

  if (options.serve) {
    const directory = path.dirname(options.out);
    const page = path.basename(options.out);
    const server = createServer(async (request, response) => {
      const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
      const name = pathname === '/' ? page : pathname.slice(1);
      if (pathname === '/favicon.ico') {
        response.writeHead(204).end();
        return;
      }
      if (name !== page && name !== 'data.js') {
        response.writeHead(404).end('Not found');
        return;
      }
      try {
        const body = await readFile(path.join(directory, name));
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': name.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : 'text/html; charset=utf-8',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end('Not found');
      }
    });
    server.on('error', (error) => {
      console.error(`Serve failed: ${error.message}`);
    });
    server.listen(options.port, '127.0.0.1', () => {
      console.log(`Serving http://127.0.0.1:${options.port}/${page}`);
    });
  }

  if (!options.watch) {
    return;
  }
  let last = signature(payload);
  const tick = async (): Promise<void> => {
    try {
      const next = await collectWidget(rawUrl, options.interval);
      if (signature(next.payload) !== last) {
        ({ payload } = next);
        last = signature(payload);
        await writeFile(dataPath, dataSource(payload));
        console.log(`Updated ${dataPath} at ${payload.updatedAt}`);
      }
    } catch (error) {
      console.error(
        `Watch update failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    setTimeout(tick, 15_000);
  };
  setTimeout(tick, 15_000);
  await new Promise<never>(() => {
    // Keep the watch process alive until it is interrupted.
  });
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
