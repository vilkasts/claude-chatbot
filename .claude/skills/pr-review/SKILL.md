---
name: pr-review
description: Reviews pull requests for the claude-chatbot project. Use when reviewing PRs, checking changes, or auditing a branch before merge.
---

# PR Review Skill — claude-chatbot

This is a documentation-grounded chat bot (Anthropic Claude API) with **one core** (`bot/core/`) and **three transports** (CLI / Node server / React web). User-facing language is Russian; code is English. There are no unit tests — quality is verified via `npm run eval`.

## When to use

- Review a pull request or branch
- Check changes before merge
- Audit a feature implementation

---

## Step 1 — Gather context

Run in parallel:

```bash
git log main..HEAD --oneline
git diff main...HEAD --stat
git diff main...HEAD
```

Read the diff as a whole before evaluating individual files. Identify which transports were touched (`apps/cli`, `apps/server`, `apps/web`) and whether `bot/core` or `bot/docs` changed — these have outsized blast radius.

---

## Step 2 — Review checklist

Mark each item ✅ pass / ❌ fail / ⚠️ warning.

### Module boundaries

- [ ] **`bot/core/` stays transport-agnostic** — no `http`, `readline`, React, or DOM imports here
- [ ] **`apps/*` stays transport-only** — model/SDK calls happen through `createChatSession`, not directly
- [ ] Cross-app imports are forbidden: `apps/cli` must not import from `apps/server` (and vice versa); both go through `bot/`
- [ ] Web imports shared constants via `@bot/*` alias (not relative paths into `bot/`)
- [ ] New shared constants (welcome strings, role names) live in `bot/shared/`, not duplicated per app

### TypeScript

- [ ] No `any` — use `unknown` and narrow, or proper generics
- [ ] No type assertions (`as Foo`) without a one-line comment explaining why it's safe (current code does this — keep the pattern)
- [ ] `noUncheckedIndexedAccess` is on; new array/object indexing handles `undefined`
- [ ] Bot-core imports use `.js` extensions even though source is `.ts` (NodeNext ESM); don't switch to extensionless

### Anthropic SDK / chat core (`bot/core/chat.ts`)

- [ ] **Cache invariant preserved**: `cache_control: { type: 'ephemeral' }` stays on the system prompt AND on the **last** doc block. Adding/reordering blocks can move the breakpoint and break caching
- [ ] **History invariants preserved** in any pruning/window logic: `history[0]` is pinned (carries the docs) and the kept window starts with a `user` message
- [ ] `tool_use` blocks are NOT saved into history — only the assembled text. Adding tool blocks back will confuse the next turn
- [ ] On error in `ask`, the user message is rolled back from history (otherwise the next turn replays it as if answered)
- [ ] First-turn-only doc attachment is preserved: docs are attached when `conversationHistory.length === 0`, not on every turn

### System prompt (`bot/core/systemPrompt.ts`)

- [ ] Canonical refusal phrases match the eval dataset criteria **literally**:
  - `not_in_docs`: `«В документации Clientsy я этого не нашёл. Напишите в поддержку - кнопка 🎧 на странице "Помощь".»`
  - `off_topic`: `«Я помогаю только с настройкой Clientsy.»`
- [ ] Tool-use rules (`not_in_docs`, `off_topic`) still mandate calling tool **before** writing the canonical refusal
- [ ] Output format example block (`Краткий ответ → **Путь:** → нумерованные шаги`) preserved — bot's answer style depends on it

### Knowledge base (`bot/docs/`)

- [ ] New `.md` files follow the same structure: `0. Контекст` → `1. Глоссарий иконок` → `2. FAQ` → `3. Справочник терминов` → `4. Подсказки для бота`
- [ ] Paths use the canonical arrow format: `Раздел → Подраздел → «Кнопка»` with **exact** Russian button labels in quotes (matching `clientsy-app/src/shared/lib/i18n/locales/ru/*.json`)
- [ ] Icon-only buttons (✏️, 🗑️, ➕) are explicitly mentioned in the path, not assumed
- [ ] No invented features — every claim is backed by the source FAQ in `clientsy-app/src/widgets/business/help/data/faq-items-*.ts`

### Evals (`bot/evals/`)

