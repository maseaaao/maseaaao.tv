/** One-time, idempotent migration of the ten pre-standard published release descriptions. */
import { spawnSync } from 'node:child_process';

interface Section {
  changes: string[];
  title: string;
}
interface HistoryEntry {
  previousTag?: string;
  sections: Section[];
  tag: string;
}
interface Release {
  body: string | null;
  draft: boolean;
  id: number;
  prerelease: boolean;
  tag_name: string;
}

const repo = 'maseaaao/maseaaao.tv';
const marker = '<!-- maseaaao:auto-release -->';
const notesVersion = '<!-- maseaaao:release-notes:v1 -->';
const history: HistoryEntry[] = [
  {
    sections: [
      {
        changes: [
          'Добавлены Twitch-плеер на главной странице, LIVE-статус и чат ([#5](https://github.com/maseaaao/maseaaao.tv/pull/5), [#6](https://github.com/maseaaao/maseaaao.tv/pull/6)).',
          'Добавлены OBS-сцены и анимации интерфейсов ([#8](https://github.com/maseaaao/maseaaao.tv/pull/8), [#12](https://github.com/maseaaao/maseaaao.tv/pull/12)).',
          'Добавлен звуковой файл для цензуры ([#2](https://github.com/maseaaao/maseaaao.tv/pull/2)).',
        ],
        title: 'Новые возможности',
      },
      {
        changes: [
          'Переработаны лендинг, стили, тексты, доступность и SEO ([#4](https://github.com/maseaaao/maseaaao.tv/pull/4), [#7](https://github.com/maseaaao/maseaaao.tv/pull/7), [#8](https://github.com/maseaaao/maseaaao.tv/pull/8)).',
          'Унифицированы пакеты дизайна и сборка монорепозитория ([#10](https://github.com/maseaaao/maseaaao.tv/pull/10)).',
        ],
        title: 'Улучшения',
      },
    ],
    tag: 'v23',
  },
  {
    previousTag: 'v23',
    sections: [
      {
        changes: [
          'Перестроен выпуск релизов: CI, управляемый черновик, проверка перед публикацией и раздельные сценарии деплоя ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/475c93d7cccae20bc18a6de7494e4836329026c3)).',
        ],
        title: 'Технические изменения',
      },
    ],
    tag: 'v25',
  },
  {
    previousTag: 'v25',
    sections: [
      {
        changes: [
          'Домен maseaaao.tv закреплён в настройках маршрутов Cloudflare Worker, чтобы развёртывание не сбрасывало его привязку ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/33961514ab13ba5e56d4cbe6b337a486aca29581)).',
        ],
        title: 'Исправления',
      },
    ],
    tag: 'v26',
  },
  {
    previousTag: 'v26',
    sections: [
      {
        changes: [
          'Устранены подтверждённые проблемы, выявленные полным аудитом проекта, включая обработку обновлений Twitch, интеграции и окружение разработки ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/1e031c7ff24dee034f5cc6658161eadc485f87f6), [#14](https://github.com/maseaaao/maseaaao.tv/pull/14)).',
          'Восстановлена полоса с никнеймом в игровых OBS-сценах ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/a9819f074937c3348a5c3ab4b6a251e1a2c5306e)).',
        ],
        title: 'Исправления',
      },
      {
        changes: [
          'Переработано размещение донатов, камеры и социальных элементов в OBS-сценах ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/9d377f4b)).',
          'Обновлены оформление и проверки проекта по результатам ревью ([сравнение](https://github.com/maseaaao/maseaaao.tv/compare/v26...v33)).',
        ],
        title: 'Улучшения',
      },
    ],
    tag: 'v33',
  },
  {
    previousTag: 'v33',
    sections: [
      {
        changes: [
          'Доработано оформление OBS-сцен и док-панели Stream Info ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/ed225991e1c91648cad66cd8876b35916bae83ee)).',
        ],
        title: 'Улучшения',
      },
    ],
    tag: 'v34',
  },
  {
    previousTag: 'v34',
    sections: [
      {
        changes: [
          'Унифицированы палитра, типографика и анимации интерфейсов ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/e3e4de27)).',
          'Обновлены логотип, сцены и панели Twitch в рамках фирменной палитры ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/728fe8ce)).',
          'Доработаны виджет социальных сетей, CSS для провайдеров и шаблон с токеном `$s` ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/f50d5e31)).',
        ],
        title: 'Улучшения',
      },
      {
        changes: [
          'Обновлены интеграции проверки OBS и управления микрофоном ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/9d86b3d5)).',
        ],
        title: 'Технические изменения',
      },
    ],
    tag: 'v35',
  },
  {
    previousTag: 'v35',
    sections: [
      {
        changes: [
          'Основной синий цвет бренда изменён на `#1616D9` ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/2ceb9bd3)).',
          'Переработаны hover-состояния кнопок и иконки платформ на лендинге ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/56c9a13f)).',
        ],
        title: 'Улучшения',
      },
    ],
    tag: 'v36',
  },
  {
    previousTag: 'v36',
    sections: [
      {
        changes: [
          'Исправлена контрастность текста на тёмных поверхностях при наведении ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/ac32856c272a433f1593037da8e7734194235938)).',
        ],
        title: 'Исправления',
      },
    ],
    tag: 'v37',
  },
  {
    previousTag: 'v37',
    sections: [
      {
        changes: [
          'Добавлены цели по подписчикам Twitch ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/9889decd20fe071a570b62379a2b057d970148c4)).',
        ],
        title: 'Новые возможности',
      },
      {
        changes: [
          'Приведены к единому виду макеты стрима и связанные виджеты ([коммит](https://github.com/maseaaao/maseaaao.tv/commit/9889decd20fe071a570b62379a2b057d970148c4)).',
        ],
        title: 'Улучшения',
      },
    ],
    tag: 'v38',
  },
  {
    previousTag: 'v38',
    sections: [
      {
        changes: [
          'Исправлен выход содержимого лендинга за границы на промежуточных ширинах экрана ([#15](https://github.com/maseaaao/maseaaao.tv/pull/15)).',
        ],
        title: 'Исправления',
      },
    ],
    tag: 'v39',
  },
];

