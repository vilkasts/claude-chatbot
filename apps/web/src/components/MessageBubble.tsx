import type { ChatMessage } from "../hooks/useChat";

interface Props {
  message: ChatMessage;
}

const BUBBLE_BASE =
  "max-w-[80%] whitespace-pre-wrap break-words rounded-bubble px-3.5 py-2.5 shadow-bubble animate-bubble-in";

// One chat bubble. Visual style depends on role: bot bubbles render on the
// left in white, user bubbles on the right in accent blue. The "tail" is
// just a smaller corner radius on the side closest to the speaker - cheaper
// and crisper than an SVG triangle.
export const MessageBubble = ({ message }: Props) => {
  const { role, text, status } = message;
  const isUser = role === "user";

  // Roles drive: alignment in the row + bubble color + which corner is "tailed".
  const rowClass = isUser ? "justify-end" : "justify-start";
  const colorClass =
    status === "error"
      ? "bg-bubble-error text-bubble-error-text"
      : isUser
        ? "bg-bubble-user text-text-on-accent rounded-br-tail"
        : "bg-bubble-bot text-text-primary rounded-bl-tail";

  // Streaming bubbles get a subtle blinking caret at the end - hint that
  // more text is on the way.
  const showStreamingCaret =
    !isUser && status === "streaming" && text.length > 0;

  return (
    <div className={`flex w-full ${rowClass}`}>
      <div className={`${BUBBLE_BASE} ${colorClass}`}>
        <span className="inline">{text}</span>
        {showStreamingCaret && (
          <span
            aria-hidden
            className="ml-[3px] inline-block h-3.5 w-1.5 align-text-bottom bg-text-secondary animate-caret-blink"
          />
        )}
      </div>
    </div>
  );
};
