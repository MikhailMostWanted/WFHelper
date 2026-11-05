# Материалы README и проверяемые утверждения

Основной исходник витрины: `feat/wantedframe-next`, `3032361635d5f8a525a2f4c7544c031b412377e9`. Новые материалы не меняют desktop runtime, profile identity, рыночную авторизацию и интеграционные API.

## Иллюстрации

| Файлы | Что показано |
| --- | --- |
| `hero-wide.svg`, `hero-mobile.svg` | Оригинальная геометрическая композиция снаряжения и связей. Не логотип DE и не экран клиента. |
| `flow-wide.svg`, `flow-mobile.svg` | Схема существующей локальной проекции: источник → снимок → интерфейс/экспорт. Отдельный поток рыночных цен не подтверждает владение. |
| `fixture-wide.svg`, `fixture-mobile.svg` | Выбранные поля настоящего результата синтетического fixture. Значения не получены из реального аккаунта. |
| `fixture-proof.json` | Небольшой документальный фрагмент, а не полный импортируемый account snapshot. Содержит источник, общее число разделов и выделенные поля. |

SVG содержат собственные векторные элементы и системные шрифтовые fallback; внешних изображений, web-font запросов, JavaScript и встроенного HTML нет. Широкая и мобильная композиции выбираются через стандартный `picture`.

## Карта утверждений

| Утверждение | Источник в указанном SHA |
| --- | --- |
| Текущие возможности и границы собственного preview | `docs/WANTEDFRAME_NEXT.md`, соответствующие services/IPC и tests. |
| Снимок доступных полей и различие неизвестного/нулевого | `services/accountSnapshot.ts`, `services/accountBridge.ts`. |
| JSON/ZIP без произвольных authorization-полей | `services/bridgeExport.ts`, `tests/bridge/build_fixture.cjs`. |
| Русские награды и моды Разлома | `services/rewardRussianOcr.ts`, `services/nativeRussianOcr.ts`, `services/rivenRussianText.ts`; наличие кода не является новым замером точности native OCR. |
| Собственная Windows preview-сборка и revision | Релиз `v0.3.0-preview.3`, его `SOURCE_REVISION.txt`, `build-info.json`, `.sha256` и run `38898562926`. Сам EXE здесь не запускался. |
| История Linux-команд и ограничение опубликованных платформ | `package.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`; реестр собственных release assets проверен 2026-11-05. |
| Пользовательская identity | `package.json`: `build.appId=com.wfhelper.app`, `build.productName=WantedFrame`. Эти значения не меняются. |

Скриншот `.github/screenshots/inventory.png` унаследован из исходной истории. В новую витрину он не включён: новое происхождение и synthetic account для него не установлены. Имеющийся e2e harness запускает Electron и main-службы; для этого docs-прохода он не использовался.

## Безопасное воспроизведение JSON/ZIP-контракта

Нужны Node 22.22.2 и TypeScript 5.9.3. TypeScript можно установить отдельно от клиента; команды ниже не запускают Electron, OCR, игру или сетевые интеграции.

```sh
npm install --prefix /absolute/test-tools --ignore-scripts typescript@5.9.3
TYPESCRIPT_PATH=/absolute/test-tools/node_modules/typescript \
  node tests/bridge/build_fixture.cjs /absolute/synthetic-output
```

Существующий fixture использует `/Lotus/Test/*`, фиксированные тестовые идентификаторы и `DO_NOT_EXPORT_*` sentinels. Проверяются 53 раздела, `0`/`null`/`missing`, Unicode, запрет переноса произвольных секретных полей, JSON round-trip и реальный ZIP с `account.json` и `README_CHATGPT.md`. Он ничего не утверждает о Windows GUI, OCR на машине игрока, реальных рыночных данных или подключённой учётной записи.

Выделенные значения для SVG: `masteryRank=14`, `credits=12000`, `platinum=0`, `masteryXp=null`, `inventory.LongGuns.status=missing`. `missionGain=null` в ресурсной проекции: разница остатков не выдаётся за добычу.
