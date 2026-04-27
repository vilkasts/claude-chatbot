---
name: eval-suite
description: Runs the bot eval harness with filters, compares the run against the most recent baseline in bot/evals/results/, and flags regressions. Use after any change to bot/docs/, bot/core/, or bot/evals/dataset.json — and before merging a branch.
---

# Eval Suite Skill — claude-chatbot

This project has no unit tests. The eval harness in `bot/evals/` is the **only** quality gate. This skill runs it intelligently — never the full suite when a smaller slice will do — and compares against the last saved run to catch silent regressions.

## When to use

Invoke this skill whenever the change touches anything that affects bot output:

- `bot/docs/*.md` changed (knowledge base)
- `bot/core/chat.ts` or `bot/core/systemPrompt.ts` changed (model interaction)
- `bot/evals/dataset.json` changed (new cases or criteria)
- Model or temperature in `DEFAULT_CONFIG` / `GRADER_MODEL` changed

Do **not** invoke for purely cosmetic changes (formatting, typo fixes outside refusal phrases, JSDoc edits).

---

## Step 1 — Pick the right slice

Don't run the whole dataset by default — it's slow and expensive. Pick the narrowest slice that covers the change:

| Change                                    | Run                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One doc file (e.g. `CLIENT.md`)           | `npm run eval -- --category=in_corpus` (then check that role's cases manually)                  |
| `systemPrompt.ts` refusal rules           | `npm run eval -- --category=unknown_clientsy` and `--category=off_topic` (run both)             |
| New FAQ card + new eval cases             | `npm run eval -- --limit=N` where N = enough to include the new cases (they're appended at end) |
| Multi-step / numbered-answer changes      | `npm run eval -- --category=multi_step`                                                         |
| Icon-only buttons documentation           | `npm run eval -- --category=icon_required`                                                      |
| `chat.ts` core (cache, history, tool_use) | full `npm run eval` — too many failure modes to predict                                         |
| Model/temperature change                  | full `npm run eval`                                                                             |

When in doubt, run the full suite — but always default to a slice first if the change is local.

---

## Step 2 — Capture baseline

Find the most recent results file BEFORE running:

```bash
ls -t bot/evals/results/results-*.json | head -1
```

Read it (`overallAvg`, `byCategory`, individual `results[].grade.score` per `id`) and keep it in working memory as the baseline. **Don't** run the eval first — Node will create a new file and your "baseline" becomes the run you just did.

If `bot/evals/results/` is empty (fresh repo / cleaned up), there is no baseline — skip the comparison step and just report absolute scores.

---

## Step 3 — Run the eval

```bash
npm run eval                              # full
npm run eval -- --category=<name>         # one category
npm run eval -- --limit=<N>               # first N cases
```

Output is appended to a new `bot/evals/results/results-<timestamp>.json`. The runner already prints a summary (overall avg, per-category avg, worst 3) — don't duplicate that. Build on top of it.

---

## Step 4 — Compare against baseline

Read the new results file, then compare to the baseline captured in Step 2. Surface:

### ❌ Critical regressions

- **Overall avg drop ≥ 0.3** (e.g. 9.49 → 9.10 or worse)
- **Any category avg drop ≥ 0.3** even if overall is stable (a category-level cliff is the strongest signal)
- **Any individual case dropping ≥ 2 points** (e.g. 10/10 → 8/10) — the grader is deterministic at `temperature: 0`, so a 2-point swing means content drift, not noise
- **Score = 0** on any case (means the bot or grader crashed — see `error` field)

### ⚠️ Warnings

- Overall avg drop 0.1–0.3 (could be drift, watch over the next few runs)
- A previously-perfect (10/10) case dropped to 9/10 (acceptable but note it)

### ✅ Improvements

- Briefly mention any score increases — useful when the change was meant to fix something

---

## Step 5 — Diagnose the worst cases

For each ❌ regression, read the `weaknesses` and `reasoning` fields from the new results JSON:

```bash
# Pull the worst N cases programmatically (if shell scripting is easier)
node -e "const r=require('./bot/evals/results/results-<TS>.json'); console.log(r.results.sort((a,b)=>a.grade.score-b.grade.score).slice(0,3).map(c=>({id:c.id,score:c.grade.score,why:c.grade.weaknesses})))"
```

The grader's `weaknesses` field is direct and actionable. Common patterns and their fixes:

| Grader complaint                                  | Likely cause                             | Where to fix                                       |
| ------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| "missing intermediate step", "path is incomplete" | doc path skips a UI step                 | `bot/docs/<role>.md` — expand the `**Путь:**` line |
| "speculative information not in docs"             | doc adds prose beyond the source FAQ     | `bot/docs/<role>.md` — trim the **Примечание**     |
| "wrong refusal phrase" / "didn't say literally X" | system prompt phrase changed             | `bot/core/systemPrompt.ts` — restore exact phrase  |
| "added unrequested information"                   | bot is too verbose                       | `bot/core/systemPrompt.ts` — tighten output rules  |
| "didn't mention icon"                             | icon-only button described without emoji | `bot/docs/<role>.md` — add 🗑️/✏️/➕ to path        |

Propose targeted edits in the report — don't make them automatically (let the user decide).

---

## Step 6 — Format the output

```
## Eval Run: <slice or "full">

### Summary
<2 sentences: ran N cases, overall avg X.XX (Δ vs baseline), Y regressions / Z improvements>

### Critical Regressions ❌
- [<id>] <baseline>/10 → <new>/10 — <weakness from grader>
  Suggested fix: <file>:<line> <what to change>

### Warnings ⚠️
- [<id>] minor drift (<baseline>/10 → <new>/10)

### Improvements ✅
- [<id>] <baseline>/10 → <new>/10

### Per-category snapshot
| Category | Baseline | Now | Δ |
|---|---|---|---|
| in_corpus | 9.80 | 9.50 | -0.30 ⚠️ |
| ...
```

Skip empty sections.

---

## Severity guide

| Severity    | Trigger                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| ❌ Critical | Overall avg Δ ≥ -0.3, category Δ ≥ -0.3, individual case Δ ≥ -2, any score = 0 |
| ⚠️ Warning  | Overall Δ -0.1 to -0.3, individual case 10→9                                   |
| 💡 Note     | Improvements (any positive Δ), or stable run worth recording                   |
