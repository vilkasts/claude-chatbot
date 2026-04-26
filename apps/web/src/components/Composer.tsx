import { useEffect, useRef, useState } from "react";

interface Props {
  disabled: boolean;
  onSend: (text: string) => void;
}

const MAX_TEXTAREA_ROWS = 5;

// Bottom-of-screen input. Auto-grows up to 5 rows, then scrolls inside.
// Enter sends, Shift+Enter inserts a newline (matches messenger conventions).
export const Composer = ({ disabled, onSend }: Props) => {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the textarea up to MAX_TEXTAREA_ROWS, then start scrolling.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight =
      Number.parseInt(window.getComputedStyle(textarea).lineHeight, 10) || 20;
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [draft]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setDraft("");
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        className="composer__input"
        rows={1}
        placeholder="Напишите сообщение…"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="submit"
        className="composer__send"
        disabled={disabled || draft.trim().length === 0}
        aria-label="Отправить"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path
            d="M3 11.5L21 3l-8.5 18-2.2-7.3L3 11.5z"
            fill="currentColor"
          />
        </svg>
      </button>
    </form>
  );
};
