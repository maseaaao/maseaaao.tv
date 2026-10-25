import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path, { extname } from 'node:path';
import process from 'node:process';
import {
  type ConfigEnv,
  createServer,
  type PluginOption,
  type ServerOptions,
  type UserConfig,
  type ViteDevServer,
} from 'vite';

interface GuestPage {
  height: number | null;
  label: string;
  path: string;
  width: number | null;
}
interface ProjectPage {
  height: number | null;
  label: string;
  url: string;
  width: number | null;
}
interface ProjectDefinition {
  guestPages?: () => GuestPage[];
  id: string;
  importConfig: () => Promise<UserConfig>;
  label: string;
  pageOnly?: boolean;
  port: number;
}
interface ProjectInfo {
  hint: string | null;
  id: string;
  label: string;
  pages: ProjectPage[];
  url: string | null;
}

const root = new URL('../', import.meta.url).pathname;
const host = '127.0.0.1';
const launcherPort = 5180;
const running: ViteDevServer[] = [];
const info: ProjectInfo[] = [];
const devEnvironment: ConfigEnv = { command: 'serve', isPreview: false, mode: 'development' };

const importDefaultConfig = async (app: string, env: ConfigEnv = devEnvironment) => {
  const module = await import(`../apps/${app}/vite.config.ts`);
  const value = module.default;
  return typeof value === 'function' ? value(env) : value;
};

const artworkRoot = path.resolve(root, 'artwork');
const CANVAS_SIZE = /style="width:(\d+(?:\.\d+)?)px;height:(\d+(?:\.\d+)?)px/;
const HTML_SUFFIX = /\.html$/;
// Композиции с фиксированным canvas задают его размер прямо в разметке;
// остальные страницы адаптивны и в масштабировании не нуждаются.
const pageSize = (source: string): { width: number | null; height: number | null } => {
  const match = source.match(CANVAS_SIZE);
  return match
    ? { height: Number(match[2]), width: Number(match[1]) }
    : { height: null, width: null };
};
const artworkPages = (): GuestPage[] => {
  const pages: GuestPage[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(directory, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (entry.name.endsWith('.html')) {
        const source = prefix + entry.name;
        const size = pageSize(readFileSync(path.join(directory, entry.name), 'utf8'));
        pages.push({ label: source.replace(HTML_SUFFIX, ''), path: `/${source}`, ...size });
      }
    }
  };
  walk(artworkRoot, '');
  return pages.sort((first, second) => first.label.localeCompare(second.label));
};
const artworkOutsideAssets = (): PluginOption => ({
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const name = decodeURIComponent(
        new URL(request.url || '/', 'http://localhost').pathname.slice(1),
      );
      if (name === '' || name.includes('..')) {
        next();
        return;
      }
      const inside = path.resolve(artworkRoot, name);
      const outside = path.resolve(root, name);
      // Всё, что есть внутри artwork, отдаёт сам Vite; из репозитория
      // докармливаем только файлы, на которые ссылаются композиции
      // (QR из apps/website/public, готовые изображения из dist).
      if (!outside.startsWith(root) || existsSync(inside) || !existsSync(outside)) {
        next();
        return;
      }
      const types: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.mp3': 'audio/mpeg',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
      };
      response.setHeader('Content-Type', types[extname(outside)] ?? 'application/octet-stream');
      response.end(readFileSync(outside));
    });
  },
  name: 'artwork-outside-assets',
});
const artworkConfig = async (): Promise<UserConfig> => ({
  appType: 'mpa',
  plugins: [artworkOutsideAssets()],
  root: artworkRoot,
});

const streamInfoRoot = path.resolve(root, 'apps/stream-info');
const prepareStreamInfo = async (): Promise<UserConfig> => {
  const generated = spawn('bun', ['run', 'generate-import'], {
    cwd: streamInfoRoot,
    stdio: 'inherit',
  });
  const code = await new Promise<number>((resolve, reject) => {
    generated.on('error', reject);
    generated.on('close', (closed) => resolve(closed ?? 1));
  });
  if (code !== 0) {
    throw new Error('Не удалось подготовить Streamer.bot Import');
  }
  return importDefaultConfig('stream-info');
};

