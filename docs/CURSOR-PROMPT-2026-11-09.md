# Cursor prompt: four additions, five streamlines, six UX fixes

Written 2026-11-09 against `main` at commit `2a19f0b`. Paste this whole file into Cursor, or tell Cursor: "Follow docs/CURSOR-PROMPT-2026-11-09.md".

---

You are working in the `rop-workflow` repo (Next.js, TypeScript, Supabase, Drizzle, Zod, Claude API). Build the 15 items below. Most of them extend something that already exists, so read before you write.

## How to work

1. **Read first.** Before changing anything, read the files named under each item, then give me a short plan per item: what exists, what is missing, which files you will touch and any schema change. Wait for my go.
2. **One branch per item,** named `feature/<short-name>`, in the order listed. Finish, show me, merge, then start the next. Do not batch.
3. **Extend, don't duplicate.** If a check, table, route or component already does part of the job, add to it. No parallel versions.
4. **Keep the house rules already in the code:**
   - Every user-facing string goes through i18n in all four languages (`src/lib/i18n/en.ts`, `es.ts`, `fa.ts`, `ps.ts`).
   - Every AI prompt that writes for people uses the voice rules in `src/lib/voice.ts`.
   - Personal data rules in `docs/DATA-PROTECTION.md` hold. Names and identifying answers never reach the AI.
   - AI proposes, a named person confirms. No AI output is saved as final.
   - Every create, change, approval and AI action writes to the audit log.
   - Schema changes go through `src/db/schema.ts` and `npm run db:generate`. Commit the migration.
   - Synthetic data only in seeds and tests.
5. **Lint, typecheck and build must pass** before you tell me an item is done.
6. **Phone first.** Every new screen must work at 380px wide with one-thumb actions.

## Do not touch

Leave all of these exactly as they are. Do not remove, hide, refactor or "tidy" them:

- Proposal drafting and lens review (`src/lib/lens-review.ts`, `setup/lens`)
- The Timeline view and its lock (`timeline-view.tsx`, `locked-feature.tsx`, `src/lib/plans.ts`)
- The Resources tab
- HR, payroll, leave, timesheets, expenses, onboarding and offboarding
- Learning and lessons (`progress/learning`)
- Opportunities and track record
- Market windows
- The AI assistant, photo coaching and posts
- Any existing AI job. Do not merge or remove agents.

---

# Part A: four additions

## A1. Report pre-flight check
**Branch:** `feature/report-preflight`

**Exists:** `src/lib/qpr.ts` builds a list of checks with level `stop` or `check`. `src/server/next-report.ts` turns the same data into Home's "Next report" items grouped by owner. `src/server/claim-check.ts` compares drafted text with accepted results.

**Build:** one pre-flight screen that a person sees before any report export or release (quarterly, annual, FACE).

- One list, three groups: **Blocks the report**, **Worth fixing**, **Ready**. Each row says what is wrong in one line, who owns it and links straight to the place to fix it.
- Reuse the checks in `qpr.ts`, `next-report.ts` and `claim-check.ts`. Do not write a second set of rules.
- Add the checks that are missing today. Confirm each is missing before adding it:
  - a target with no result at all in the period
  - an accepted result with no proof (exists as a soft check; keep it soft)
  - imported spend rows that match no budget line
  - a required sign-off that has not happened (plan and budget, data acceptance, report release)
  - a donor reporting deadline that is past or within 7 days
- The export and release buttons show the count of blocking items. With blockers present, release is disabled and export is allowed only with a clear "draft, not checked" mark on the file.
- Home's "Next report" line and this screen must read from the same function so they never disagree.

**Done when:** on the seeded project I can open pre-flight, see every blocker with a working link, clear them and watch the release button unlock.

## A2. Click any number, see its proof
**Branch:** `feature/number-to-proof`

**Exists:** `qpr-page.tsx` says each figure opens the records and proof behind it. An evidence annex exists in `src/server/outputs.ts` and `downloads.tsx`. Share links exist in `share-store.ts`.

**Build:**

- **Audit first.** List every screen and export that shows a reported number: quarterly report, annual report, FACE form, Progress, Home, monthly review, share links. For each, tell me whether the number opens its records and proof today.
- Close every gap so the rule is absolute: **no reported number without a path to its proof.** On screen that is one tap to a panel listing the accepted results behind the figure, each with its proof (Kobo submission, photo, scan, document) plus who accepted it and when.
- In Word and PDF exports, each figure carries a short reference (for example `[E-014]`) that matches an entry in the evidence annex.
- Add an **Evidence pack** download per report period: the annex, the proof files it lists and the audit log extract for the period, in one zip with an index file. Apply the same personal data rules as the photo library. Nothing a person did not consent to share goes in.
- A number with no proof shows a plain "No proof yet" mark instead of a dead link.

**Done when:** I can pick any five numbers in an exported quarterly report and find each one in the evidence pack.

