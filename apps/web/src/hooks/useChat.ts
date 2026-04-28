import { WELCOME_MESSAGE } from "@bot/shared/greeting";
import { useCallback, useRef, useState } from "react";

import { resetChatOnServer, streamChat } from "../lib/sseClient";

export type MessageRole = "user" | "bot";
export type MessageStatus = "streaming" | "done" | "error";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
}

const SESSION_STORAGE_KEY = "clientsy.sessionId";

// Pull the session id from localStorage, or generate one and persist it.
// Each browser gets one persistent id so refreshes keep conversation history intact.
const loadOrCreateSessionId = (): string => {
  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (stored) return stored;
  const fresh = crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
  return fresh;
};

const buildWelcomeMessage = (): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "bot",
  text: WELCOME_MESSAGE,
  status: "done",
});

type UseChatReturn = {
  messages: ChatMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  resetChat: () => void;
};

export const useChat = (): UseChatReturn => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    buildWelcomeMessage(),
  ]);
  const [isThinking, setIsThinking] = useState(false);

  // Initialized once on mount — no useEffect needed.
  const sessionIdRef = useRef(loadOrCreateSessionId());

  // Holds the AbortController for the in-flight stream so we can cancel it
  // if the user sends a new message before the previous one finishes.
  const activeStreamAbortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Cancel any in-flight stream before starting a new one.
    activeStreamAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    activeStreamAbortControllerRef.current = abortController;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      status: "done",
    };

    const botMessageId = crypto.randomUUID();
    const botStreamingMessage: ChatMessage = {
      id: botMessageId,
      role: "bot",
      text: "",
      status: "streaming",
    };

    setMessages((current) => [...current, userMessage, botStreamingMessage]);
    setIsThinking(true);

    // Patch only the bot message that belongs to this particular send() call.
    const updateBotMessage = (patch: (current: ChatMessage) => ChatMessage) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === botMessageId ? patch(message) : message,
        ),
      );
    };

    void streamChat({
      sessionId: sessionIdRef.current,
      message: trimmed,
      signal: abortController.signal,
      onChunk: (chunkText) => {
        // First chunk arrived — hide the typing indicator.
        setIsThinking(false);
        updateBotMessage((message) => ({
          ...message,
          text: message.text + chunkText,
        }));
      },
      onDone: () => {
        setIsThinking(false);
        updateBotMessage((message) => ({ ...message, status: "done" }));
      },
      onError: (errorMessage) => {
        setIsThinking(false);
        updateBotMessage((message) => ({
          ...message,
          text: message.text || `Ошибка: ${errorMessage}`,
          status: "error",
        }));
      },
    });
  }, []);

  const resetChat = useCallback(() => {
    activeStreamAbortControllerRef.current?.abort();
    void resetChatOnServer(sessionIdRef.current);
    setMessages([buildWelcomeMessage()]);
    setIsThinking(false);
  }, []);

  return { messages, isThinking, sendMessage, resetChat };
};
