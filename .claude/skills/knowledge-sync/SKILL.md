---
name: knowledge-sync
description: Regenerates bot/docs/{BUSINESS,CLIENT,EMPLOYEE}.md from the sibling clientsy-app repository (FAQ data files + Russian locales). Maps lucide icons to emojis, substitutes exact translated button labels, and preserves the canonical document structure. Use when Clientsy UI changes, buttons get renamed, or new help cards are added.
---

# Knowledge Sync Skill — claude-chatbot

`bot/docs/*.md` are not free-form documentation — they mirror the help widget of the sibling app `clientsy-app` line-for-line. When Clientsy renames a button or adds an FAQ card, our docs drift. This skill rebuilds them from the upstream source so the bot's answers match the actual UI.

## When to use

- A Clientsy UI label has changed (e.g. «Услуги» → «Каталог услуг»)
- A new FAQ card was added to `clientsy-app/src/widgets/business/help/`
- A role's help structure was reorganized
- A periodic sync (every few weeks) to catch silent drift

If only **one** card needs updating, use the **clientsy-faq-add** skill instead — full regen is heavier than necessary.

---

## Step 1 — Locate the upstream source

The sibling repo lives at `../clientsy-app` (parallel to this repo's working directory). Critical paths:

| File                                                                   | Purpose                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `../clientsy-app/src/widgets/business/help/data/faq-items-business.ts` | FAQ structure for owner role (questions + step paths)   |
| `../clientsy-app/src/widgets/business/help/data/faq-items-client.ts`   | FAQ structure for client role                           |
| `../clientsy-app/src/widgets/business/help/data/faq-items-employee.ts` | FAQ structure for employee role                         |
| `../clientsy-app/src/widgets/business/help/ui/faq-card.tsx`            | `FaqCardItem` and `NavStep` types                       |
| `../clientsy-app/src/shared/lib/i18n/locales/ru/business.json`         | Russian button/section labels for owner role            |
| `../clientsy-app/src/shared/lib/i18n/locales/ru/client.json`           | Russian labels for client role                          |
| `../clientsy-app/src/shared/lib/i18n/locales/ru/employee.json`         | Russian labels for employee role                        |
| `../clientsy-app/src/shared/lib/i18n/locales/ru/common.json`           | Shared labels (`actions.add`, `navigation.bookings`, …) |
| `../clientsy-app/src/shared/lib/i18n/locales/ru/settings.json`         | Settings/role/danger-zone labels                        |

If `../clientsy-app` is missing, ask the user for the path before proceeding.

---

## Step 2 — Detect drift

Compare modification times of FAQ source files against current docs. If `faq-items-business.ts` is newer than `bot/docs/BUSINESS.md`, that file likely needs a refresh.

```bash
ls -la ../clientsy-app/src/widgets/business/help/data/faq-items-*.ts
ls -la bot/docs/*.md
```

Pick the role(s) that changed. Don't regenerate roles that are already in sync — eval scores for those will only go down with churn.

---

## Step 3 — Build a t-key resolver

The FAQ data files reference i18n keys via `tBusiness("...")`, `tCommon("...")`, `tSettings("...")`, etc. To translate a key like `tCommon("actions.share")` you load `common.json` and walk the path → `"Поделиться"`.

Build (in your head or as a small script) a lookup helper:

```ts
function resolve(
  scope: "business" | "client" | "employee" | "common" | "settings",
  key: string,
  vars?: Record<string, string>,
): string;
```

Apply `{{var}}` substitutions found in the FAQ data calls — they're inline in `faq-items-*.ts` like `tBusiness(`${f}.gettingStarted.step1`, { section: tBusiness("services.title") })`.

---

## Step 4 — Map lucide icons to emoji

The FAQ data uses lucide-react components. Use this canonical mapping (already used in the existing docs):

| Lucide                  | Emoji | Used for                            |
| ----------------------- | ----- | ----------------------------------- |
| `Plus`                  | ➕    | Add / create                        |
| `Pen`                   | ✏️    | Edit (often unlabeled near avatar)  |
| `Trash2`                | 🗑️    | Delete (round button without label) |
| `ExternalLink`          | ↗️    | Share                               |
| `ToggleLeft`            | 🔘    | Active/inactive switch              |
| `CircleAlert`           | ⚠️    | Danger zone marker                  |
| `Ban`                   | 🚫    | Block client                        |
| `User`                  | 👤    | Role section                        |
| `UserCircle`            | 👤    | Client profile section              |
| `CircleUser`            | 👤    | Employee profile section            |
| `Settings`              | ⚙️    | Settings                            |
| `Headset`               | 🎧    | Support                             |
| `CreditCard`            | 💳    | Subscription                        |
| `Heart`                 | ❤️    | Client appointments tab             |
| `CalendarPlus`          | 📅➕  | Client booking tab                  |
| `CalendarDays`          | 📅    | Bookings list                       |
| `CalendarClock`         | 📅⏰  | Schedule                            |
| `CalendarX`             | 📅✖️  | Cancel booking                      |
| `BarChart3`             | 📊    | Analytics                           |
| `BriefcaseBusinessIcon` | 💼    | Management hub / workplace switcher |
| `Building2`             | 🏢    | Business profile                    |
| `ClipboardList`         | 📋    | Services                            |
| `Users`                 | 👥    | Team / specialists                  |
| `Users2`                | 👥    | Clients tab / role hint             |
| `MessageCircle`         | 💬    | Telegram chat with master           |
| `Search`                | 🔎    | Phone search                        |
| `Bell`                  | 🔔    | Reminder                            |

Don't invent new mappings — if you see an unfamiliar lucide name, check existing `bot/docs/*.md` for precedent or ask the user.

---

## Step 5 — Preserve the canonical structure

Every regenerated `.md` must follow the same six-section template (look at the existing files for the exact form):

```
# Clientsy — справочник по роли «<Роль>»

> Вводный абзац (источник, версия)

---

## 0. Контекст приложения
<Таблица доступных разделов с иконкой и расположением>

## 1. Глоссарий иконок и базовых элементов
<Таблица иконка → визуал → значение>

## 2. FAQ — вопросы и ответы
### 2.1. Начало работы
#### ❓ <вопрос>
**Ответ:** ...
1. **<шаг>**
   **Путь:** `Раздел → Подраздел → «Кнопка»`

## 3. Справочник терминов и подписей кнопок
<Таблица «Раздел → точные подписи»>

## 4. Подсказки для бота-помощника
<Список инвариантов и реминдеров>
```

The path format `Раздел → Подраздел → «Кнопка»` is **load-bearing** — eval `in_corpus` cases match against `**Путь:**` and the arrow shape. Don't switch to bullet-paths or different separators.

Quoted button labels must be **literal Russian strings from the locale** — never English keys, never paraphrases. `«Назначить»` is fine, `«Assign»` or `«assignServices.assign»` is not.

---

## Step 6 — Write the file

Replace the entire `bot/docs/<ROLE>.md` content. Don't try to surgically merge — the FAQ source is the truth, and incremental edits accumulate drift.

Keep the **«Подсказки для бота-помощника»** section in section 4 — these aren't in the FAQ data, they're project-specific learnings (e.g. "ссылка-приглашение действует до конца дня", "региональные настройки не меняются"). Preserve them across regenerations unless the underlying behavior changed.

---

## Step 7 — Update eval cases

Regenerating a doc usually invalidates eval cases for that role. For each role you regenerated:

1. Open `bot/evals/dataset.json` and find cases whose `id` references that role (e.g. `client-cancel-appointment`, `employee-view-schedule`).
2. Re-read the criteria — if the path or button label changed in the doc, update the criterion text to match.
3. If a new FAQ card was added, add a new eval case (delegate to **clientsy-faq-add** skill for the canonical case shape).

---

## Step 8 — Run eval-suite

Delegate to the **eval-suite** skill (or run manually):

```bash
npm run eval -- --category=in_corpus
npm run eval -- --category=icon_required   # if any icon-only path changed
npm run eval -- --category=multi_step      # if any multi-step answer changed
```

Pass criteria:

- For the regenerated role's cases: avg Δ ≥ -0.1 vs baseline
- No individual case dropping ≥ 2 points
- No case scoring 0 (would mean a path is unparseable)

If a case drops, the regen probably introduced a label that doesn't match the eval criteria — fix either the criterion (if the UI truly changed) or the regenerated doc (if a label got mistranslated).

---

## Severity guide

| Severity      | Trigger                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| ❌ Critical   | English keys leaked into paths; canonical structure (section 0–4) broken; in_corpus Δ ≥ -0.3 |
| ⚠️ Warning    | New unfamiliar lucide icon mapped without precedent; multi_step Δ -0.1 to -0.3               |
| 💡 Suggestion | Section 4 hints could be expanded based on new FAQ content                                   |
