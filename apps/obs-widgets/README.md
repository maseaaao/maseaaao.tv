# Ресурсы OBS

Русские интерфейсы соцполосы и статистики, оформление чата Streamlabs, CSS DonationAlerts, звуки. Используются только Unbounded и системный Arial. Общие токены и шрифт подготавливаются командой build:website; CSS и HTML автономны.

`npm run sync:local -- --product widgets` показывает назначения, `--apply` обновляет локальные ресурсы с резервными копиями. Публикация CSS в Streamlabs/DonationAlerts выполняется через интерфейс сервиса. Единственный исходник CSS донатеров — donors/donationalerts-stream-stats.css.
