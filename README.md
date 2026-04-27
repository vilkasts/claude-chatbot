# Claude Chatbot

Учебный чат-бот для приложения **Clientsy** на Anthropic Claude API. База знаний — markdown-файлы в `bot/docs/` (по одному на каждую роль: владелец бизнеса, сотрудник, клиент). Бот цитирует только то, что есть в документах, и дисциплинированно отказывается от вопросов вне корпуса.

## Запуск

```bash
# 1. Установить зависимости
npm install

# 2. Создать .env с ключом

# 3. Запустить нужный интерфейс — см. ниже
```

## Интерфейсы

Проект — это **три точки входа**, использующие одно ядро `bot/core/`:

| Интерфейс  | Что это                                                          | Dev                  | Prod                                      |
| ---------- | ---------------------------------------------------------------- | -------------------- | ----------------------------------------- |
| **CLI**    | Чат в терминале                                                  | `npm run dev:cli`    | `npm run build:node && npm run start:cli` |
| **Server** | Node-сервер на порту 3000: REST/SSE API + раздача web-интерфейса | `npm run dev:server` | `npm run build && npm run start:server`   |

В dev-режиме `dev:server` разом поднимает Node API и Vite (как middleware) на одном порту :3000 — никакого второго порта для фронта, HMR работает прозрачно.

В prod-режиме `start:server` отдаёт уже собранный фронт из `apps/web/dist/`.

## Команды

```bash
# Разработка
npm run dev:cli         # CLI в watch-режиме
npm run dev:server      # API + web (Vite middleware) на :3000 в watch-режиме

# Сборка
npm run build           # build:node + build:web
npm run build:node      # tsc для CLI и server → dist/
npm run build:web       # vite build для фронта → apps/web/dist/

# Запуск собранного
npm run start:cli
npm run start:server

# Качество кода
npm run tsc             # тип-чек CLI + server
npm run tsc:web         # тип-чек web
npm run lint            # eslint --fix .
npm run format          # prettier --write .

# Эвалы
npm run eval                          # прогон всего датасета bot/evals/dataset.json
npm run eval -- --category=in_corpus  # только одна категория
npm run eval -- --limit=5             # первые 5 кейсов
```

## Структура

```
bot/
  core/          — ядро бота: clientsy, загрузка документов, system prompt
  docs/          — база знаний (BUSINESS.md, CLIENT.md, EMPLOYEE.md)
  evals/         — eval-датасет, runner, grader
  shared/        — константы, шарящиеся между CLI / server / web
apps/
  cli/           — CLI-интерфейс (readline)
  server/        — HTTP-сервер: /api/chat (SSE), /api/reset, статика web
  web/           — React + Vite + Tailwind v4 фронт
```

Ядро (`bot/core/chat.ts`) — фабрика `createChatSession({ system, docs })` с методами `ask()` и `reset()`. CLI и server вызывают её одинаково; они отличаются только транспортом (терминал vs HTTP/SSE).

## База знаний

Документы в `bot/docs/` загружаются один раз при старте. Бот видит их через `document` content blocks с `cache_control: ephemeral` — Anthropic кэширует префикс (system + docs) на ~5 минут, дальнейшие запросы платят только за дельту.

Каждый файл — справочник по одной роли в Clientsy: пути в формате `Раздел → Подраздел → Кнопка`, иконки, точные надписи кнопок. Источник правды — компонент «Помощь» в репозитории `clientsy-app` (`src/widgets/business/help/data/faq-items-*.ts` + локали).

## Эвалы

LLM-grader (`claude-haiku-4-5`) оценивает ответ бота по списку критериев из `bot/evals/dataset.json`. Категории:

- `in_corpus` — ответ есть в документации, бот должен дать точный путь.
- `unknown_clientsy` — функции в Clientsy нет, бот должен честно отказаться.
- `off_topic` — вопрос не про Clientsy, бот должен отказаться по шаблону.
- `multi_step` — ответ требует нумерованного списка из ≥2 шагов.
- `icon_required` — кнопка без подписи, бот обязан назвать иконку.

Результаты пишутся в `bot/evals/results/results-<timestamp>.json` — можно сравнивать прогоны.

## Pre-commit хук

Перед каждым коммитом husky запускает `tsc → tsc:web → lint → format`. Хук подключается автоматически после `npm install` (через скрипт `prepare`).

## Модели

- Бот: `claude-haiku-4-5` (`bot/core/chat.ts` → `DEFAULT_CONFIG.model`).
- Grader: `claude-haiku-4-5` (`bot/evals/grader.ts` → `GRADER_MODEL`).

Темпераметра `0` и для бота, и для грейдера — для воспроизводимости эвалов.
