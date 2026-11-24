# Происхождение WantedFrame

На 25 ноября 2026 года `MikhailMostWanted/WFHelper` (GitHub ID `1372999604`) остаётся публичным форком `WFHelper/WFHelper`. WantedFrame — утверждённое имя продукта. Уведомление `Copyright (c) 2026 WFHelper` сохранено без изменений. Оно совпадает с файлом в общем предке и в текущем upstream. [Исходная лицензия MIT](../LICENSE).

## Вклад и ревизии

Общий предок `2e0d9552e9360fac4b86c37cc26593aedc4714a9`. С этого коммита `WFHelper/WFHelper:main` (`06fa689715b0488eb6345b3b1649425cd5a268c8`) ушёл вперёд на 206 коммитов. В `MikhailMostWanted/WFHelper:main` (`eabaa6e1c9b52b11383ab7f53a61aadb7be4ca5d`) два отдельных коммита, в `feat/wantedframe-next` (`3032361635d5f8a525a2f4c7544c031b412377e9`) их 55. Счёт включает автоматизацию и весь вклад в ветку. [Граф и diff preview](https://github.com/MikhailMostWanted/WFHelper/compare/2e0d9552e9360fac4b86c37cc26593aedc4714a9...3032361635d5f8a525a2f4c7544c031b412377e9).

| Что реализовано | Где появилось |
| --- | --- |
| Desktop-клиент Electron, инвентарь, рынок, Кузница, реликвии, базовые оверлеи и анализ `EE.log` | Унаследовано от WFHelper. [Upstream на общем предке](https://github.com/WFHelper/WFHelper/tree/2e0d9552e9360fac4b86c37cc26593aedc4714a9) |
| Русский UI, варианты поиска на рынке и русский разбор наград | Доработки форка в [`384bdea7`](https://github.com/MikhailMostWanted/WFHelper/commit/384bdea7). Подготовка сборки под именем WantedFrame начинается в [`89ecc2fb`](https://github.com/MikhailMostWanted/WFHelper/commit/89ecc2fb) |
| Экспорт снимка и приватный MCP, интерфейс и оверлеи, остатки ресурсов и валют событий | Доработки ветки preview. [Экспорт и MCP](https://github.com/MikhailMostWanted/WFHelper/commit/b9ecfd55), [интерфейс](https://github.com/MikhailMostWanted/WFHelper/commit/c7c641c6), [остатки](https://github.com/MikhailMostWanted/WFHelper/commit/4484add5) |
| Русская витрина, SVG и фрагмент синтетических данных | Открытый [PR #3](https://github.com/MikhailMostWanted/WFHelper/pull/3/files) в `feat/wantedframe-next`. Его head `f4980b6bb8146683bc2c12e2e4d56e1acbbaaa76` добавляет два docs-коммита и меняет 14 файлов README и документации |

<a id="bundled-assets"></a>

## Лицензии поставки

- В опубликованном `0.3.0-preview.3` есть уведомления Electron и Chromium. В `app.asar` присутствует исходный `assets/OFL-Onest.txt`. MIT-уведомление WFHelper в пакете отсутствует. В следующих сборках по текущей конфигурации оно копируется в `resources/LICENSE.WFHelper.txt`. Packaged smoke сверяет MIT и OFL с исходными файлами побайтно.
- `resources/riven-ocr/yolo/stat_line_detector.onnx` унаследован от WFHelper. В ONNX указана лицензия AGPL-3.0 и автор Ultralytics. Для выпуска нужно установить происхождение весов и обучающих материалов, обязательства по исходникам и условия распространения выбранной комплектации. Для конверсии `ch_PP-OCRv3_rec_infer.onnx` и словаря тоже нужна отдельная сверка источника. [Лицензирование моделей Ultralytics](https://www.ultralytics.com/license) · [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR).
- Игровые названия, данные, графика и логотипы имеют собственные условия. Проверьте включённые в `assets/` изображения и демо-кадры по источнику. Digital Extremes допускает некоммерческое использование по Content Policy и требует письменного согласия на использование своих логотипов. [Warframe Content Policy](https://www.warframe.com/en/contentpolicy) · [Warframe EULA](https://www.warframe.com/en/eula).

## План технической миграции

Имя продукта можно использовать в интерфейсе и документации. Возможное имя репозитория `wanted-frame` требует отдельного решения. Компоненты с постоянной идентичностью включают `com.wfhelper.app`, пакет `wantedframe`, профиль `WantedFrame` и миграцию старых пользовательских папок. Конфигурация обновлений, URL backend и OAuth, MCP и схема снимка имеют собственный цикл совместимости.

1. Перед согласованием rename снять список всех refs и проверить восстановление из Git bundle. Сохранить отдельно release assets, контрольные суммы, PR, права, настройки Actions и журнал проверок. Зафиксировать идентификатор репозитория и текущие URL.
2. Найти все обращения к старому `owner/repo`, включая `build.publish`, обновление клиента, ссылки в документации, pin Actions, badges и release URLs. В изолированной проверке подтвердить переходы старых ссылок и загрузку старых релизов. GitHub не перенаправляет вызовы Actions из переименованного репозитория. [Правила GitHub для rename](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).
3. Для отдельного решения об отделении сверить наличие **Settings → General → Danger Zone → Leave fork network**. API на дату проверки показывает публичный репозиторий размером `57365` KiB и ноль дочерних форков. GitHub предупреждает о потере метаданных PR, issues, комментариев и других связанных данных. [Правила GitHub для detach](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork).
4. Согласовать переход только после проверки восстановления, ссылок и обновления со старого профиля. Для rename предусмотреть возврат старого имени и URL updater при наличии подтверждённого доступа. Само отделение от сети форков необратимо.

Для оформления WANTED Labs используйте проверенные исходники знака и лицензированные материалы. Текущие иллюстрации README показывают сценарии и синтетические данные. Ссылку на каталог WANTED следует добавить после подтверждения публичного адреса.
