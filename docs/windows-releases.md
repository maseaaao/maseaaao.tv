# Windows-комплект

Один релиз `vN`: полный комплект `maseaaao-N.zip`, отдельные архивы
`maseaaao-<продукт>-N.zip` и общий `SHA256SUMS` с хешами всех ZIP.
В каждом архиве — продукт или весь комплект, лицензии и эта инструкция как `INSTALL.md`.
Структура папок одинакова: отдельный архив можно распаковать рядом с другими продуктами.
OBS, Streamer.bot и Companion устанавливаются отдельно; рабочие базы, настройки
и токены в комплект не входят. Обновлятора нет.

## Установка и обновление

1. Скачайте полный ZIP или только нужные продукты и `SHA256SUMS` одного выпуска
   из GitHub Releases репозитория `maseaaao/maseaaao.tv`. Проверьте хеш каждого
   скачанного ZIP по соответствующей строке `SHA256SUMS`:

   ```powershell
   Get-FileHash -Algorithm SHA256 '.\maseaaao-42.zip'
   ```

   Отдельные архивы: `maseaaao-stream-info-N.zip`, `maseaaao-tuna-widget-N.zip`,
   `maseaaao-obs-widgets-N.zip`, `maseaaao-artwork-N.zip`,
   `maseaaao-system-microphone-N.zip`, `maseaaao-voice-stream-N.zip`,
   `maseaaao-windows-integrations-N.zip` и `maseaaao-website-N.zip`.

2. Распакуйте ZIP в новый пустой каталог Windows. Сохраните прежний комплект,
   штатные экспорты приложений, изменённые ресурсы и предыдущие TGZ для отката.
3. Вне эфира подключите ресурсы через интерфейсы приложений, сохраняя ID,
   размеры, положение и URL-параметры. Если нужен прежний путь, закройте приложения,
   использующие файлы, и замените папку, оставив старую для отката.
4. Перезагрузите доки/браузерные источники OBS, проверьте пути и отображение.
   Распаковка не импортирует C#, TGZ или CSS провайдеров.

Пути относительно распакованного комплекта:

| Продукт              | Что подключить                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Stream Info          | `stream-info/change-info-streamer-bot.ru.html` — док; остальные файлы папки — HTTP-маппинг |
| Tuna                 | `tuna-widget/obs-tuna-widget.html` — браузерный источник                                   |
| OBS widgets          | `obs-widgets/social-strip/`; HTML/CSS/JS провайдеров устанавливаются в их интерфейсах      |
| Artwork              | Изображения в `artwork/`                                                                   |
| Companion            | TGZ из `system-microphone/` и `voice-stream/`                                              |
| Windows integrations | `windows-integrations/README.md`, запускатель, `diagnostics/`, C# и звуки в `actions/`     |
| Website              | `website/` — статические файлы; распаковка не публикует сайт                               |

Stream Info API импортируется отдельно из `stream-info/streamerbot-import.txt`.
Остальной C# обновляйте в существующих Actions с сохранением ID и компиляцией
Execute Code. Пути к звукам настройте на MP3 в `windows-integrations/actions/`.
Секрет DonationAlerts храните в приватной переменной `daClientSecret` Streamer.bot.

Перед импортом Companion проверьте `dataFlow=capture|render` и endpoint ID
SystemMicrophone; у VoiceStream — два разных UUID включённых Actions запуска/остановки.
При недостающих настройках остановите обновление. Импортируйте TGZ и выберите версии
в существующих соединениях, сохранив ID, кнопки, feedback и секреты.
Сверьте `moduleVersionId`, состояние и журнал без запуска звука или эфира.

Для запускателя и диагностики нужен Windows Bun; Companion использует комплектный Node:

```text
bun windows-integrations/start-companion.ts --streamerbot-root <полный-путь>
bun windows-integrations/diagnostics/check-stream-stack-cli.ts --streamerbot-root <полный-путь>
```

Запускателю нужны Windows Script Host/WMI и соседний `companion-processes.wsf`.
Ошибка проверки процесса блокирует запуск. Диагностика сохраняет отчёт в
`custom/maintenance/stream-stack-latest.json` установки Streamer.bot.
Не редактируйте живые базы и настройки на диске при работающем приложении.

## Откат

Верните прежнюю папку или пути ресурсов через интерфейсы приложений.
Отдельно верните C# в прежние Actions и версии модулей в тех же соединениях;
при необходимости восстановите совместимый штатный экспорт.
Возврат файлов не откатывает импорт. Не копируйте базу поверх работающего приложения.

## Выпуск для разработчика

После успешного push в `main` workflow `Release` обновляет один управляемый
черновик. До его обновления выполняются полная сборка, проверки, тесты и упаковка.
`[skip release]` в заголовке последнего коммита push оставляет прежний черновик
без изменений; CI всё равно выполняется. Текст в теле коммита не учитывается.

Номер `N` — `github.run_number` workflow `Release`. Пропуски допустимы;
повторный запуск того же run использует тот же номер. Все версии продуктов
в сборке — `2.0.N`, включая manifest и TGZ Companion. Подготовка меняет только
рабочую копию CI после frozen install: отдельных bump-коммитов и изменений
`bun.lock` нет. Номер `vN` относится ко всему комплекту.

Откройте черновик в GitHub Releases, проверьте SHA, архивы, хеши и описание,
затем нажмите **Publish release**. До этого тег не создаётся. Следующий push
после публикации подготовит новый черновик; опубликованные релизы не меняются.
Ручные черновики без служебной метки workflow не затрагивает.
Описание формируется автоматически; ручной раздел changelog для каждого номера не нужен.
Публикуйте черновик после завершения workflow, а не во время загрузки файлов:
обновление метаданных и вложений GitHub не является одной атомарной операцией.

Для локальной подготовки без публикации (Linux/WSL2, Bun из `.bun-version`,
.NET SDK 8, `tar` и Chromium) используйте свободный номер:

```bash
bun tooling/prepare-release.ts 42
bun run full
bun run build:companion
bun run package:companion
bun run check
bun run test
bun run verify:companion
bun tooling/bundle-release.ts v42
```

Подготовка версий меняет product metadata в текущей рабочей копии; это не нужно
коммитить. Упаковщик читает готовые результаты, ничего не пересобирает и сохраняет
общий ZIP, отдельные ZIP продуктов и `SHA256SUMS` в `dist/release/v42/`.
Состав — `tooling/release-products.json`; отдельные архивы берут файлы из того же
набора, что и полный комплект, без повторной сборки.
Кеши и прежние архивы в комплект не входят.

Workflow также можно запустить вручную из `main` через **Run workflow**.
Публикация релиза не публикует сайт и не меняет работающие приложения.
Деплой сайта — отдельный ручной workflow **Deploy website**: он скачивает
`cloudflare-dist` выбранного успешного запуска Release и загружает готовые
файлы без повторной сборки. Artifact хранится 30 дней и не зависит от публикации
GitHub Release. [Настройка и запуск](../apps/website/README.md#публикация-из-github-actions).
