# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A documentation-grounded chat bot for the **Clientsy** booking app. The bot answers user questions strictly from markdown files in `bot/docs/` (one per role: business owner, employee, client) and explicitly refuses anything outside that corpus. Same bot is exposed via three transports — CLI, HTTP+SSE, and a React web client — that all share one core.

User-facing language is **Russian** (system prompt, refusal phrases, eval criteria, UI). Code identifiers and comments are English. Don't translate the canonical refusal phrases; eval grader matches them literally.

## Commands

```bash
# Dev (separate processes)
npm run dev:cli                       # CLI REPL with watch
npm run dev:server                    # API + Vite middleware on :3000 (single port)

# Build + prod start
npm run build                         # build:node + build:web
npm run start:cli                     # run compiled CLI
npm run start:server                  # run compiled server (serves apps/web/dist)

# Type-check / lint / format (pre-commit hook runs these in order)
npm run tsc                           # cli + server (excludes apps/web)
npm run tsc:web                       # web only
npm run lint                          # eslint --fix .
npm run format                        # prettier --write .

# Evals
npm run eval                          # whole dataset
npm run eval -- --category=in_corpus  # one category
npm run eval -- --limit=5             # first N cases
```

There is no test runner — quality is verified through the eval harness, not unit tests. To check a single eval case, use `--limit=1` with a filter, or temporarily edit `bot/evals/dataset.json`.

## Architecture

### One core, three transports

`bot/core/chat.ts` exports `createChatSession({ system, docs })` returning `{ ask, reset, history }`. CLI, server, and web all consume this same factory:

- **CLI** (`apps/cli/index.ts`) — readline REPL, prints streaming chunks to stdout, computes per-request USD cost from `usage` (Haiku-4.5 pricing table inline). Slash commands: `/reset`, `/usage`, `exit`.
- **Server** (`apps/server/index.ts`) — raw `http.createServer`, exposes `POST /api/chat` (SSE) and `POST /api/reset`. In dev, dynamically imports Vite and attaches `vite.middlewares` to GET requests; in prod, serves prebuilt `apps/web/dist/`. Single port :3000 in both modes.
- **Web** (`apps/web/`) — React 19 + Vite + Tailwind v4, talks to the same server via `useChat` hook + `lib/sseClient.ts`. The `@bot/*` alias lets the browser bundle import constants from `bot/shared/` (e.g. `WELCOME_MESSAGE`).

When changing the conversation contract (history shape, classification kinds, refusal phrases), check **all three** transports — they're loosely coupled through `AskResult`.

### Dev/prod detection without NODE_ENV

`apps/server/index.ts` uses `IS_DEV = !import.meta.url.includes('/dist/')` to branch between Vite-middleware mode and static serving. This works on Windows without `cross-env`. **Don't introduce `NODE_ENV` checks elsewhere** — keep this single detection point.

### Prompt caching is the pricing story

`bot/core/systemPrompt.ts:buildInitialUserContent` attaches every doc as a `document` content block on **turn 1 only**, with `cache_control: { type: 'ephemeral' }` on the **last** doc (the breakpoint covers every block before it). The system prompt also has its own cache_control. So turns 2+ pay ~10% on the cached prefix. If you change the docs or system prompt mid-session, the cache invalidates and the next turn pays full price.

### History pruning has invariants

`pruneHistoryIfTooLong` in `bot/core/chat.ts` enforces:

1. `history[0]` is **pinned** (it carries the docs — dropping it loses both context and the cache hit).
2. The window after pinning must start with a `user` role; leading `assistant` messages get shifted off, otherwise Anthropic rejects the request.

If you touch history management, preserve both invariants.

### Refusals via tool_use, not regex

The bot can call two tools (`not_in_docs`, `off_topic`) to _classify_ its own reply alongside the text. `classifyAssistantResponse` reads the tool_use blocks but the user-facing message is the model's text reply. Tool input goes into `AskResult.kind` / `AskResult.topic` for telemetry. **Don't strip these tools** — eval cases in categories `unknown_clientsy` and `off_topic` depend on the canonical phrases the rules dictate after a tool call.

