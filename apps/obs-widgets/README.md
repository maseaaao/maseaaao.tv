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

Соцполоса автономна; CSS провайдеров содержит встроенные шрифт и лицензию.
Провайдер управляет данными, сменой и удалением сообщений. Его placeholders,
обработчики и задержки нужно сохранять. Шаблон CSS Streamlabs нельзя напрямую
вставлять в OBS override: `prepareObsChatCss` из
`tooling/local/obs-provider-css.ts` адаптирует его с сохранением размера текста.

Сборка не обновляет OBS и аккаунты провайдеров. Для копирования локальных
ресурсов и отдельной установки provider CSS см. [подключение](../../docs/local-installation.md).

[Общие правила оформления](../../docs/design.md).