## A3. Three uploads to a running project
**Branch:** `feature/setup-three-uploads`

**Exists:** `src/server/setup-extract.ts` and `src/components/setup/from-documents.tsx` read the agreement and the logframe and propose name, donor, country, dates, goal and every indicator with donor code, unit, target and yearly targets. Setup copy says deadlines and codes go in settings later.

**Build:** extend the same flow so three documents produce a project that is ready to run.

- **Third upload: the budget** (Excel, Word or PDF). Propose budget lines with code, description, amount, currency and period. Use `src/lib/read-sheet.ts` for workbooks. Link each line to an activity only where the documents say so. Otherwise leave it for the person.
- **From the agreement, also extract:**
  - reporting obligations: report type, frequency, due dates and required format. These become dated milestones in Tasks and feed the pre-flight deadline check in A1.
  - donor rules that can be checked: procurement thresholds, cost limits such as overhead caps, required documents and approval rules. These go to the existing policy area (`src/lib/policy.ts`, `policy-store.ts`) as proposals.
- Every proposed value shows where it came from ("Agreement, clause 8.2", "Budget, row 14"), as indicators already do with `source`.
- Keep the rule already in the prompt: take every value from the documents, never invent, put anything unclear in `questions`.
- The person confirms section by section: project, indicators, budget, deadlines, rules. Nothing saves until confirmed. Each section can be skipped.
- Any one of the three documents alone must still work.

**Done when:** from the three seeded sample documents, a new project reaches Home with indicators, budget lines, report deadlines on the calendar and donor rules in policy, with me only confirming.

## A4. Kobo question-to-indicator suggestions
**Branch:** `feature/kobo-mapping-suggest`

**Exists:** `src/components/setup/kobo-steps.tsx` asks "Which question counts toward each indicator?" and saves through `kobo/mappings`. Today the only guess is the form's purpose from its name (`guessPurpose` in `src/lib/kobo-setup.ts`). Mapping methods are in `MAPPING_METHODS`.

**Build:**

- When the mapping step opens, AI proposes for each indicator the form, the question and the mapping method, with a one-line reason and a confidence of high, medium or low.
- Send the AI only form names, question labels, question types and choice lists plus indicator names, units and donor codes. Never send submissions or answers.
- Show proposals as a list the person accepts one by one or all high-confidence at once. Low confidence is never pre-selected. Indicators with no good match say so plainly and stay unmapped.
- Flag two risks in the same list: one question mapped to two indicators and an indicator whose unit does not fit the question type.
- Saved mappings record whether they came from a suggestion or by hand.
- If `ANTHROPIC_API_KEY` is missing, the step works exactly as it does now.

**Done when:** on the seeded Kobo forms, the suggestions map the obvious questions correctly and I can finish mapping in under 5 minutes.

---

# Part B: five streamlines

## B1. Review queue: accept the clean, review the flagged
**Branch:** `feature/review-queue-batch`

**Exists:** bulk accept of unflagged results (phase 2) in `results-page.tsx` and `results-store.ts`; checks in `src/lib/data-checks.ts`.

**Build:** make the top of the queue one sentence with two actions: "47 clean, 3 flagged. **Accept 47** · **Review 3**". Flagged results open one at a time with the reason for the flag in one line and Accept or Query as large buttons. Bulk accept still writes one audit entry per result. Confirm the current screen against this and change only what differs.

## B2. Solo mode for sign-offs
**Branch:** `feature/solo-signoff`

**Exists:** signers and authority in `src/lib/authority.ts`, role presets in `src/lib/presets.ts`, guards in `src/server/guard.ts`.

**Build:** an organization setting, off by default, for small teams where one person holds several roles.

- With it on, the same person may prepare and approve. Each time, they see a short statement to confirm ("I prepared this and I am approving it myself") and may add a note.
- The audit log marks every such approval as self-approved. Reports and the evidence pack show the count of self-approved items for the period.
- Never allowed in solo mode: procurement awards above the policy threshold and anything a donor rule from A3 says needs a second person. Those still need two people.
- Only an organization admin can turn it on. Turning it on or off is logged.

## B3. Spend import from any spreadsheet
**Branch:** `feature/spend-import-generic`

**Exists:** `src/lib/bva.ts` reads Finance's "ICE Report" workbook. `src/lib/read-sheet.ts` reads workbooks. `budget-view.ts` builds the view.

**Build:** keep the ICE reader as the first path. When a file is not in that shape, offer a second path.

- AI looks at the header rows and a few sample rows and proposes which columns are budget line, description, amount, date or month and currency. The person confirms the column mapping before any rows are read.
- Rows are then matched to budget lines by code first, then by description. Unmatched rows are listed for the person to assign or leave out. Unmatched rows feed the A1 check.
- Save the confirmed column mapping per project so next month's file imports in one step.
- Only headers and a few sample rows go to the AI. Strip anything that looks like a person's name first, using the existing name handling.
- Works for .xlsx and .csv exports from QuickBooks, Excel and NetSuite.