When the model calls a tool but emits no text (rare), `FALLBACK_TEXT_BY_KIND` injects the canonical phrase so the user always sees something. **Tool_use blocks are not saved into history** — only the plain text — because unmatched tool_use without a tool_result confuses the next turn.

### Evals

`bot/evals/runEval.ts` runs each case in a **fresh session** (no leakage). The grader (`bot/evals/grader.ts`) is a separate `claude-haiku-4-5` call with `tool_choice: submit_grade` forced — this guarantees a structured `{ strengths, weaknesses, reasoning, score }` response without text-parsing.

Categories in `dataset.json` are descriptive labels for reporting:

- `in_corpus` — answer exists in docs, must give exact path.
- `unknown_clientsy` — feature doesn't exist, must refuse with the literal phrase.
- `off_topic` — not about Clientsy, must refuse with the off-topic literal phrase.
- `multi_step` — must produce a numbered list of ≥2 steps.
- `icon_required` — UI button has no label, must mention the icon.

Adding a new doc to `bot/docs/`? Add corresponding test cases for **each** category that applies. The runner picks up new `.md` files automatically (`loadDocs` scans the directory).

### Knowledge base sourcing

`bot/docs/{BUSINESS,CLIENT,EMPLOYEE}.md` are NOT free-form. They mirror the Clientsy app's help widget verbatim — source files live in the sibling repo at `../clientsy-app/src/widgets/business/help/data/faq-items-*.ts` plus locales `../clientsy-app/src/shared/lib/i18n/locales/ru/*.json`. When the app's UI labels change, regenerate these docs from those sources. Each MD file follows the same structure: `0. Контекст` → `1. Глоссарий иконок` → `2. FAQ` → `3. Справочник терминов` → `4. Подсказки для бота`. Keep the structure consistent across roles — the embedder/RAG retrieves better with uniform shapes.

## Conventions worth knowing

- **Import paths to bot/core use `.js` extensions** (`from '../../bot/core/chat.js'`) even though the source is `.ts`. This is required for NodeNext ESM module resolution. The `apps/web` side imports from `@bot/*` alias instead.
- **`tsconfig.build.json` excludes `apps/web/**`** — the Node build (`build:node`) compiles only CLI + server. Web is a separate Vite build (`build:web`).
- **`dev:server` uses `tsx watch` with explicit `--include`**, not `node --watch`. Reason: `node --watch` in Node 20+ also watches files imported from `node_modules`, and Vite touches its dep cache on startup → restart loop. Don't switch back to `node --watch` here. CLI is fine with `node --watch` because it doesn't import Vite.
- **CORS is intentionally absent**. Same origin everywhere now (Vite middleware + API on :3000 in dev, prod is one port too). Don't reintroduce it.
- **Tailwind v4 — no `tailwind.config.js`**. Design tokens live in `apps/web/src/styles.css` under `@theme {}`; keyframes are plain CSS but referenced via `--animate-*` vars in `@theme` to generate `animate-*` utilities.
- **Pre-commit hook** runs `tsc → tsc:web → lint → format` via Husky v9 (`.husky/pre-commit`). Hook runs scripts that _modify files_ (`--fix`, `--write`); if they touch your staged files, the auto-fixes land in your working copy but **not in the commit** — re-stage and amend or make a new commit. There is no `lint-staged` integration.
- **Comments default to none**. The codebase already has WHY-style comments where the reasoning is non-obvious; don't add WHAT-style narration.

## Models

- Bot: `claude-haiku-4-5` (`bot/core/chat.ts` → `DEFAULT_CONFIG`).
- Grader: `claude-haiku-4-5` (`bot/evals/grader.ts` → `GRADER_MODEL`).

`temperature: 0` in both — required for eval reproducibility.
