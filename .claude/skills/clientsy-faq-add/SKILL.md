---
name: clientsy-faq-add
description: Adds a single FAQ card to bot/docs/{BUSINESS,CLIENT,EMPLOYEE}.md in the canonical format and creates matching eval cases in bot/evals/dataset.json. Lighter alternative to knowledge-sync — use when one Q&A needs to land but a full regen is overkill.
---

# Clientsy FAQ Add Skill — claude-chatbot

This skill writes ONE new FAQ entry into a `bot/docs/<role>.md` and pairs it with corresponding eval cases. It enforces the canonical card shape (so the doc structure stays uniform across regens) and the convention of "every doc change is verified by an eval case", which is otherwise easy to skip.

## When to use

- A single Clientsy feature needs an answer in the bot but `clientsy-app` hasn't shipped the change yet (so `knowledge-sync` would have nothing to pull)
- A small clarification card to fix a specific bot weakness surfaced by `eval-suite`
- Adding a "trick question" / counterexample to teach the bot the bounds of a feature

If multiple cards are needed, or labels across the role's UI changed — use **knowledge-sync** instead.

---

## Step 1 — Gather inputs from the user

Before writing anything, confirm:

1. **Role** — `BUSINESS` / `CLIENT` / `EMPLOYEE` (which doc file)
2. **Section** — which `### 2.X.` subsection (Начало работы / Профиль / Услуги / Клиенты / Записи / etc.); look in the file to pick the right one
3. **Question** — the user-facing question in Russian, starting with `❓`
4. **Answer body** — 1–3 sentences in Russian explaining the answer
5. **Steps** — ordered numbered steps if multi-step (≥2 actions); otherwise just a single `**Путь:**` line
6. **Path** — the canonical `Раздел → Подраздел → «Кнопка»` route, with **literal** Russian labels in `«»` quotes
7. **Icons** — any unlabeled icon buttons in the path that need emoji (✏️ Pen, 🗑️ Trash2, ➕ Plus, ↗️ ExternalLink, etc.)
8. **Note** (optional) — caveat starting with `📝 **Примечание:**`

If any of these are unclear, ask before writing — bad input creates drift that's expensive to clean up later.

---

## Step 2 — Write the FAQ card

Append the card to the chosen `### 2.X.` section. Use exactly this shape (mirror the format of existing cards in the same file):

```markdown
#### ❓ <вопрос на русском>

**Ответ:** <короткий ответ, 1–3 предложения>

1. **<шаг 1>**
   **Путь:** `Раздел → Подраздел → «Кнопка»`
2. **<шаг 2>**
   **Путь:** `Раздел → Подраздел → «Кнопка»`

📝 **Примечание:** <опционально, при необходимости>

---
```

Single-step variant:

```markdown
#### ❓ <вопрос>

**Ответ:** <ответ>

**Путь:** `Раздел → Подраздел → «Кнопка»`

---
```

Hard rules:

- Each path MUST start with the role's top-level section (`Управление`, `Профиль`, `Мои Clientsy`, `Мои записи`, etc.) — bot answers are useless without the entry point
- Russian labels go inside `«»` (the curved guillemets, not `""` or `''`) — eval criteria reference these exact characters
- Icon-only steps (no label visible in UI): include the emoji **and** a clarification phrase, e.g. `→ ✏️ (карандаш у фото)` or `→ 🗑️`
- The card ends with `---` separator on its own line

---

## Step 3 — Update the «Справочник терминов» if needed

If the new card introduces a button label that wasn't already in section 3 of the doc, add it to the appropriate row. Keep table alignment.

If it introduces a brand-new icon not in section 1's glossary, add a row there too — bot needs the visual reference to mention it correctly.

---

## Step 4 — Generate matching eval cases

Open `bot/evals/dataset.json` and append at least one case. Pick categories based on the card's nature:

| Card characteristic                        | Required eval category | Example `id` prefix              |
| ------------------------------------------ | ---------------------- | -------------------------------- |
| Answer exists in docs                      | `in_corpus` (always)   | `<role-prefix>-<verb-noun>`      |
| Path includes ≥2 numbered steps            | `multi_step`           | `<role-prefix>-<verb-noun>`      |
| Path includes an icon-only button          | `icon_required`        | `<role-prefix>-edit-avatar` etc. |
| Question is a trap (feature doesn't exist) | `unknown_clientsy`     | `<role-prefix>-<missing>`        |

`<role-prefix>` matches existing cases:

- `BUSINESS.md` cases use no prefix (e.g. `delete-service`, `invite-staff`) — owner is the default
- `CLIENT.md` cases use `client-` prefix (e.g. `client-cancel-appointment`)
- `EMPLOYEE.md` cases use `employee-` prefix (e.g. `employee-view-schedule`)

### Case template

```json
{
  "id": "<unique-id>",
  "category": "<category>",
  "question": "<the question, possibly with role disambiguation like 'Я клиент. ...'>",
  "criteria": [
    "Указан путь: Раздел → Подраздел → «Кнопка»",
    "Упомянут <конкретный элемент>",
    "Не выдумывает кнопок, которых нет в документе"
  ]
}
```

Criteria rules:

- Each criterion is one observable property of a correct answer
- Reference exact button labels in `«»` so the grader matches them in the bot's reply
- Always include "Не выдумывает …" as a guard against speculation
- For `unknown_clientsy` / `off_topic` cases, reference the canonical refusal phrase literally
- 2–4 criteria per case is typical; more than 4 = grader gets indecisive

---

## Step 5 — Run the targeted eval

Don't run the full suite — just the new cases:

```bash
# Quick way to run only the new cases: temporarily place them at the top of dataset.json
# and run with --limit, OR run the relevant categories
npm run eval -- --category=in_corpus --limit=<offset+N>
```

Better: just run the affected category for a couple cases:

```bash
npm run eval -- --category=icon_required   # if added an icon_required case
npm run eval -- --category=multi_step      # if added a multi_step case
```

---

## Step 6 — Pass criteria

For the new cases:

- Score ≥ 8 / 10 — anything below means the card or the criteria are off
- Each criterion in `weaknesses` should be either satisfied or have a tractable fix

If the score < 8, iterate:

- Score 6–7: criteria probably too strict, OR the card is missing a step the grader expects → tighten the doc, not the criteria
- Score 4–5: bot doesn't have enough info from the card; expand the answer or add a fallback step
- Score ≤ 3: card might not be in the right section / role; bot couldn't ground the answer

Don't ship cases that score < 8 — they drag the average and erode the eval's signal.

---

## Severity guide

| Severity      | Trigger                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| ❌ Critical   | New case scores < 5; English keys leaked into path; canonical card structure broken           |
| ⚠️ Warning    | New case scores 6–7; missing icon mention; criterion uses paraphrase instead of literal label |
| 💡 Suggestion | Card placed in non-obvious section; could merge with an adjacent existing card                |
