# Artwork

HTML/CSS композиций — исходники; корневые `dist/artwork/<группа>/` — готовые изображения.
Палитра и шрифт берутся из `@maseaaao/design`.

Команды из корня:

| Команда                           | Результат                                                                  |
| --------------------------------- | -------------------------------------------------------------------------- |
| `bun run build:artwork`           | Автономные HTML в `dist/artwork/html`, без растров                         |
| `bun run render:logo`             | Производные аватара                                                        |
| `bun run render:scenes`           | Сцены OBS из `scenes/layout.json`                                          |
| `bun run render:artwork <группа>` | `banners`, `panels`, `wallpapers`, `brand` или `favicon`; без группы — все |
| `bun run render:all`              | Полный экспорт изображений                                                 |
| `bun run --cwd artwork test`      | Внутренние тесты сцен и геометрии без экспорта                             |

Рендер готовит HTML сам; `--prepared` пропускает подготовку, если она уже выполнена.
`dist/artwork/brand/website` — источник изображений сайта для `build:website`.
`logo/logo.png` и `apps/website/public/assets/maseaaao.tv.png` — защищённые оригиналы;
`render:logo` не генерирует QR. Сохраняйте утверждённые аватар и QR.

CI выполняет экспорт в Linux; локально изображения можно экспортировать и
просматривать в Windows. Учитывайте возможные различия рендера между средами
и просматривайте изменения.
[Подключение сцен](scenes/SETUP.md) · [Дизайн](../docs/design.md).
