# Интеграции

`streamerbot`: DonationAlerts, OBS Health. `companion`: System Microphone 1.3.1, VoiceStream 1.1.1, общий помощник процесса и переносимый запускатель. Текущие установленные копии остаются вне репозитория.

Не запускать интеграции ради проверки переноса. Команды сборки в корневом README создают пакеты, не устанавливая их. DonationAlerts требует приватную глобальную переменную daClientSecret; реальный секрет в исходниках отсутствует. [Порядок подключения](../docs/local-installation.md), [сверка custom](../docs/custom-migration.md).
