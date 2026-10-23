# Разработка в Linux и WSL2

Готовые продукты можно получать в Windows независимо от checkout WSL: [релизы и обновлятор](windows-releases.md). `Update-All.ps1` выбирает последние стабильные выпуски всех доступных продуктов, а runtime остаётся в Windows. Это требует первоначального подключения приложений к новым путям; перенос исходников сам по себе не меняет действующие ссылки.

С 23.10.2026 разработка и все задачи CI используют Linux. На Windows команды
выполняются внутри WSL2 с Linux-версиями Node.js, Bun, Python и .NET SDK.
Не использовать Windows node.exe или bun.exe из Windows PATH. Зависимости Linux
устанавливать отдельно от Windows node_modules; предпочтителен checkout внутри
файловой системы WSL2.

Версии: Node.js из `.node-version`, Bun из `.bun-version`, .NET SDK 8,
Python 3 (CI: 3.12). Для рендера нужны Chromium и пакеты из
`tooling/artwork/requirements-fonts.txt`.

## Bun и Node

Bun 1.4.4 закреплён в `.bun-version`. Установите эту версию по официальной инструкции bun.sh для Linux (требуется `unzip`), а не Windows-версию. Для текущей оболочки:

```bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun --version
node --version
```

Добавьте те же строки PATH в профиль своей Linux-оболочки; новый login shell должен находить `bun`. Node выбирается отдельно, строго по `.node-version` (22.23.3). До установки зависимостей проверьте обе версии.

`bunfig.toml` закрепляет `linker = "isolated"`: пакеты не должны полагаться на незаявленные зависимости соседей. Единственный JavaScript-lockfile — `bun.lock`; NuGet `packages.lock.json` сохраняются отдельно. Только `esbuild` и `sharp` перечислены в `trustedDependencies` корневого `package.json`; не разрешать install-скрипты всем зависимостям ради обхода ошибки.

Bun — менеджер пакетов и запускатель package scripts. `node --test`, Node-инструменты, Python и .NET SDK не заменяются Bun; не добавлять `--bun` для принудительного перевода существующих Node-команд.

```bash
bun install --frozen-lockfile
bun run browser:install --with-deps
python3 -m venv .runtime/venv
. .runtime/venv/bin/activate
python -m pip install -r tooling/artwork/requirements-fonts.txt
bun run check
bun run verify:ui-renewal
```

Python-команды корневого `package.json` запускаются через `tooling/run-python.mjs`:
если существует `.runtime/venv/bin/python`, используется он без ручной активации;
иначе — `python` из PATH (в том числе Python, выбранный `setup-python` в CI).
Аргументы и ненулевой код завершения передаются без изменений. Поэтому после
однократной установки requirements в `.runtime/venv` команды `build:fonts`, `full`
и `verify:ui-renewal` работают и в новом терминале. Launcher не устанавливает
зависимости автоматически. В окружении без venv должен быть доступен `python`
с Python 3, как в CI.

### Ubuntu 26.04

Закреплённый Playwright 1.58.2 пока не содержит сборку `ubuntu26.04-x64`.
Для этой версии Ubuntu перед установкой Chromium и браузерными проверками используйте:

```bash
export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64
bun run browser:install
```

Это выбор Linux-бинарника Chromium, не Windows-версии и не смена версии Playwright.
Системные библиотеки Chromium должны быть установлены отдельно. В текущем WSL-окружении
переменная добавлена условно для Ubuntu 26.04 в login-профили; CI не меняет платформу.


## Companion

Сборка helpers использует SDK-проекты net481, reference assemblies из NuGet
и закреплённые NAudio/Newtonsoft.Json. `packages.lock.json` фиксирует версии
и хеши; CI запрещает их неявное обновление. При намеренном изменении зависимостей
обновить lockfile через `dotnet restore --force-evaluate` для нужного проекта.

```bash
bun run test:companion
node --test tests/companion-build.test.mjs
bun run --filter ./integrations/companion/system-microphone build
bun run --filter ./integrations/companion/voice-control build
bun run --filter ./integrations/companion/system-microphone package
bun run --filter ./integrations/companion/voice-control package
python integrations/companion/shared/test-packages.py
```

Готовые EXE и tgz предназначены для Windows. Сборка их не запускает и не
устанавливает. Порядок обновления существующих соединений с сохранением настроек:
[Companion](../integrations/companion/README.md).

## Проверка C# Streamer.bot

Проверка против DLL установленного приложения доступна из WSL2:

```bash
export STREAMERBOT_ROOT='/mnt/d/GoogleDrives/maxxborer-drive/Проекты/maseaaao/OBS/Streamer.bot'
python tooling/local/compile-streamerbot.py
```

Компиляция выполняется во временном каталоге и не загружает Actions.
Она не заменяет проверку Execute Code внутри Streamer.bot.

## Что сохранено для Windows

Streamer.bot, Bitfocus Companion и OBS работают непосредственно в Windows.
Их EXE/DLL, установленные модули, конфигурации и резервные копии не удаляются.
Сохранены `integrations/companion/start-companion.ps1`, контроллер медиасессии
Яндекс Музыки и Windows-обёртка живой диагностики `tooling/local/check-stream-stack.ps1`:
они обслуживают работающие приложения и существующие ярлыки.

Удалены отдельный Windows runner CI, патч Storybook для Windows, PowerShell
загрузчик DLL и его тесты, PowerShell-компиляторы helpers и C# Actions.
Старые копии средств обслуживания внутри установки Streamer.bot и исторические
отчёты не являются поддерживаемыми исходниками репозитория; их сохранность
нужна для существующих запускателей и восстановления.
