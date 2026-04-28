import { useEffect, useRef, useState } from "react";

type Props = {
  disabled: boolean;
  onSend: (text: string) => void;
};

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

  const isSendDisabled = disabled || draft.trim().length === 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      // pb arbitrary value keeps clearance under iOS home indicator (safe-area-inset-bottom).
      className="flex shrink-0 items-end gap-2 border-t border-border-subtle bg-composer px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <textarea
        ref={textareaRef}
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
        className="max-h-[140px] flex-1 resize-none rounded-xl border border-border-subtle bg-chat px-3.5 py-2.5 text-text-primary outline-hidden transition-colors duration-[140ms] placeholder:text-text-placeholder focus:border-bubble-user disabled:cursor-not-allowed disabled:opacity-50 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      />
      <button
        type="submit"
        disabled={isSendDisabled}
        aria-label="send"
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-bubble-user text-text-on-accent transition-[transform,background] duration-[140ms] not-disabled:hover:bg-bubble-user-hover not-disabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* paper-plane icon points right; nudge up-left so it looks centered */}
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden
          className="-translate-x-px translate-y-px"
        >
          <path d="M3 11.5L21 3l-8.5 18-2.2-7.3L3 11.5z" fill="currentColor" />
        </svg>
      </button>
    </form>
  );
};