## B4. Kobo nightly reconcile
**Branch:** `feature/kobo-nightly-reconcile`

**Exists:** the webhook at `kobo/hook`, manual and auto sync in `src/server/kobo-link.ts` (`sync`), handling of deleted pending checks in `src/server/kobo.ts` and the `kobo_changed_after_acceptance` audit action in `kobo-results.ts`. `vercel.json` has two crons, neither for Kobo.

**Build:** a nightly job that runs `sync` for every project with Kobo connected, so edits and deletions made in Kobo after the webhook fired are caught.

- Changes to a pending result update it. Changes to an accepted result never change the counted figure silently: they raise a flag for MEL and write the existing audit action.
- Deletions of accepted results are flagged the same way, not applied.
- Each run records counts per project on the health page (`settings/health`).
- Check the Vercel plan's cron limit first. If a third cron is not allowed, run this inside the existing nightly digest job.

## B5. One source of truth for the docs
**Branch:** `feature/docs-current`

**Exists:** `README.md` still says "untested prototype", shows the phases unchecked and describes records saved in the browser. `docs/ROP-PROJECT-HARNESS-BUILD-SPEC-v1.md` describes five stages and a Western Highlands pilot.

**Build:** documentation only, no code.

- Rewrite `README.md` to describe the app as it is on `main`: the real navigation, what is built, what is not and how to run it.
- Add `docs/CURRENT-STATE.md`: one table of every feature area with status (built, partial, planned), the main files and the open questions. Build it from the code, not from the old spec.
- At the top of the v1 spec, add a dated note that it is the original design and point to `CURRENT-STATE.md`. Do not rewrite the spec.
- List anywhere the code and the spec disagree and ask me which is right. Do not decide for me.

---

# Part C: six UX fixes

Do these as one branch each, after Parts A and B. Each is a change to existing screens, not a new screen.

## C1. Home: Approve, Fix, Due
**Branch:** `feature/home-three-buckets`

**Exists:** the simplified Home (`role-home.tsx`, `next-report.tsx`, `families.tsx`, `panels.tsx`) with a family beside the numbers, one next step and two tiles.

**Keep** the family panel and the single next step. **Change** only the list under it: everything waiting on this person appears in three groups, **Approve**, **Fix** and **Due**, each row one line with one tap to the place to act. An empty group is hidden. Nothing else is added to Home.

## C2. Project manager first
**Branch:** `feature/pm-path`

Walk the project manager's whole path on a phone: sign in, Home, accept results, check budget, write the report, pre-flight, release. List every step that takes more than two taps or needs a screen meant for another role, then fix those. Field staff who only use KoboCollect should land on a short Home that tells them so and shows their own recent submissions. Do not build new field data entry.

## C3. Progress: one row per target
**Branch:** `feature/progress-rows`

**Exists:** `indicator-table.tsx`, `progress-page.tsx`.

Each row shows, in this order: name, target for the period, result so far, a status color with a word (On track, Behind, No data) and the date of the last accepted result. Status is never color alone. Tapping the row opens the proof panel from A2. On a phone the row stacks; it does not scroll sideways.

## C4. Plain words
**Branch:** `feature/plain-words`

In the app's own screens, in all four languages, use **Target**, **Result** and **Proof**. Replace "Actual", "Indicator" and "Disaggregation" where they are labels a new user reads (for example `nav.budget` "Budget vs actual" becomes "Budget and spending", "Indicator" columns become "Target"). Use "by women and men, age and place" in place of "disaggregation".

**Exception:** anything that goes to a donor keeps the donor's own terms. Report exports, the FACE form and donor codes are not changed. Give me the full before and after list of strings before you change them.

## C5. A sample project for every new organization
**Branch:** `feature/sample-project`

**Exists:** `src/server/demo-seed.ts`, `getting-started.tsx`.

A new organization starts with one finished sample project, clearly marked "Sample", read-only, with fictional data: targets, accepted results with proof, a budget with spending, one released report and its evidence pack. Getting started points to it ("See a finished report") beside "Set up your project". The sample is left out of the portfolio totals and can be hidden by an admin.

## C6. Every AI flag says why
**Branch:** `feature/flag-reasons`

Audit every place the AI raises a flag or a suggestion: data checks, claim check, procurement check, monthly review, the new A3 and A4 proposals and the B3 column mapping. Each must show one line of why in plain words, what it looked at and two actions the person can take with one tap, Accept and Query (or the fitting pair). Where a flag has no reason today, add it. Record the person's choice in the audit log.

---

## Order

A1, A2, A3, A4, B1, B2, B3, B4, B5, C1, C2, C3, C4, C5, C6.

Start now with the plan for A1 only. Do not write code until I say go.
