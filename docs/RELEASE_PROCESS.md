# Собственные сборки: источник, проверка и выпуск

Репозиторий `MikhailMostWanted/WFHelper` публикует собственные Windows preview, исторически под именем WantedFrame. Окончательное имя не утверждено; существующая `com.wfhelper.app` и пользовательский профиль сохраняются.

## Текущий проверенный выпуск

- [v0.3.0-preview.3](https://github.com/MikhailMostWanted/WFHelper/releases/tag/v0.3.0-preview.3).
- `WantedFrame-0.3.0-preview.3-Setup.exe`, 243499021 байт.
- `SOURCE_REVISION.txt` и `build-info.json` указывают `3032361635d5f8a525a2f4c7544c031b412377e9`.
- `build-info` содержит run `38898562926`; [его Windows preview pipeline](https://github.com/MikhailMostWanted/WFHelper/actions/runs/38898562926) завершён успешно.
- Сопутствующий `.sha256` объявляет `d83b2147973633cd12897d2b8508ceab7e1900daadbc17ae07b16bf607e11138`. Это опубликованная контрольная сумма: независимое скачивание и хеширование самого EXE в docs-проходе не выполнялось.
- В четырёх собственных опубликованных релизах на 2026-11-05 есть Windows EXE; Linux AppImage и macOS package не опубликованы.

`package.json.version=0.0.0` — placeholder исходников, не версия скачанного installer. Preview pipeline задаёт свою artifact-only версию; release pipeline получает версию из тега.

## Что делают существующие workflows

| Событие | Поведение |
| --- | --- |
| Push/PR обычной рабочей ветки | CI и Secret Scan. Проверки могут использовать synthetic native/Electron fixtures на GitHub runner, а не рабочий экран владельца. |
| Push `feat/wantedframe-next` | `wantedframe-next.yml`: подготовка exact SHA, JSON/ZIP checks, Windows preview artifact, provenance и package smoke. Этот workflow сам не публикует release. |
| Push `feat/wantedframe-brand` | Специальный preview workflow может создать/обновить `v0.1.0`. Не использовать эту ветку для docs PR. |
| Тег `v*` | Release workflow требует CI, собирает Windows и Linux, создаёт/наполняет release. |
| Публикация release | Отдельный workflow отправляет Discord announcement. |
| Scheduled backend smoke | Проверяет внешний backend; это не локальная offline-проверка. |

## Следующий собственный выпуск

1. Выбрать точный commit, подтвердить scope и целевую платформу. Docs PR в `feat/wantedframe-next` не переносит автоматически всю ветку в `main`.
2. Пройти CI и package acceptance выбранной цели. Windows native OCR с русским языком, реальные кадры и lifecycle/профиль проверять отдельно; успешный ONNX fixture их не заменяет.
3. До обновления сохранить пользовательский профиль, подтвердить прежние appId/подпись/installer identity и путь обновления без очистки данных. Не проверять это удалением рабочего профиля.
4. Сопоставить версию, SHA, checksum, build-info, release notes и реальные файлы. Не обещать отсутствующую Linux/macOS поставку.
5. Публиковать и объявлять выпуск только согласованным действием владельца. Учитывать автоматические действия тега и release publication; не создавать тег ради проверки README.
6. После публикации проверить доступность asset links и обновить README по реально опубликованной поставке.

В этом проходе разрешена рабочая docs-ветка и PR. Теги, installer publication, announcements, установка приложения, перехват клавиш, OCR и торговые действия не выполняются.
