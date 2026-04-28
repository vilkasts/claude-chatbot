import Anthropic from "@anthropic-ai/sdk";

import { formatErrorWithContext } from "./errors.js";
import type { LoadedDocs } from "./loadDocs.js";
import { buildInitialUserContent } from "./systemPrompt.js";

// All the kinds of replies the bot can produce.
// `answer` = a normal documentation-grounded reply.
// `not_in_docs` / `off_topic` = a refusal classified by the model via tool_use.
export type ResponseKind = "answer" | "not_in_docs" | "off_topic";

// What the model decided about the reply - derived from the tool_use blocks.
export interface ResponseClassification {
  kind: ResponseKind;
  topic?: string;
}

// Public return shape of `session.ask(...)`.
export interface AskResult {
  text: string;
  usage: Anthropic.Usage;
  kind: ResponseKind;
  topic?: string;
}

// Optional callbacks the caller can pass to `ask`.
export interface AskOptions {
  // Fires once per streamed text chunk so the caller can render incrementally.
  onText?: (textChunk: string) => void;
  // Fires once before the request is sent, with the estimated input token count.
  // Triggering this costs a separate (cheap) countTokens api call.
  onBudget?: (info: { inputTokens: number }) => void;
}

// Configuration for createChatSession.
// `system` and `docs` are required, everything else falls back to DEFAULT_CONFIG.
export interface ChatSessionOptions {
  system: string;
  docs: LoadedDocs;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  maxHistoryMessages?: number;
}

// Public interface of one chat session.
export interface ChatSession {
  ask: (userMessage: string, options?: AskOptions) => Promise<AskResult>;
  reset: () => void;
  readonly history: Anthropic.MessageParam[];
}

// Internal representation after defaults are applied.
type ResolvedConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
  maxHistoryMessages: number;
};

// Default request settings - overridable via createChatSession({...})
const DEFAULT_CONFIG: ResolvedConfig = {
  model: "claude-haiku-4-5",
  maxTokens: 1024,
  // temperature 0 makes answers reproducible - important for evals.
  temperature: 0,
  // 12 messages = 6 turns (user + assistant pairs).
  // We always pin history[0] (it carries the docs) and slide a window over the rest.
  maxHistoryMessages: 12,
};

// Tools the model can call to flag the kind of answer it just gave.
// We DON'T use them as the answer itself - they're just a structured signal
// alongside the normal text reply (cheap classification, no extra round-trip).
const RESPONSE_CLASSIFICATION_TOOLS: Anthropic.Tool[] = [
  {
    name: "not_in_docs",
    description:
      "Вызови этот инструмент, когда ответа на вопрос пользователя нет в прикреплённой документации Clientsy. После вызова также напиши пользователю заученную фразу из правил.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Краткая тема вопроса (1-5 слов), о чём спрашивал пользователь.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "off_topic",
    description:
      "Вызови этот инструмент, когда вопрос пользователя вообще не про приложение Clientsy. После вызова также напиши пользователю заученную фразу из правил.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Краткая тема вопроса (1-5 слов).",
        },
      },
      required: ["topic"],
    },
  },
];

// Tool input shape - we know our schema requires `topic: string`, so we narrow
// `unknown` to that here for the classifier function.
type ClassificationToolInput = {
  topic?: string;
};

// Look at the response content and decide whether the model classified the
// reply as a refusal (`not_in_docs` / `off_topic`) or a normal answer.
const classifyAssistantResponse = (
  responseContent: Anthropic.ContentBlock[],
): ResponseClassification => {
  for (const block of responseContent) {
    if (block.type !== "tool_use") continue;
    const input = block.input as ClassificationToolInput;
    if (block.name === "not_in_docs")
      return { kind: "not_in_docs", topic: input?.topic };
    if (block.name === "off_topic")
      return { kind: "off_topic", topic: input?.topic };
  }
  // No tool was called - a regular documentation-based answer.
  return { kind: "answer" };
};

// Hardcoded fallback texts - we only use these when the model called a tool
// but somehow forgot to actually write the user-facing message. Rare, but possible.
const FALLBACK_TEXT_BY_KIND: Partial<Record<ResponseKind, string>> = {
  not_in_docs:
    'В документации Clientsy я этого не нашёл. Напишите в поддержку - кнопка 🎧 на странице "Помощь".',
  off_topic: "Я помогаю только с настройкой Clientsy.",
};

