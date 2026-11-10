# Surge log, 9 to 10 Nov 2026

One entry per item. Times are Guatemala time.

## 23:05 Phase 0. Make it safe

- `main` was clean apart from `.claude/` and the surge plan. Both committed on `surge/2026-11-09`, not on `main`.
- Tag `pre-surge-2026-11-09` set on `main` at `575641f` and pushed.
- Branch `surge/2026-11-09` created and pushed.
- Baseline on `575641f`: lint passes, typecheck passes, build passes. No tests exist.

## 23:10 Phase 1. A safety net (branch `surge/tests`)

- Added `vitest` (4.x; 5.x wants newer Node types than the repo has), `npm test`, and a test step in CI between typecheck and build.
- 183 tests in 13 files under `src/lib/__tests__/`, synthetic data only, on: results roll-up and women/men sums, progress and on-track, the quarterly table and its checks, breakdown tables, pre-flight deadlines, the name scrub, data checks, sign-off rules and solo mode, policy layering, photo consent, procurement thresholds, Finance's workbook reader, budget against spending, and B3's any-spreadsheet import.
- Tests cannot reach the database or the AI: both keys are blanked in `vitest.config.mts`.
- No bug that changes a donor figure was found. Two behaviours are pinned as they are and need Tucker's eye:
  - **Photo consent.** A recognisable person with consent for "Donor reports" only is still held back from the donor report (`lib/photos.ts` `shareLimit` needs "comms" or "social"). Safe side, but the consent form offers a choice that does nothing. Question in the morning report.
  - **Name scrub.** A capitalised word just before a name is swallowed with it ("Visited Zarmal's" becomes "a farmer's"). Safe side; left alone.

## 23:15 Phase 2. Audit (`docs/AUDIT-2026-11-09.md`)

- Five tables plus dead code, duplicate helpers and stale docs, from six read-only passes. The short list of what breaks trust is at the top of the file.
- Written while Phase 1 ran; nothing was changed until it was in.

## 23:20 Phase 3a. Route gaps (branch `surge/route-guard`)

One guard, extended (`src/server/guard.ts`): `handle` (failures become plain messages), `guard` (who, organization, project, role), `readBody` (Zod on input), `audit` (one row per change). No second guard was written.

- **Bug fixed: approving or returning a bill.** The audit row used the bill number where the database needs an id, so the entry was refused after the approval was saved: the person saw an error and the trail had no row. `logAudit` now files numbered things (a bill, a purchase) under their project with the number in `detail.ref`. Test added (`audit-row.test.ts`). **Tucker: check the live audit log for missing `bill_approved` rows since B2 merged.**
- **Organization check.** `requireViewer` now refuses a project of another organization, answering as if it did not exist. "View as" only reaches people in the administrator's own organization.
- **Review queue.** `decide` only touches a record of the project in the address, and refuses hand-recorded results (they go through Results, where the checks and the "not your own" rule are). Input checked with Zod.
- **Field records.** `PUT /field` checks its input (was an unchecked cast) and writes `field_saved`.
- **Audit rows added:** `month_closed`, `policy_donor_chosen`, `policy_custom_donor_saved`, `policy_conflict_decided`, `policy_donor_rules_layered`, `kobo_connected`, `kobo_disconnected`, `kobo_forms_saved`, `kobo_auto_sync_on/off`, `kobo_farmer_list_sent`, `donor_added/changed/removed`, `work_item_added/done/reopened/notes_changed/deleted`, `procurement_plan_rebuilt`, `project_created`, `bill_recorded`, `bill_voucher_started/filed`, `view_as_stopped`.
- **Smaller:** agreement rules must fit their rule's type; setup's document read only lands on the trail of a project the person works on; malformed JSON on procurements is a 400, not a 500; annual report year must be a whole number.
- **Errors.** An unknown project is a 404 with what to do, not a 500 saying "Run npm run db:seed". An unexpected failure no longer shows a driver's message or SQL: it says it was recorded, that nothing typed is lost, and to try again.
- **Left alone, in the morning report:** opportunities and payroll export (on the do-not-touch list) still have audit gaps; `GET /policy` is readable by donor accounts because two screens load it for everyone; staff, session and timesheet routes are not yet organization-scoped (one organization today); the bill book is still read-modify-write with no lock.

## 23:25 Phase 3b. One door for AI (branch `surge/ai-door`)

- **`src/server/ai.ts` is now the only file that imports the AI SDK** (was four files, five separate clients). All 18 jobs call `askAi` through it. A test fails if any other file imports the SDK or names a job that is not in the list.
- **`src/lib/ai-jobs.ts`** lists every job: what it does, whether it writes for people, and what it looks at in plain words (ready for C6 to show).
- What the door applies to every call: a named job and a named person; facts accepted only as `scrubbed(facts, [free-text fields])` or `asIs(facts, why)`; ROP's voice rules added for jobs that write for people; one `ai_run` (or `ai_run_failed`) audit row with job, person, the model that actually answered and how personal text was handled; every failure as a plain sentence with what to do next.
- **No job was removed, merged or reworded.** Prompts are unchanged, with these exceptions that follow house rules already written down:
  - Procurement document drafts now carry ROP's voice rules (house rule 4; they had their own style lines only).
  - Names are now also replaced in: story interview notes and linked record notes, QPR update titles and row comments, claim-check titles, post titles and the typed request, monthly review change reasons. `docs/DATA-PROTECTION.md` already says notes go with names replaced.
