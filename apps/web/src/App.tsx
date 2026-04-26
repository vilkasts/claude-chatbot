import { useEffect, useRef } from "react";

import { Composer } from "./components/Composer";
import { MessageBubble } from "./components/MessageBubble";
import { TypingIndicator } from "./components/TypingIndicator";
import { useChat } from "./hooks/useChat";

export const App = () => {
  const { messages, isThinking, sendMessage, resetChat } = useChat();

  // After every message list change, jump to the bottom so the latest
  // bubble (or typing indicator) stays visible. We use a sentinel div
  // because measuring scroll height on the messages container directly
  // is fragile when bubbles animate in.
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomSentinelRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <div className="app-shell">
      <header className="chat-header">
        <div className="chat-header__avatar" aria-hidden>
          🤖
        </div>
        <div className="chat-header__title">
          <div className="chat-header__name">Clientsy Help Bot</div>
          <div className="chat-header__subtitle">помощь по приложению</div>
        </div>
        <button
          type="button"
          className="chat-header__reset"
          onClick={resetChat}
          aria-label="Сбросить диалог"
        >
          Сбросить
        </button>
      </header>

      <main className="chat-feed">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isThinking && <TypingIndicator />}
        <div ref={bottomSentinelRef} />
      </main>

      <Composer disabled={false} onSend={sendMessage} />
    </div>
  );
};