- [ ] When `bot/docs/` changes, **eval cases for affected categories are updated** (`in_corpus`, `multi_step`, `icon_required`, `unknown_clientsy`)
- [ ] New eval cases include criteria covering: exact path, role-specific section, icon mention (if applicable)
- [ ] Grader contract preserved: `tool_choice: { type: 'tool', name: 'submit_grade' }` and the four required fields (`strengths`, `weaknesses`, `reasoning`, `score`)
- [ ] `temperature: 0` kept for both bot and grader — required for reproducibility
- [ ] Each eval case runs in a **fresh** session (don't refactor `runOneTestCase` to share sessions)

### Server (`apps/server/`)

- [ ] **`IS_DEV` detection** stays as `!import.meta.url.includes('/dist/')` — no `NODE_ENV` checks introduced
- [ ] CORS not reintroduced (single origin in dev and prod since the merge)
- [ ] Vite dynamically imported only inside `if (IS_DEV)` — never at top level (would pull devDep into prod runtime)
- [ ] HMR still routed through the same http server (`hmr: { server: httpServer }`); no second port leaking back in
- [ ] SSE handlers use `openSseStream` / `writeSseEvent` / `closeSseStream` from `sseRelay.ts` — no raw `res.write('event: …')`
- [ ] Disconnect handling: client `req.on('close')` still flips a flag; the model stream continues to keep history consistent

### CLI (`apps/cli/`)

- [ ] Slash commands handled via `handleSlashCommand` (not new ad-hoc `if`-chains)
- [ ] Pricing table in `PRICING_USD_PER_MILLION` matches the actually-used model (Haiku 4.5 today)
- [ ] Error split preserved: `isFatalApiError` distinguishes recoverable (rate-limit, network) from fatal (auth, bad-request); only fatal exits the REPL

### Web (`apps/web/`)

- [ ] **No `tailwind.config.js`** — Tailwind v4 config lives in `src/styles.css` under `@theme {}`. Don't introduce a JS config
- [ ] Design tokens (colors, radii, shadows, animations) added/changed in `@theme` only — no hex/rgb literals scattered in components except for one-off arbitrary values clearly tied to a token already
- [ ] `@keyframes` referenced via `--animate-*` tokens in `@theme` (not via a custom `animation:` shorthand on elements)
- [ ] No new global CSS file — extend `styles.css` if absolutely needed
- [ ] Components stay presentational; data flows through `useChat` hook + `lib/sseClient.ts`. No `fetch()` directly in components
- [ ] Session ID still persisted via `localStorage` under `clientsy.sessionId` (changing the key strands existing users)

### Build / scripts

- [ ] `dev:server` keeps `tsx watch --include=apps/server/**/*,bot/**/*` — switching to `node --watch` causes a Vite-cache restart loop
- [ ] `tsconfig.build.json` still excludes `apps/web/**` — web has its own Vite build
- [ ] New devDeps don't accidentally land in `dependencies`
- [ ] Husky `.husky/pre-commit` chain (`tsc → tsc:web → lint → format`) still green; don't `--no-verify` your way out

### Code quality

- [ ] No `eslint-disable` — fix at the source
- [ ] No `console.log` debug spam (legitimate `console.log/error/warn` for boot/error reporting is fine — match existing style with `[scope] …` prefix)
- [ ] No commented-out code left behind
- [ ] Comments default to **WHY**, not **WHAT** — match the existing codebase's style (no JSDoc on internal helpers, no narration of obvious code)
- [ ] No new `README.md` / `CLAUDE.md` / docstrings unless explicitly requested — root-level docs already exist and are maintained

---

## Step 3 — Format the review output

```
## PR Review: <branch / feature name>

### Summary
<2–3 sentences: what the PR does, overall quality signal>

### Critical Issues ❌
<Blocking — must fix before merge>

### Warnings ⚠️
<Non-blocking but should fix>

### Suggestions 💡
<Nice-to-haves, style improvements>

### Passed ✅
<Brief mention of what's done well — reinforce good patterns>
```

- Every issue must include **file path + line number**, **what's wrong**, **how to fix**.
- Skip empty sections — don't include an empty "Critical Issues" block.
- If the PR is clean, say so plainly.

---

## Step 4 — Verify tooling

After the review, run:

```bash
npm run tsc
npm run tsc:web
npm run lint
```

If `bot/core/`, `bot/docs/`, or `bot/evals/` changed, also run a focused eval pass:

```bash
npm run eval -- --limit=5                  # smoke test
npm run eval -- --category=in_corpus       # if docs changed
npm run eval -- --category=unknown_clientsy --category=off_topic  # if system prompt or tools changed
```

Compare overall avg score against the most recent file in `bot/evals/results/` — a >0.3 drop is a regression worth flagging as **Critical**.

---

## Severity guide

| Severity      | Criteria                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ Critical   | Broken cache_control, history invariants violated, canonical refusal phrase changed, transport boundary violation (`bot/core` imports DOM/http/readline), TypeScript error not caught, eval avg drops >0.3, secret committed |
| ⚠️ Warning    | Missing eval case for new doc, raw `fetch()` in component, inline hex color in JSX, `console.log` debug left in, `eslint-disable`, NodeNext `.js` extension missing, `IS_DEV` replaced with `NODE_ENV`                       |
| 💡 Suggestion | Naming improvements, extract to a helper, simplify expression, comment style nits, README/CLAUDE.md sync if a structural change happened                                                                                     |
