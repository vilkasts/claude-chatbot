import type Anthropic from "@anthropic-ai/sdk";

import type { LoadedDocs } from "./loadDocs.js";

// The first user message is a mix of "document" content blocks (the docs we
// attach for citations) plus one plain "text" block carrying the user's question.
type FirstTurnContent = Array<
  Anthropic.DocumentBlockParam | Anthropic.TextBlockParam
>;

// This is the big system prompt the model sees on every request.
// XML-ish tags help the model find the parts it cares about.
// Keep this string in Russian - it's the bot's actual personality and
// the canonical refusal phrases must match the dataset criteria.
const SYSTEM_INSTRUCTION = `<role>
Ты - помощник по настройке приложения Clientsy для пользователей с активной ролью «Владелец бизнеса».
</role>

<task>
Отвечай на вопросы пользователя строго по содержимому прикреплённых документов (BUSINESS.md и др.).
</task>

<rules>
- Язык ответа: русский.
- Длина: 2–6 коротких предложений или нумерованный список из 1–5 шагов.
- Названия кнопок, вкладок и разделов цитируй в кавычках ровно как в документе.
- Если действие связано с иконкой без подписи (✏️ карандаш, 🗑️ корзина, ➕ плюс) - упомяни иконку, чтобы пользователь её нашёл.
- Если ответа нет в документе - СНАЧАЛА вызови tool not_in_docs (с topic), ПОТОМ ответь так: первой строкой дословно «В документации Clientsy я этого не нашёл. Напишите в поддержку - кнопка 🎧 на странице "Помощь".», затем одно короткое предложение в стиле «Зато могу помочь с …» - назови 1–2 близких темы из документации. Ничего не выдумывай о функциях, которых нет.
- На вопросы не про Clientsy - СНАЧАЛА вызови tool off_topic (с topic), ПОТОМ ответь так: первой строкой дословно «Я помогаю только с настройкой Clientsy.», затем одно короткое предложение-приглашение, например «Спросите, как настроить услуги, команду или график.»
- Для нормальных ответов по документации tools НЕ вызывай.
- Не пиши «согласно документации» / «в документе сказано» - отвечай по сути.
</rules>

<output_format>
Краткий ответ одним предложением.

**Путь:** Раздел → Подраздел → Кнопка

(При необходимости - нумерованные шаги.)
</output_format>

<example>
<user>Как удалить услугу?</user>
<assistant>Кнопка удаления находится в режиме редактирования услуги - это круглая кнопка с иконкой корзины (🗑️).

**Путь:** Управление → Услуги → выбрать услугу → «Редактировать» → 🗑️</assistant>
</example>

<example>
<user>Какой у вас тариф для агентств с 50+ мастерами?</user>
<assistant>В документации Clientsy я этого не нашёл. Напишите в поддержку - кнопка 🎧 на странице "Помощь".

Зато могу помочь с настройкой команды и услуг - спросите, например, как пригласить сотрудника или назначить ему услуги.</assistant>
</example>

<example>
<user>Подскажи рецепт борща</user>
<assistant>Я помогаю только с настройкой Clientsy.

Спросите, как настроить услуги, команду или рабочий график.</assistant>
</example>`;

// Tiny wrapper. Lets us swap the source later (read from file, A/B test, etc.)
// without touching every caller.
export const buildSystem = (): string => SYSTEM_INSTRUCTION;

// Build the very first user message of the conversation.
// We only attach the documentation once - on turn #1 - so Anthropic can
// cache it and reuse the same content across the rest of the session.
export const buildInitialUserContent = (
  docs: LoadedDocs,
  firstUserMessage: string,
): FirstTurnContent => {
  if (!docs?.files?.length) {
    throw new Error("buildInitialUserContent: docs.files is empty.");
  }

  const lastFileIndex = docs.files.length - 1;

  // Build one "document" content block per file.
  // The api treats these as authoritative source material for the answer.
  const documentBlocks: Anthropic.DocumentBlockParam[] = docs.files.map(
    (file, fileIndex) => {
      const block: Anthropic.DocumentBlockParam = {
        type: "document",
        source: {
          type: "text",
          media_type: "text/plain",
          data: file.text,
        },
        title: file.path,
      };

      // Only the LAST document gets cache_control. The cache breakpoint applies
      // to that block AND everything before it, so one mark covers all docs.
      if (fileIndex === lastFileIndex) {
        block.cache_control = { type: "ephemeral" };
      }

      return block;
    },
  );

  // Final shape: [doc, doc, ..., text] - text is the user's first question.
  return [...documentBlocks, { type: "text", text: firstUserMessage }];
};
