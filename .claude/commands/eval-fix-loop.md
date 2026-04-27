---
description: Eval → diagnose → fix → eval loop. Runs the bot eval suite, finds the worst case, applies a targeted fix, and re-runs the eval. Iterates up to 3 times or until green.
---

You are running the **eval-fix-loop** workflow. This is a deterministic pipeline — follow the steps in order without skipping or reordering. Maximum **3 iterations**, then stop and report regardless of outcome.

## Loop variables

Maintain across iterations:

- `iteration` — current attempt (1, 2, 3)
- `baseline_avg` — the avg score from the eval run BEFORE iteration 1's fix
- `current_avg` — the avg score after the most recent run
- `worst_case` — `{ id, score, weakness }` from the most recent run
- `attempted_fixes` — list of `{ id, file, summary }` for diff-tracking

---

## Iteration 1 — Establish baseline

### 1.1 Run the eval suite

Use the **eval-suite** skill (or invoke directly):

```bash
npm run eval
```

Read the resulting `bot/evals/results/results-<TS>.json`. Record:

- `overallAvg` → set as `baseline_avg`
- All cases sorted by `grade.score` ascending → take the worst one as `worst_case`

If `baseline_avg ≥ 9.5` AND `worst_case.score ≥ 9` — **the suite is already green**. Exit immediately with:

```
✅ Suite is green (avg=<X.XX>). No fix needed.
```

### 1.2 Pick the fix target

If `worst_case.score < 8`, that's a real problem worth fixing. Continue.

If the worst case is between 8 and 9 inclusive — minor drift, the suite is "good enough". Optionally fix; otherwise exit cleanly with a note that no fix is required.

### 1.3 Diagnose & propose

Read `worst_case.weakness` (the grader's complaint). Map it to a fix location using this table (same as `eval-suite` Step 5):

| Grader complaint pattern                                | Fix in                     | What to change                                   |
| ------------------------------------------------------- | -------------------------- | ------------------------------------------------ |
| "missing intermediate step", "path is incomplete"       | `bot/docs/<role>.md`       | expand the `**Путь:**` line for that case        |
| "speculative" / "added unrequested information"         | `bot/docs/<role>.md`       | trim a Note or extra prose                       |
| "didn't say literally X" / "wrong refusal phrase"       | `bot/core/systemPrompt.ts` | restore exact canonical phrase                   |
| "didn't mention icon"                                   | `bot/docs/<role>.md`       | add 🗑️/✏️/➕/etc. to the path                    |
| "no numbered steps" (multi_step category)               | `bot/docs/<role>.md`       | reformat answer as numbered list                 |
| "wrong category" / "answer doesn't match question role" | `bot/docs/<role>.md`       | check role file scope (BUSINESS/CLIENT/EMPLOYEE) |

Determine the file to edit. Read the relevant section of that file (find the FAQ card matching `worst_case.id` by searching for the question keyword).

### 1.4 Apply the fix

Make the smallest possible edit that addresses the weakness:

- For path fixes: edit the `**Путь:**` line for the affected card.
- For phrase fixes: restore the exact string in `systemPrompt.ts`.
- For icon fixes: add the emoji and the parenthetical clarifier to the path.

**Do not** also "improve" adjacent unrelated content. The smaller the diff, the easier to bisect if the next eval gets worse.

Record the edit into `attempted_fixes`.

---

## Iterations 2 and 3 — Verify and iterate

### Run targeted eval

If iteration 1 fixed a single category, run only that category:

```bash
npm run eval -- --category=<the affected category>
```

If the fix touched `systemPrompt.ts`, run BOTH refusal categories:

```bash
npm run eval -- --category=unknown_clientsy
npm run eval -- --category=off_topic
```

### Compare

Read the new results file. Compute:

- `current_avg` from the new file's `overallAvg`
- New score for `worst_case.id`

Compare to baseline AND the run from the previous iteration:

| Outcome                                                           | Action                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `worst_case` score went up AND `current_avg ≥ baseline_avg`       | ✅ Fix landed. If new worst case is still < 8, do another iteration. Else exit.    |
| `worst_case` score went up BUT `current_avg < baseline_avg - 0.1` | ⚠️ Side effect — fix helped one case, hurt another. Exit and report both deltas.   |
| `worst_case` score didn't change                                  | ❌ Fix didn't take. Revert via `git checkout -- <file>`. Try a different approach. |
| `worst_case` score went down OR a previously 10/10 case dropped   | ❌ Regression. Revert via `git checkout -- <file>`. Exit immediately.              |

### Iteration cap

After **3 fix attempts** total, stop unconditionally. Even if the suite is still red, don't run a 4th iteration — that's a sign the diagnosis is wrong and a human should look at it.

---

## Final report

Emit ONE block at the end:

```
## eval-fix-loop report

**Baseline:** avg=<X.XX>, worst=<id>@<score>/10
**After <N> iteration(s):** avg=<Y.YY>, worst=<id>@<score>/10

### Fixes applied
1. <file> — <one-line summary> — <case score: N → M>
2. ...

### Outcome: <one of: ✅ GREEN / ⚠️ PARTIAL / ❌ STUCK / ❌ REGRESSED-REVERTED>

### Notes
<one paragraph: what worked, what didn't, recommended next step if not GREEN>
```

### Outcome criteria

- **✅ GREEN** — `current_avg ≥ baseline_avg` AND `worst_case.score ≥ 8`. Done.
- **⚠️ PARTIAL** — improved but still below threshold. Report and let the user decide whether to push further.
- **❌ STUCK** — 3 iterations spent, no improvement. Recommend escalating to `bot-guardian` agent or reviewing manually.
- **❌ REGRESSED-REVERTED** — a fix made things worse and was rolled back. Report which file and what was tried.

---

## Operating constraints

- **Never** edit `bot/evals/dataset.json` to make a failing case pass — that defeats the eval. If a criterion seems wrong, surface it and exit; don't silently relax it.
- **Never** run the full eval inside the loop — only iteration 1's baseline is full. Subsequent runs are targeted.
- **Never** skip the revert when a fix regresses. `git checkout -- <file>` is fast and the alternative is accumulating broken state across iterations.
- If the user invoked `/eval-fix-loop` without a prior baseline, iteration 1's full run IS the baseline. Don't run two full evals.

You are a deterministic pipeline. No improvisation, no "while I'm here" cleanups.
