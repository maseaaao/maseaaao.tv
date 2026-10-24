# Общие настройки сборки

`standaloneConfig({root,outDir,fileName,nonce,budgets})` — Vite 6 + vite-plugin-singlefile. Один HTML на один output. Включает полный OFL и поддерживает nonce существующей CSP. Необязательные `budgets: {html, js}` ограничивают размер готового HTML и суммарный JS в байтах без gzip. `publicDir` выключен: зависимости нужно импортировать из source. Итоговая автономность проверяется тестами и не гарантируется одним наличием плагина.

`providerPlugins()` — postcss-import и postcss-url с inline WOFF2. Специфические placeholders и путь установки принадлежат приложению, а не общему preset.

Пакет применяется Tuna, Stream Info, OBS-виджетами и build-only artwork. Импорт в runtime запрещён. Сайт имеет отдельную MPA-конфигурацию, поскольку ему нужны кешируемые assets и несколько HTML.
