// First message the bot shows when a fresh session starts.
// Single source of truth - imported by every app:
//   - apps/cli/index.ts        (Node)
//   - apps/server/index.ts     (Node, indirectly via the bot core)
//   - apps/web/src/hooks/useChat.ts (browser, via the @bot/* alias)
// Keep it short - the user has not asked anything yet, so a long intro is noise.
export const WELCOME_MESSAGE =
  "Привет! Я Clientsy - чат-бот по настройке приложения. " +
  "Если у вас есть вопросы по приложению - я всегда рад помочь!";
