# Разработка в Linux и WSL2

С 23.10.2026 разработка и все задачи CI используют Linux. На Windows команды
выполняются внутри WSL2 с Linux-версиями Node.js, pnpm, Python и .NET SDK.
Не использовать Windows node.exe или pnpm из Windows PATH. Зависимости Linux
устанавливать отдельно от Windows node_modules; предпочтителен checkout внутри
файловой системы WSL2.

Версии: Node.js из `.node-version`, pnpm из `packageManager`, .NET SDK 8,
Python 3 (CI: 3.12). Для рендера нужны Chromium и пакеты из
`tooling/artwork/requirements-fonts.txt`.

```bash
pnpm install --frozen-lockfile
pnpm run browser:install --with-deps
python -m pip install -r tooling/artwork/requirements-fonts.txt
pnpm run check
pnpm run verify:ui-renewal
```

В дистрибутиве должен быть доступен `python` с Python 3, как в CI.

## Companion

Сборка helpers использует SDK-проекты net481, reference assemblies из NuGet
и закреплённые NAudio/Newtonsoft.Json. `packages.lock.json` фиксирует версии
и хеши; CI запрещает их неявное обновление. При намеренном изменении зависимостей
обновить lockfile через `dotnet restore --force-evaluate` для нужного проекта.

```bash
pnpm run test:companion
node --test tests/companion-build.test.mjs
pnpm --filter ./integrations/companion/system-microphone run build
pnpm --filter ./integrations/companion/voice-control run build
pnpm --filter ./integrations/companion/system-microphone run package
pnpm --filter ./integrations/companion/voice-control run package
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
