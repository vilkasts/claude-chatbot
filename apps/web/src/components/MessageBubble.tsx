import type { ChatMessage } from "../hooks/useChat";

interface Props {
  message: ChatMessage;
}

// One chat bubble. Visual style depends on role: bot bubbles render on the
// left in white, user bubbles on the right in accent blue. The "tail" is
// just a smaller corner radius on the side closest to the speaker - cheaper
// and crisper than an SVG triangle.
export const MessageBubble = ({ message }: Props) => {
  const { role, text, status } = message;
  const isUser = role === "user";

  const bubbleClassName = [
    "bubble",
    isUser ? "bubble--user" : "bubble--bot",
    status === "error" ? "bubble--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Streaming bubbles get a subtle blinking caret at the end - hint that
  // more text is on the way.
  const showStreamingCaret =
    !isUser && status === "streaming" && text.length > 0;

  return (
    <div
      className={`bubble-row ${isUser ? "bubble-row--user" : "bubble-row--bot"}`}
    >
      <div className={bubbleClassName}>
        <span className="bubble__text">{text}</span>
        {showStreamingCaret && <span className="bubble__caret" aria-hidden />}
      </div>
    </div>
  );
};