// Public factory: returns one chat session object with `ask` / `reset` / `history`.
// Each session keeps its own history array and shares one Anthropic client.
export const createChatSession = (options: ChatSessionOptions): ChatSession => {
  const { system, docs, ...userOverrides } = options;
  if (!system) throw new Error("createChatSession: `system` is required.");
  if (!docs) throw new Error("createChatSession: `docs` is required.");

  const config: ResolvedConfig = { ...DEFAULT_CONFIG, ...userOverrides };
  const anthropicClient = new Anthropic();
  const conversationHistory: Anthropic.MessageParam[] = [];

  // Trim conversation history when it grows past `maxHistoryMessages`.
  // Two invariants we MUST respect:
  //   1) history[0] is the very first user message that carries all the docs.
  //      If we drop it we lose the documentation context AND the cache hit.
  //   2) The slice we keep must start with a 'user' message - Anthropic
  //      rejects a conversation where 'assistant' comes first after the pin.
  const pruneHistoryIfTooLong = (): void => {
    const limit = config.maxHistoryMessages;
    if (conversationHistory.length <= limit) return;

    const pinnedFirstMessage = conversationHistory[0];
    if (!pinnedFirstMessage) return;

    // We have room for `limit - 1` recent messages (the pinned one takes 1 slot).
    const recentMessages = conversationHistory.slice(-(limit - 1));

    // Drop a leading assistant if it ended up at the start of the window.
    while (
      recentMessages.length > 0 &&
      recentMessages[0]?.role === "assistant"
    ) {
      recentMessages.shift();
    }

    // Replace the whole array in-place so callers reading `.history` see the change.
    conversationHistory.length = 0;
    conversationHistory.push(pinnedFirstMessage, ...recentMessages);
  };

  // Build the params used by both countTokens() and the streaming request.
  // Keeping them in one object guarantees the estimate matches the real call.
  const buildRequestParams = (): Anthropic.MessageCountTokensParams => ({
    model: config.model,
    // System is sent as an array of text blocks so we can attach cache_control.
    // Anthropic caches the whole stable prefix (system + tools + docs).
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    tools: RESPONSE_CLASSIFICATION_TOOLS,
    messages: conversationHistory,
  });

  // Best-effort token estimate before we actually send.
  // `countTokens` is a separate (cheap) api call so we only do it if asked.
  // Returns null on any failure - the user request must not crash because
  // an optional preview did. We still log the failure so it isn't silent.
  const estimateInputTokens = async (
    requestParams: Anthropic.MessageCountTokensParams,
  ): Promise<number | null> => {
    try {
      const tokenCount =
        await anthropicClient.messages.countTokens(requestParams);
      return tokenCount.input_tokens;
    } catch (error) {
      console.warn(formatErrorWithContext("chat:estimate", error));
      return null;
    }
  };

  // Main API of the session - send a user message, stream back the reply.
  const ask = async (
    userMessage: string,
    askOptions: AskOptions = {},
  ): Promise<AskResult> => {
    const { onText, onBudget } = askOptions;

    // The first turn carries the full documentation as content blocks;
    // every later turn is a plain text user message.
    const isFirstTurn = conversationHistory.length === 0;
    const newUserMessage: Anthropic.MessageParam = isFirstTurn
      ? { role: "user", content: buildInitialUserContent(docs, userMessage) }
      : { role: "user", content: userMessage };

    conversationHistory.push(newUserMessage);

    const requestParams = buildRequestParams();

    try {
      // If the caller wants a budget preview, run countTokens and notify them.
      if (onBudget) {
        const inputTokens = await estimateInputTokens(requestParams);
        if (inputTokens != null) onBudget({ inputTokens });
      }

      // Open the streaming connection. Text chunks arrive via the 'text' event.
      const stream = anthropicClient.messages.stream({
        ...requestParams,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      });

      if (onText) stream.on("text", onText);

      // Wait for the model to finish - gives us the full assembled message.
      const finalMessage = await stream.finalMessage();

      // Glue every text block together - this is what we show to the user
      // and what we save into history for future turns.
      let assistantText = finalMessage.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const classification = classifyAssistantResponse(finalMessage.content);

      // Edge case: model called a tool but produced no text.
      // Fill in the canonical refusal phrase ourselves so the user sees something.
      if (!assistantText.trim()) {
        const fallbackText = FALLBACK_TEXT_BY_KIND[classification.kind];
        if (fallbackText) {
          assistantText = fallbackText;
          if (onText) onText(fallbackText);
        }
      }

      // Save only the plain text into history. tool_use blocks WITHOUT a matching
      // tool_result confuse the model on the next turn, so we strip them.
      conversationHistory.push({ role: "assistant", content: assistantText });
      pruneHistoryIfTooLong();

      return {
        text: assistantText,
        usage: finalMessage.usage,
        ...classification,
      };
    } catch (error) {
      // Roll back the user message we just pushed - otherwise the next turn
      // would replay it as if the model had answered, which it did not.
      // Re-throw so the caller can decide whether to surface, retry or exit.
      conversationHistory.pop();
      throw error;
    }
  };

  // Wipe everything. Next ask() will treat the next message as turn #1
  // (and re-attach the docs).
  const reset = (): void => {
    conversationHistory.length = 0;
  };

  return {
    ask,
    reset,
    // Expose a defensive copy so callers can't mutate our internal history.
    get history() {
      return [...conversationHistory];
    },
  };
};
