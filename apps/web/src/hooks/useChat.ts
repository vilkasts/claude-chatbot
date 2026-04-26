import { WELCOME_MESSAGE } from "@bot/shared/greeting";
import { useCallback, useEffect, useRef, useState } from "react";

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
// Each browser/device gets one persistent id - that way refreshes within
// the lifetime of the server keep your conversation history intact.
const loadOrCreateSessionId = (): string => {
  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (stored) return stored;
  const fresh = crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
  return fresh;
};

// Build the bot's welcome message - lives on the client only, no api call.
const buildInitialMessages = (): ChatMessage[] => [
  {
    id: crypto.randomUUID(),
    role: "bot",
    text: WELCOME_MESSAGE,
    status: "done",
  },
];

interface UseChatReturn {
  messages: ChatMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  resetChat: () => void;
}

export const useChat = (): UseChatReturn => {
  const [messages, setMessages] = useState<ChatMessage[]>(buildInitialMessages);
  const [isThinking, setIsThinking] = useState(false);
  // sessionId persists across re-renders without triggering them.
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    sessionIdRef.current = loadOrCreateSessionId();
  }, []);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      status: "done",
    };
    const botMessageId = crypto.randomUUID();
    const botPlaceholder: ChatMessage = {
      id: botMessageId,
      role: "bot",
      text: "",
      status: "streaming",
    };

    setMessages((current) => [...current, userMessage, botPlaceholder]);
    setIsThinking(true);

    // Helper that mutates the bot message in our state by id.
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
      onChunk: (chunkText) => {
        // First chunk arrived - hide the typing indicator.
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
    void resetChatOnServer(sessionIdRef.current);
    setMessages(buildInitialMessages());
    setIsThinking(false);
  }, []);

  return { messages, isThinking, sendMessage, resetChat };
};