function isRelease(value: unknown): value is Release {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'number' &&
    'tag_name' in value &&
    typeof value.tag_name === 'string' &&
    'body' in value &&
    (typeof value.body === 'string' || value.body === null) &&
    'draft' in value &&
    typeof value.draft === 'boolean' &&
    'prerelease' in value &&
    typeof value.prerelease === 'boolean'
  );
}

function gh(args: string[]): string {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'GitHub CLI failed');
  }
  return result.stdout;
}

function formatNotes(entry: HistoryEntry): string {
  const sections = entry.sections.map(
    (section) => '## ' + section.title + '\n' + section.changes.map((item) => '- ' + item).join('\n'),
  );
  const url = 'https://github.com/' + repo + (entry.previousTag
    ? '/compare/' + entry.previousTag + '...' + entry.tag
    : '/commits/' + entry.tag);
  sections.push('**Полный список изменений:** ' + url);
  return marker + '\n' + notesVersion + '\n\n' + sections.join('\n\n');
}

if (import.meta.main) {
  if (process.env.GITHUB_REPOSITORY !== repo) {
    throw new Error('Backfill is restricted to ' + repo);
  }
  const raw: unknown = JSON.parse(gh(['api', 'repos/' + repo + '/releases?per_page=100', '--paginate', '--slurp']));
  if (!Array.isArray(raw)) {
    throw new Error('Unexpected release list response');
  }
  const releases: Release[] = raw.flatMap((page: unknown) => {
    if (!Array.isArray(page) || !page.every(isRelease)) {
      throw new Error('Unexpected release page response');
    }
    return page.filter(isRelease);
  });
  let updated = 0;
  for (const entry of history) {
    const release = releases.find((item) => item.tag_name === entry.tag);
    if (!release || release.draft || release.prerelease || !release.body?.includes(marker)) {
      throw new Error('Unexpected historical release state: ' + entry.tag);
    }
    if (release.body.includes(notesVersion)) {
      continue;
    }
    const body = formatNotes(entry);
    const response: unknown = JSON.parse(
      gh(['api', 'repos/' + repo + '/releases/' + release.id, '--method', 'PATCH', '--raw-field', 'body=' + body]),
    );
    if (!isRelease(response) || response.body !== body || response.tag_name !== entry.tag || response.draft) {
      throw new Error('Release update verification failed: ' + entry.tag);
    }
    updated += 1;
    console.log('Updated historical release ' + entry.tag);
  }
  console.log('Historical release notes updated: ' + updated + '/' + history.length);
}