const definitions: ProjectDefinition[] = [
  {
    id: 'website',
    importConfig: () => importDefaultConfig('website'),
    label: 'Website',
    port: 5181,
  },
  {
    id: 'stream-info',
    importConfig: prepareStreamInfo,
    label: 'Stream Info',
    port: 5182,
  },
  { id: 'tuna', importConfig: () => importDefaultConfig('tuna-widget'), label: 'Tuna', port: 5183 },
  {
    id: 'social-strip',
    importConfig: () =>
      importDefaultConfig('obs-widgets', {
        command: 'serve',
        isPreview: false,
        mode: 'social-strip',
      }),
    label: 'OBS Widgets',
    port: 5184,
  },
  {
    id: 'ui-gallery',
    importConfig: () => importDefaultConfig('ui-gallery'),
    label: 'UI Gallery',
    port: 5185,
  },
  {
    guestPages: artworkPages,
    id: 'artwork',
    importConfig: artworkConfig,
    label: 'Artwork',
    pageOnly: true,
    port: 5186,
  },
];

const projectsData = (): PluginOption => ({
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const target = new URL(request.url || '/', 'http://localhost');
      if (target.pathname !== '/projects.json') {
        next();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ projects: info }));
    });
  },
  name: 'dev-launcher-projects',
});

const listen = async (config: UserConfig, port: number): Promise<string | null> => {
  const options: ServerOptions = { ...config.server, host, port };
  const server = await createServer({ configFile: false, ...config, server: options });
  running.push(server);
  await server.listen();
  return server.resolvedUrls?.local[0] ?? null;
};

const startProject = async (definition: ProjectDefinition): Promise<void> => {
  try {
    const config = await definition.importConfig();
    const url = await listen(config, definition.port);
    const guests = definition.guestPages?.() ?? [];
    const pages = guests.map((guest) => ({
      height: guest.height,
      label: guest.label,
      url: new URL(guest.path, url ?? 'http://localhost/').href,
      width: guest.width,
    }));
    const shown = definition.pageOnly ? null : url;
    info.push({
      hint: shown === null && !definition.pageOnly ? 'Dev-сервер не запустился' : null,
      id: definition.id,
      label: definition.label,
      pages,
      url: shown,
    });
  } catch (error) {
    info.push({
      hint: error instanceof Error ? error.message : String(error),
      id: definition.id,
      label: definition.label,
      pages: [],
      url: null,
    });
  }
};

const start = async (): Promise<string | null> => {
  // Каждый определённый проект слушает свой порт: запуск параллелен, порядок вывода
  // сохраняется за счёт накопления результатов в порядке определений.
  await Promise.all(definitions.map(startProject));
  const launcherRoot = path.resolve(root, 'apps/dev-launcher/src');
  return listen(
    { appType: 'spa', logLevel: 'warn', plugins: [projectsData()], root: launcherRoot },
    launcherPort,
  );
};

const shutdown = async (): Promise<void> => {
  // Серверы независимы друг от друга, закрываются параллельно.
  await Promise.all(running.map((server) => server.close()));
  process.exit(0);
};

process.on('SIGINT', async () => {
  await shutdown();
});
process.on('SIGTERM', async () => {
  await shutdown();
});

try {
  const launcher = await start();
  for (const project of info) {
    console.log(`— ${project.label}: ${project.url ?? project.hint}`);
  }
  console.log(`Меню: ${launcher ?? `http://${host}:${launcherPort}/`}`);
} catch (error) {
  for (const project of info) {
    console.error(`— ${project.label}: ${project.hint}`);
  }
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
}
// Держим процесс живым, пока dev-серверы не остановят по SIGINT/SIGTERM.
await new Promise<never>(() => {
  // Обработчик никогда не вызывает resolve — это и есть намерение.
});
