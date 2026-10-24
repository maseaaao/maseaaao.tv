# Релиз

Один тег `vX.Y.Z`, один выпуск, один архив `maseaaao-X.Y.Z.zip`.
Внутри — отдельные папки продуктов и `updater/`. Модули Companion сохраняют
свои версии для штатного импорта TGZ, но отдельные GitHub-релизы им не нужны.
1. Добавить описание выпуска в корневой `CHANGELOG.md` под `## X.Y.Z`.
2. Проверить исходники: `bun run check` и `bun run test:releases`.
3. Собрать и проверить комплект локально:

```bash
python tooling/bundle-release.py --build v1.0.0
python tooling/bundle-release.py v1.0.0
```

Результат: `build/release/v1.0.0/`. Нужны инструменты разработки из README,
браузер и зависимости `tooling/artwork/requirements-fonts.txt`.
4. Закоммитить изменения, создать тег на этом коммите и отправить его.
Workflow `Release` собирает комплект и создаёт черновик.
5. Проверить архив и опубликовать черновик в GitHub Releases.

Существующий выпуск не перезаписывается. Для исправления опубликованного
комплекта выпустить новую версию. Релиз не публикует сайт в Cloudflare и
не меняет работающие OBS, Streamer.bot или Companion.

[Установка в Windows](windows-releases.md).
