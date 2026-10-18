# Независимые выпуски

Stream Info и Tuna имеют собственные версии и теги `stream-info-vX.Y.Z` и `tuna-widget-vX.Y.Z`. Изменять версию продукта, CHANGELOG и корневой lockfile. Модули Companion также требуют согласованной версии package.json/manifest.json.

После проверки исходников собрать продукт и выполнить `python tooling/package-release.py <тег>`. Артефакты — build/release: русский HTML и ZIP с лицензией. Stream Info сохраняет имя change-info-streamer-bot.ru.html, Tuna — obs-tuna-widget.html.

После явного решения о выпуске отправить тег. Workflow сверяет версию, выполняет тесты и сборку, создаёт черновик релиза, скачивает его в build/downloaded и проверяет совпадение. Для Tuna устанавливается Chromium с системными зависимостями. Существующие выпуски не перезаписываются.

Публиковать черновик после проверки скачанного HTML в OBS. Общий releases/latest объединяет разные продукты; давать ссылки на конкретные теги. Исторический change-info-streamer-bot хранит прежнюю историю и выпуски; разработка ведётся здесь.
