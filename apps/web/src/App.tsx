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
    <div className="flex h-dvh w-full flex-col bg-chat sm:max-w-[720px] sm:shadow-shell">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-header px-4 py-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-bubble-user to-[#3eb4f0] text-[22px] text-white"
          aria-hidden
        >
          🤖
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-text-primary">
            Clientsy Help Bot
          </div>
          <div className="text-xs text-text-secondary">
            помощь по приложению
          </div>
        </div>
        <button
          type="button"
          onClick={resetChat}
          aria-label="reset dialog"
          className="cursor-pointer rounded-control border border-border-subtle bg-transparent px-3 py-1.5 text-[13px] text-text-secondary transition-colors duration-[140ms] hover:bg-chat hover:text-text-primary"
        >
          Сбросить
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isThinking && <TypingIndicator />}
        <div ref={bottomSentinelRef} />
      </main>

      <Composer disabled={isThinking} onSend={sendMessage} />
    </div>
  );
};
