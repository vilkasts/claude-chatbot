---
name: chat-core-refactor
description: Guards bot/core/chat.ts during refactoring by enforcing six documented invariants (cache_control placement, history pinning, tool_use stripping, doc-only-on-first-turn, error rollback, temperature=0) and runs the full eval afterwards. Use whenever bot/core/chat.ts is being modified.
---

# Chat Core Refactor Skill — claude-chatbot

`bot/core/chat.ts` is the single most fragile file in the project. It has six documented invariants — every one of them is silent when broken: the bot still answers, but it answers wrong, expensively, or both. This skill is the seatbelt for any refactor of that file.

## When to use

Trigger on any change to:

- `bot/core/chat.ts` (the file itself)
- `bot/core/systemPrompt.ts` `buildInitialUserContent` — it shapes the cache breakpoint
- `DEFAULT_CONFIG` (model, temperature, maxHistoryMessages)
- `RESPONSE_CLASSIFICATION_TOOLS` schema
- The `pruneHistoryIfTooLong`, `classifyAssistantResponse`, or `ask` function bodies

If the change is in `bot/core/loadDocs.ts` or `bot/core/errors.ts` — this skill does **not** apply (those don't carry the invariants).

---

## Step 1 — Read the file as a whole

Open `bot/core/chat.ts` end-to-end before any edit. The invariants are coupled — fixing one in isolation breaks another.

Also read `bot/core/systemPrompt.ts:buildInitialUserContent` if doc-block placement is part of the change — that's where `cache_control` gets attached to the **last** doc.

---

## Step 2 — Six invariants checklist

For every change, verify each invariant **before** writing code, **during** review of the diff, and **after** running the eval.

### Invariant 1: Cache breakpoint on system + last doc

```ts
// systemPrompt.ts → buildInitialUserContent
if (fileIndex === lastFileIndex) {
  block.cache_control = { type: "ephemeral" };
}

// chat.ts → buildRequestParams
system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
```

Both must remain. The cache breakpoint covers the block AND everything before it — moving the breakpoint moves the cache window. Adding new content blocks **before** the marked one without updating the marker = silent ~10x cost increase.

**Verify:** after a change, run one CLI message and inspect `cache_read_input_tokens` in the stats line — should be > 0 on the second turn.

### Invariant 2: history[0] is pinned

```ts
const pinnedFirstMessage = conversationHistory[0];
// ...
conversationHistory.length = 0;
conversationHistory.push(pinnedFirstMessage, ...recentMessages);
```

`history[0]` carries the docs as `document` content blocks. Drop it and:

1. The bot loses all knowledge after the prune.
2. The prompt cache invalidates (no more cached prefix).

**Don't** introduce code that calls `conversationHistory.shift()` or `splice(0, ...)` — those bypass the pinning.

### Invariant 3: Window after pin starts with `user`

```ts
while (recentMessages.length > 0 && recentMessages[0]?.role === "assistant") {
  recentMessages.shift();
}
```

Anthropic rejects a conversation where `assistant` appears immediately after the first user message without an intervening user turn. The prune logic shifts off any leading assistant.

**Don't** remove this loop "as cleanup" — it looks redundant but it's load-bearing.

### Invariant 4: Doc blocks on first turn ONLY

```ts
const isFirstTurn = conversationHistory.length === 0;
const newUserMessage: Anthropic.MessageParam = isFirstTurn
  ? { role: "user", content: buildInitialUserContent(docs, userMessage) }
  : { role: "user", content: userMessage };
```

Attaching docs on every turn defeats prompt caching (each turn writes a fresh cache instead of reading) and inflates input tokens by ~13k per message in this corpus.

**Don't** "simplify" by always passing `buildInitialUserContent`. The branch is the optimization.

### Invariant 5: tool_use blocks NOT saved into history

```ts
let assistantText = finalMessage.content
  .filter((block): block is Anthropic.TextBlock => block.type === "text")
  .map((block) => block.text)
  .join("");
// ...
conversationHistory.push({ role: "assistant", content: assistantText });
```

The model emits `tool_use` blocks for `not_in_docs` / `off_topic` classification. Saving them into history without a matching `tool_result` confuses the next turn (Anthropic API expects pairs). Only the assembled plain text gets saved.

**Don't** push `finalMessage.content` directly into history — always strip down to text.

### Invariant 6: User-message rollback on error

```ts
try {
  // ... ask the model
} catch (error) {
  conversationHistory.pop();
  throw error;
}
```

On any error, the user message we just pushed must be removed — otherwise the next turn replays it as if the model had answered, which it did not.

**Don't** wrap the catch in finally without re-throwing; don't move the `pop()` to a different scope.

### Bonus: temperature = 0 stays

```ts
const DEFAULT_CONFIG: ResolvedConfig = {
  // ...
  temperature: 0,
};
```

Required for eval reproducibility. If a user wants creative output for a non-eval scenario, override per-call via `createChatSession({ temperature: 0.7 })` — don't change the default.

---

## Step 3 — Diff review

Before saving the change, walk the diff and explicitly tick each invariant:

```
[ ] cache_control still on systemPrompt
[ ] cache_control still on lastFileIndex doc
[ ] history[0] still pinned in pruning
[ ] leading-assistant strip loop still present
[ ] isFirstTurn branch still wraps doc attachment
[ ] only text blocks pushed into history
[ ] catch block still pops the user message
[ ] temperature: 0 in DEFAULT_CONFIG
```

If any box is unchecked, do not commit — fix the regression first.

---

## Step 4 — Run the full eval

```bash
npm run eval
```

This file affects **every** category — partial slices won't catch every regression. Read the new `bot/evals/results/results-*.json` and compare to the previous one.

**Pass criteria:**

- Overall avg Δ ≥ -0.1 vs baseline.
- No category Δ ≥ -0.3.
- No individual case dropping ≥ 2 points.

If any of these fail, treat the eval result as a counterexample for the refactor — don't merge.

---

## Step 5 — Manual cache verification

Eval doesn't directly verify caching (it runs each case in a fresh session, no cache hit possible). To verify Invariants 1, 2, 4 affirmatively, do one CLI run with two turns:

```bash
npm run dev:cli
> Как удалить услугу?
> Как пригласить сотрудника?
```

Inspect the stats line under the **second** answer:

- `cache_read=<N>` should be a large number (≥ 10000 — most of the docs)
- `cache_create=0` (no new cache write — we hit the cached prefix)
- `input=<small>` (just the new user message)

If `cache_read=0` after a refactor, Invariant 1 or 4 is broken — bisect the diff.

---

## Severity guide

| Severity      | Trigger                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| ❌ Critical   | Any of invariants 1–6 broken; eval avg drops ≥ 0.3; cache_read = 0 on second turn |
| ⚠️ Warning    | Eval avg drops 0.1–0.3; one category Δ -0.1 to -0.3                               |
| 💡 Suggestion | Refactor improves clarity without affecting any invariant or score                |
