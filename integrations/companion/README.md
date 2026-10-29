# Companion

Windows-модули: SystemMicrophone управляет системным аудиоустройством,
VoiceStream — Actions запуска/остановки. Исходники не являются рабочими настройками.

## Сборка и проверка

Из корня, с Bun, .NET SDK 8 и совместимым системным `tar`:

```bash
bun run test:companion
bun run --filter ./integrations/companion/system-microphone check
bun run --filter ./integrations/companion/voice-control check
bun run build:companion
bun run package:companion
bun run verify:companion
```

Сборка, упаковка и проверка готовых TGZ выполняются отдельными командами. NuGet-зависимости
закреплены в `packages.lock.json`. Установленный Streamer.bot для сборки не нужен;
тесты используют подставные обработчики.
Локально можно работать в Windows; CI собирает и проверяет пакеты в Linux.
Упаковка вызывает `tar` с `--no-recursion`, `-czf` и `-C`; при проблемах
с путями или форматом TGZ в Windows проверяйте её также в Linux CI.

Готовые продукты находятся в корневом `dist/companion/system-microphone/` и
`dist/companion/voice-control/`. В каждом каталоге — `main.js`, EXE помощника и
его DLL, `companion/manifest.json`, `companion/HELP.md` и runtime `package.json`
(`type: module`). Companion загружает ESM default export как конструктор модуля.
Помощник остаётся рядом с `main.js`; общие исходники и
JavaScript-зависимости включаются в bundle, поэтому результат не зависит от
репозитория или соседнего продукта. Эти каталоги можно переносить целиком.

Упаковка читает готовые бинарники из этих каталогов и кладёт туда же TGZ и payload:
`request.json` для SystemMicrophone, `install.json` для VoiceStream. Структура TGZ
прежняя: один каталог с ID модуля, внутри `main.js`, EXE/DLL, `package.json` и
`companion/{manifest.json,HELP.md}`. Все пути разрешаются относительно исходников,
а не текущего рабочего каталога. Упаковка и проверка не запускают модули и помощники.

Общий `Directory.Build.props` направляет .NET output/intermediate всех проектов,
включая `StreamerbotTests`, в `dist/.cache/dotnet/<имя проекта>/{bin,obj}/`.
При сборке Companion `--output` кладёт финальные EXE/DLL непосредственно в каталог
продукта; старые исходные `bin/` и `obj/` исключены из стандартных .NET glob.

## Импорт

1. Сохраните штатный экспорт Companion и предыдущие TGZ для отката.
2. У SystemMicrophone проверьте явный `dataFlow=capture` или `render` и endpoint ID.
   У VoiceStream — два различных UUID существующих включённых Actions запуска/остановки.
   При недостающих настройках остановите обновление.
3. Импортируйте TGZ через менеджер модулей и выберите версии в существующих соединениях.
   Сохраняйте ID, кнопки, назначения, feedback и секреты.
4. Сверьте `moduleVersionId`, настройки, состояние и журнал без запуска звука или эфира.
   Для отката выберите предыдущие версии либо восстановите совместимый штатный экспорт.

Не запускайте `main.js` или EXE помощников напрямую для проверки.
Не подменяйте базы и JSON работающего приложения.

Для отдельной проверки формата готовых entrypoint задайте `COMPANION_NODE_BIN`
с путём к комплектному Node.js Companion и выполните
`bun integrations/companion/shared/test-entrypoints.ts` из корня. Проверка только
импортирует классы: не создаёт экземпляры, не вызывает `init` и не запускает помощники.

Настройки модулей: [SystemMicrophone](system-microphone/companion/HELP.md),
[VoiceStream](voice-control/companion/HELP.md).
Запускатель и диагностика: [подключение](../../docs/local-installation.md).
