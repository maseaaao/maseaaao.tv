# Ресурсы OBS

Русские интерфейсы соцполосы и статистики, оформление чата Streamlabs, CSS DonationAlerts и звуки. Исходники — src, готовые ресурсы — dist. `npm run build:widgets` собирает отдельные продукты и provider-форматы; исходники и соседние приложения не переписываются.

## Автономные HTML

`social-strip/SocialStrip.vue` и `output-stats/OutputStats.vue` компилируются официальным Vue SSR. Общий `vuePagePlugin` вставляет готовую разметку/стили до обработки Vite/singlefile. Vue runtime/компилятор в клиентских chunks запрещены. Соцполоса содержит только CSS/SVG и не требует JS; прежний цикл подсветки пяти логотипов — 15 секунд, reduced-motion оставляет все логотипы видимыми. Совместимый `transparent.png` сохраняется побайтово.

Статистика использует общие FieldInput/AppButton. Контроллер OBS WebSocket сохранён; кроме перемещения CSS import добавлены только роли строк/ячеек. API, poll 500 ms, timeout 5000 ms, пороги/лимиты, AES-GCM/IndexedDB/localStorage и имена ключей не менялись. Строгая CSP с прежним nonce, `style-src-attr 'none'` и `trusted-types 'none'` сохранена — клиентского Vue здесь нет, policy `vue` не нужна.

Все восемь столбцов статистики доступны на узком экране через локальную горизонтальную прокрутку с клавиатурным фокусом. Журнал прокручивается отдельно. Основная страница остаётся в границах viewport, контролы имеют 44 px, текст допускает 200%. Интерфейсы светлые, Unbounded 400/Arial; соцполоса сохраняет прозрачные углы.

`node --test tests/obs-widgets.test.mjs tests/obs-widgets-residual.test.mjs` проверяет готовые HTML с подставным OBS, CSP, remember/reopen/forget на изолированных данных, клавиатуру, текст, размеры и alpha. В Storybook — те же SFC без контроллера и сетевых подключений. Проверки macOS/Chromium не заменяют Windows 11/OBS CEF; версии и целевая приёмка отмечаются в плане.

## Установка

`npm run sync:local -- --product widgets` показывает назначения, `--apply` обновляет локальные ресурсы с резервными копиями. Публикация CSS в Streamlabs/DonationAlerts выполняется отдельно через интерфейс сервиса. Единственный исходник CSS донатеров — src/donors/donationalerts-stream-stats.css. Сборка не обновляет рабочие источники/настройки OBS и не запускает эфир.
