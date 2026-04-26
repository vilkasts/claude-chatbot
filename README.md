# Claude Chatbot

Учебный CLI чат-бот на Anthropic Claude API.

## Запуск

```bash
# 1. Установите зависимости
npm install

# 2. Скопируйте .env.example в .env и вставьте свой ключ
cp .env.example .env

# 3. Запустите бота
npm start
```

## Структура

- `src/index.js` — точка входа, читает ввод пользователя и вызывает `chat()`
- `src/chat.js` — **здесь вы напишете основную логику диалога** (см. TODO в файле)

## Используемая модель

По умолчанию — `claude-haiku-4-5`
