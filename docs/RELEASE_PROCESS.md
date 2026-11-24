# Собственные сборки: источник, проверка и выпуск

WantedFrame публикует Windows preview из `MikhailMostWanted/WFHelper`. `com.wfhelper.app` связывает сборки с существующей установкой. Совместимость профиля и обновлений проверяется отдельно от названия продукта.

## Проверка опубликованного Windows preview

- `v0.3.0-preview.3` от 16 октября 2026 года помечен Pre-release. `v0.1.0` остаётся Latest. [Список опубликованных сборок](https://github.com/MikhailMostWanted/WFHelper/releases).
- `WantedFrame-0.3.0-preview.3-Setup.exe`, 243499021 байт.
- SHA-256 скачанного EXE `d83b2147973633cd12897d2b8508ceab7e1900daadbc17ae07b16bf607e11138` совпал с `.sha256` и digest GitHub. SHA-512 совпал с `latest.yml`. У NSIS нет подписи Authenticode. Внутри архива `WantedFrame.exe` для Windows x64.
- Тег, внешний `SOURCE_REVISION.txt`, внешний `build-info.json` и файлы `.electron-build` внутри `app.asar` указывают ревизию `3032361635d5f8a525a2f4c7544c031b412377e9`. Внутри пакета совпадают версия `0.3.0-preview.3` и run `38898562926`. [Артефакт и метаданные](https://github.com/MikhailMostWanted/WFHelper/releases/tag/v0.3.0-preview.3).
- В логе `38898562926` под Windows Server 2025 запущен `release/win-unpacked/WantedFrame.exe`. Клиент открыл мастер первого запуска на чистом профиле, загрузил sharp и обе ONNX-модели и завершился без ошибки. Это проверка упакованного приложения. Выполнение NSIS, апгрейд и откат ещё требуют приёмки. [Windows package smoke](https://github.com/MikhailMostWanted/WFHelper/actions/runs/38898562926/job/116965119819).
- В четырёх опубликованных сборках присутствуют Windows EXE. AppImage и пакетов macOS среди этих артефактов нет.

В `package.json` исходников версия `0.0.0`. Preview pipeline подставляет версию артефакта, а release pipeline получает версию из тега.

## Инвентарь и рынок на синтетических данных

В [Windows E2E на ревизии preview](https://github.com/MikhailMostWanted/WFHelper/actions/runs/38898563033) прошли три шарда. Тесты проверяют чтение helper JSON, остатки событий при неполном справочнике, доступность книги заявок, редактирование заявок и обработку ошибок через IPC и тестовый транспорт. Можно повторить с подготовленными fixtures после установки зависимостей и сборки.

```sh
pnpm run build
pnpm run test:e2e:built e2e/event-resources.spec.ts e2e/inventory-orderbook-reachable.spec.ts e2e/market.spec.ts e2e/market-reprice.spec.ts
```

Для тестов используйте временный профиль и синтетические данные. Игровой аккаунт, настоящие заявки, покупка и продажа требуют отдельной проверки с разрешёнными данными и доступом. [Изоляция тестов](../VERIFICATION.md#isolation-and-artifacts).

<a id="market-api"></a>

## Условия Warframe.market

На 25 ноября 2026 года Terms of Service §11 устанавливает предел 3 запроса в секунду для listings и 10 в минуту для contracts. Для публичных приложений нужно предварительно связаться с командой Warframe.market. Использование данных вне личных и учебных задач допускается для функций, которых нет на сайте. Копируемые сообщения должны следовать формату сайта и включать название приложения. [Warframe.market Terms of Service](https://warframe.market/tos).

Правила разработчиков требуют узнаваемого `User-Agent`, экономных запросов и отказа от прямого клонирования сайта. API v1 устарел. Документация пока оставляет v1-авторизацию для интеграций с аккаунтами, поскольку регистрация OAuth-клиентов закрыта. [Правила API](https://docs.warframe.market/docs/rules/overview/) · [Состояние API и OAuth](https://docs.warframe.market/docs/intro/).

В коде рыночные запросы идут через backend, прямые клиенты и оставшиеся маршруты v1. Очередь main допускает пакет из пяти запросов при старте. Она сама по себе не подтверждает общий лимит или лимит для contracts. В штатных EN/RU шаблонах копируемых сообщений есть `WantedFrame`. До следующей публичной поставки нужно подтвердить формат сообщения, идентификацию и бюджет всех путей запросов и зафиксировать контакт с Warframe.market. Синтетические проверки подтверждают работу приложения с тестовым транспортом.

## Что делают существующие workflows

| Событие | Поведение |
| --- | --- |
| Push/PR обычной рабочей ветки | CI и Secret Scan. Windows job собирает и проверяет unpacked x64 без публикации. |
| Push `feat/wantedframe-next` | `wantedframe-next.yml`: подготовка exact SHA, JSON/ZIP checks, Windows preview artifact, provenance и package smoke. Этот workflow сам не публикует release. |
| Push `feat/wantedframe-brand` | Специальный preview workflow может создать/обновить `v0.1.0`. Не использовать эту ветку для docs PR. |
| Тег `v*` | Release workflow требует CI, собирает Windows и Linux, создаёт/наполняет release. |
| Публикация release | Отдельный workflow отправляет Discord announcement. |
| Scheduled backend smoke | Проверяет внешний backend; это не локальная offline-проверка. |

## Следующий собственный выпуск

1. Выбрать точный коммит и подтвердить целевую платформу. PR #3 предназначен для `feat/wantedframe-next`.
2. Пройти CI, package smoke с исходными лицензиями, чистую установку и апгрейд в отдельной Windows-среде. Нативный OCR с русским языком и поверх игры требует отдельной проверки.
3. Закрыть вопросы по происхождению комплектных моделей, игровых материалов и API Warframe.market. [Лицензии поставки](FORK_STATUS.md#bundled-assets).
4. Проверить appId и сохранение профиля. До апгрейда сохранить копию профиля и предыдущий проверенный установщик. Откат проверить на синтетическом профиле, включая восстановление копии и работу прежней версии.
5. Сверить версию, SHA, checksum, build-info и фактически проверенные файлы. Новый тег и публикацию согласовать с владельцем. Публикация запускает Discord announcement.
6. После согласованной публикации проверить загрузку опубликованного файла и обновить README по результату.
