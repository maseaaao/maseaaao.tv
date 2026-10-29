# Ресурсы OBS

Соцполоса, шаблон чата Streamlabs и CSS DonationAlerts для alerts и донатеров.

```bash
bun run build:widgets
```

Команда выполняется из корня. Исходники — `src/`, готовые ресурсы — в корневом `dist/obs-widgets/`:

| Ресурс                                                         | Подключение                       |
| -------------------------------------------------------------- | --------------------------------- |
| `social-strip/index.html`                                      | Локальный браузерный источник OBS |
| `streamlabs-chat/chat-box.html`, `chat-box.css`, `chat-box.js` | Поля HTML, CSS и JS в Streamlabs  |
| `streamlabs-chat/donationalerts-alerts.css`                    | CSS оповещений DonationAlerts     |
| `donors/donationalerts-stream-stats.css`                       | CSS статистики DonationAlerts     |

Соцполоса автономна и во всех сценах выглядит одинаково: без скруглений.
Для разных ширин нужны отдельные browser inputs с нативными viewport:
640×88 для горизонтальных статусных сцен, 480×88 для горизонтального gameplay,
720×88 для вертикальных статусных сцен, 1080×88 для вертикальных камеры и
gameplay. Полоса горизонтальной камеры берётся из входа 1080×88 и масштабируется
равномерно до 1280×104.3 — OBS не отрисовывает browser sources шире 1080 px.
Каждый input открывает локальный файл той же страницы
`file:///C:/path/to/obs-widgets/social-strip/index.html` (поле локального файла).
Существующий общий input 1080×64 не меняйте: его растяжение не заменяет
отдельные источники. Подробности — в
[карте и подключении сцен](../../artwork/scenes/SETUP.md).

Браузерные тесты: `bun run --filter @maseaaao/obs-widgets test`. Для системного
Chromium задайте `CHROME_BIN`; тесты не подключаются к OBS и провайдерам.
CSS провайдеров содержит встроенные шрифт и лицензию.
Провайдер управляет данными, сменой и удалением сообщений. Его placeholders,
обработчики и задержки нужно сохранять. Шаблон CSS Streamlabs нельзя напрямую
вставлять в OBS override: `prepareObsChatCss` из
`tooling/local/obs-provider-css.ts` адаптирует его с сохранением размера текста.

Сборка не обновляет OBS и аккаунты провайдеров. Для копирования локальных
ресурсов и отдельной установки provider CSS см. [подключение](../../docs/local-installation.md).

[Общие правила оформления](../../docs/design.md).