- Raw SDK errors (overloaded, too large, server error) no longer reach people; setup extraction no longer returns raw text.
- The name scrub no longer treats "Women's", "Today's", "Cooperative's" and similar as a person's name.
- Redrafting a story or the monthly review now asks before replacing text someone wrote.
- **A slip, corrected within a minute:** the first merge of this branch into `surge/2026-11-09` (`ff928d6`) had a type error in `review-page.tsx`: my check command hid the failing typecheck behind a pipe. Fixed in the next commit and merged again. Every merge since runs one script that stops on the first red check. `main` was never involved.
- **Not changed, for Tucker (morning report):** translation sends Dari and Pashto notes as written (it cannot translate otherwise, and the name rules read English only); photo coaching sends the photo itself, which `docs/DATA-PROTECTION.md` says never happens; the assistant sends staff names and the typed question; the opportunity brief has no voice rules; the lens review replaces earlier decisions on screen when run again. Each is on the do-not-touch list or needs a policy decision.

## 23:35 Phase 3c. One function per number (branch `surge/one-number`)

Each pair was pinned by a test first (`one-number.test.ts`), then one function kept.

- **Overspent budget line.** The report said overspent at budget + 1; the budget page and Home at approved + 0.5%. One rule now, `spentOver` in `lib/budget-view.ts`; the report's checks, `overspentLines`, pre-flight, Home and the budget page all call it.
- **Report deadline on Home.** Home's tile always said the 10th of the month after the quarter; pre-flight read the deadline from Tasks or the donor's rule. Both now call `reportDeadline` (`server/preflight.ts`). Home falls back to the 10th only when no deadline is set anywhere, and says so.
- **Our rows in a consortium workplan.** Four places matched the partner column to exactly "ROP"; the workplan reader also accepted "Roots of Peace" and "ROP/FAO". All call `ourWork` (`lib/budget.ts`) now. The lens review keeps its own copy (do-not-touch list).
- **Supplier screening out of date.** The register counted calendar months; the procurement step counted days against months x 30.44, so a supplier screened 1 January passed one and failed the other on 1 July. One rule, `screeningStale` (`lib/suppliers.ts`), the register's.
- **Tracking table sums** (`server/outputs.ts`) now come from `totalsOf`, the function the reports use. Same figures as before.
- **Not done, in the morning report:** "on track" still has two meanings (the report judges against the workplan, Progress cards against time gone in the year); the afghani rate is a constant 70 in three places; "today" is the server's UTC day in about 48 places, which is wrong near midnight in Kabul; the project spend total and the budget page total differ by design (overhead and phases) and neither says so. Each needs a decision or a stored value, not a refactor.

## 23:50 Phase 3d. Errors that keep the person's work and say what to do next (branch `surge/errors-keep-work`)

- **Report downloads never treat "pre-flight unknown" as "nothing blocks".** If pre-flight had not loaded or its load failed, the download went out with no warning and no DRAFT mark. Now the download reads pre-flight itself; if that fails too, the person is asked, and the file is marked "DRAFT, NOT CHECKED: pre-flight could not be run". Quarterly, annual and FACE.
- **Work no longer says "Nothing needs you right now" when its load failed.** It says the list may be missing things, with a Try again button. Same for Closeout ("No expense vouchers yet" after a failed load).
- **Quarterly report page:** a loading line (it was blank while loading); errors scroll into view (they sat at the top, out of sight from a save button far down); when "Mark final" is off, a visible line says how many things block and links to pre-flight (the reason was only in a tooltip, which a phone never shows).
- **Farmer profile:** a failed save is now shown on the page (it was only shown when the farmer was missing).
- **Kobo sync:** a failure is shown as an error, not in green.
- **Setup:** a failed save no longer shows a bare "500".
- **Every signed-in page** now has an error screen (what happened, saved work is safe, Try again, Go to Home) and a loading screen. There were none.
- New text is in `src/lib/i18n/surge.ts` in all four languages. **The Spanish, Dari and Pashto are my drafts and need a native reader**, as the file says of the others. A test checks every new string exists in all four and that translations keep the same {placeholders}.
- **Left alone (HR, on the do-not-touch list), in the morning report:** a failed "send back" clears the typed note on expenses, leave and people; onboarding lets a contract be signed that never opened; payroll's ADP download fails silently; Leave is blank for someone with no HR record.
- **Working-method slip, corrected:** I made two one-line changes in files over 600 lines (`lib/procurement.ts`, `progress/qpr-page.tsx`) before reading all of them. I have since read both in full; the changes stand. From here I read first.

## Decisions

Each is reversible. Listed as they are made.
- Tests: vitest 4, not 5, so no existing dependency had to change.
- Another organization's project answers 404, the same as a project that does not exist, so a code cannot be confirmed by guessing.
- Audit rows for the new gaps are written by the route after the save, not inside the store's transaction. Simpler and safe to revert; a crash between the two would lose the row, not the change.
- Hand-recorded results can no longer be decided through the review-queue route. The Results page was already the only screen that did it.
- Story drafts no longer send interview notes with names in them. The first name still goes when consent is recorded. If stories read worse for it, change `scrubbed(...)` to `asIs(...)` in `src/server/stories-store.ts`.
- Procurement drafts get ROP's voice rules. To undo, set `voice: false` for `procurementDraft` in `src/lib/ai-jobs.ts`.
- The door writes its own `ai_run` audit row for every call, beside the rows each job already wrote. Nothing was removed from the trail.
- Overspent means more than 0.5% above approved, everywhere. Before, the quarterly report used budget + 1 (in the budget's currency). To go back, change `spentOver` in `src/lib/budget-view.ts`: one line.
- Supplier screening goes out of date on the calendar-month rule (the stricter of the two by a day or two).
- Home's "10th of the month" is kept only as a fallback, labelled as not a set date. It is in the code as ROP's practice but not in the policy file: question in the morning report.
