// Three pulsing dots inside a bot-styled bubble. Shown only between the
// moment the user sends and the first chunk of the model's reply. The
// dot-bounce keyframes are defined in styles.css and exposed as the
// `animate-dot-bounce` Tailwind utility via @theme.
export const TypingIndicator = () => (
  <div className="flex w-full justify-start">
    <div
      aria-label="Бот думает"
      className="flex items-center gap-1 rounded-bubble rounded-bl-tail bg-bubble-bot px-4 py-3 shadow-bubble"
    >
      <span className="size-[7px] rounded-full bg-text-placeholder opacity-40 animate-dot-bounce" />
      <span className="size-[7px] rounded-full bg-text-placeholder opacity-40 animate-dot-bounce [animation-delay:0.18s]" />
      <span className="size-[7px] rounded-full bg-text-placeholder opacity-40 animate-dot-bounce [animation-delay:0.36s]" />
    </div>
  </div>
);
