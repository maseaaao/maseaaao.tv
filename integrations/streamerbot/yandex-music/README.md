> Исходники перенесены в `maseaaao.tv`. Ниже — описание исходной установленной конфигурации. Относительные пути и результаты старых проверок относятся к прежней папке; текущие инструкции — в `docs/local-installation.md` от корня репозитория.

# Яндекс Музыка — управление из Streamer.bot

Установлены четыре Actions в группе `YANDEX MUSIC CONTROL`:

- `Yandex Music Control | play` — начать/продолжить воспроизведение.
- `Yandex Music Control | pause` — поставить на паузу.
- `Yandex Music Control | next` — следующий трек.
- `Yandex Music Control | previous` — предыдущий трек.

Команды адресуются медиасессии приложения `ru.yandex.desktop.music` через Windows. Фокус окна не нужен. Приложение должно быть запущено; если медиасессия ещё не появилась, один раз включите трек вручную. Другие плееры не выбираются в качестве запасного варианта. Play и pause — отдельные команды, повторное нажатие не переключает состояние обратно.

Привязки кнопок и триггеры не добавлены. Существующие YTM Actions и их привязки сохранены. В настройках контроллера выберите новые Actions, когда будете готовы перейти.

`control.ps1` — обработчик Windows PowerShell 5.1, `Action.cs` — шаблон установленного C# кода. Не перемещайте обработчик отдельно от конфигурации: Actions используют его абсолютный путь. Ошибки и успешные команды записываются в лог Streamer.bot с префиксом `[YandexMusic]`.

Проверено 21.09.2026 через HTTP API запущенного Streamer.bot: pause дважды сохраняет Paused; play дважды сохраняет Playing; next меняет трек; previous возвращает предыдущий. Результаты — `verification.json`.

До добавления сохранена резервная копия `backup/yandex-music-before-20260921-214031/actions.json`. Все 46 существующих Actions, включая пять YTM Actions, сохранены без изменений. Всего после установки — 50 Actions.

Справка по используемым интерфейсам: [Windows media sessions](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession), [Streamer.bot DoAction](https://docs.streamer.bot/api/http/requests/do-action).
