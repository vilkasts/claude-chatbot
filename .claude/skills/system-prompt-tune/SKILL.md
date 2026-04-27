---
name: system-prompt-tune
description: Safely modifies bot/core/systemPrompt.ts while preserving the canonical Russian refusal phrases (matched literally by the eval grader), tool schemas, output_format block, and tool-then-text rule order. Use whenever the bot's tone, refusal behavior, or output formatting is being tuned.
---

# System Prompt Tune Skill — claude-chatbot

`bot/core/systemPrompt.ts` is the bot's personality. It also contains exact strings the eval grader matches **literally** — even cosmetic edits ("Я могу помочь только с настройкой Clientsy" instead of "Я помогаю только с настройкой Clientsy") will cause `unknown_clientsy` and `off_topic` cases to drop 1–2 points. This skill is the safety net.

## When to use

- Tuning bot tone, voice, length rules, language strictness
- Strengthening or relaxing refusal behavior
- Updating examples in `<example>` blocks
- Changing the output format template
- Adding a new rule to `<rules>`

If the change is a typo fix or formatting whitespace inside a non-load-bearing string, this skill is overkill — but a 30-second sanity check still helps.

---

## Step 1 — Snapshot the current invariants

Read `bot/core/systemPrompt.ts` end-to-end. Identify and copy out the exact strings that **must not change** (these are the load-bearing parts — everything else is fair game):

### Canonical refusal phrases (must remain literal)

```
not_in_docs:
«В документации Clientsy я этого не нашёл. Напишите в поддержку - кнопка 🎧 на странице "Помощь".»

off_topic:
«Я помогаю только с настройкой Clientsy.»
```

### Tool-then-text rule order

The `<rules>` block must keep this ordering for both refusal types:

1. **СНАЧАЛА вызови tool** (`not_in_docs` or `off_topic`)
2. **ПОТОМ ответь** with the canonical phrase
3. **ЗАТЕМ** an inviting next-step sentence

If you reorder these to "respond first, then classify" the model will sometimes skip the tool entirely.

### Tool schemas in `RESPONSE_CLASSIFICATION_TOOLS` (`chat.ts`)

Two tools (`not_in_docs`, `off_topic`), each with a single required `topic: string` property. The names and the required field are referenced directly by `classifyAssistantResponse`. Don't rename, don't add required fields without updating the classifier.

### `<output_format>` block

```
Краткий ответ одним предложением.

**Путь:** Раздел → Подраздел → Кнопка

(При необходимости - нумерованные шаги.)
```

The `**Путь:**` exact spelling and the arrow-separated path format are what eval `in_corpus` cases match. Renaming "Путь" to "Маршрут" will tank the in_corpus average.

### Three `<example>` blocks

Examples teach the model the exact answer shape — change them and the bot drifts. If you add a new example, append it; don't replace existing ones.

---

## Step 2 — Make the change

Apply the edit. Stay outside the protected strings above. Common safe edits:

- Tightening or loosening length rules ("2–6 предложений" → "2–4 предложения")
- Adding a new bullet to `<rules>` (e.g. "Не используй смайлики в ответе")
- Adjusting the inviting next-step phrasing in examples (the "Зато могу помочь с..." line)
- Adding a new `<example>` block

Common unsafe edits — refuse and ask the user to confirm:

- Translating the canonical phrases to a different style ("more polite" / "more formal")
- Reordering rules so tool comes after text
- Removing the `**Путь:**` template

---

## Step 3 — Pre-flight check (before saving)

Verify the edited file still contains:

```bash
# All four checks must pass
grep -F 'В документации Clientsy я этого не нашёл. Напишите в поддержку - кнопка 🎧 на странице "Помощь".' bot/core/systemPrompt.ts
grep -F 'Я помогаю только с настройкой Clientsy.' bot/core/systemPrompt.ts
grep -F '**Путь:**' bot/core/systemPrompt.ts
grep -F 'СНАЧАЛА вызови tool' bot/core/systemPrompt.ts
```

If any returns nothing — the edit broke an invariant. Restore before continuing.

Also run a structural check:

```bash
npm run tsc                    # syntax / type errors
```

---

## Step 4 — Targeted eval

The full suite is overkill — the change usually only affects refusal categories or in_corpus formatting. Pick the slice that maps to the change:

| Change                                      | Run                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Refusal phrase wording / tool ordering      | `npm run eval -- --category=unknown_clientsy` and `--category=off_topic` |
| `<output_format>` / `**Путь:**` formatting  | `npm run eval -- --category=in_corpus`                                   |
| Length / verbosity rules                    | `npm run eval -- --category=in_corpus` and `--category=multi_step`       |
| New rule about icons                        | `npm run eval -- --category=icon_required`                               |
| Anything else / multiple categories changed | full `npm run eval`                                                      |

Compare against the most recent baseline in `bot/evals/results/` (delegate to **eval-suite** skill for the comparison if the change is broad).

---

## Step 5 — Pass criteria

- Targeted category avg Δ ≥ -0.1 vs baseline (refusals are sensitive, allow tiny drift only)
- No individual case dropping ≥ 2 points
- All four `grep` checks from Step 3 still pass after any post-eval edits

If the eval drops harder than that, the change is **rejected** — restore the protected strings and try the change differently.

---

## Severity guide

| Severity      | Trigger                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| ❌ Critical   | Canonical phrase removed/changed; `**Путь:**` removed; tool name renamed; targeted eval Δ ≥ -0.3 |
| ⚠️ Warning    | Targeted eval Δ -0.1 to -0.3; one example block lost                                             |
| 💡 Suggestion | Tone tweak that improves a category without breaking others                                      |
