# Surge log, 9 to 10 Nov 2026

One entry per item. Times are Guatemala time, taken from the merge commit of each item.

## 23:02 Phase 0. Make it safe

- `main` was clean apart from `.claude/` and the surge plan. Both committed on `surge/2026-11-09`, not on `main`.
- Tag `pre-surge-2026-11-09` set on `main` at `575641f` and pushed.
- Branch `surge/2026-11-09` created and pushed.
- Baseline on `575641f`: lint passes, typecheck passes, build passes. No tests exist.

## 23:09 Phase 1. A safety net (branch `surge/tests`)

- Added `vitest` (4.x; 5.x wants newer Node types than the repo has), `npm test`, and a test step in CI between typecheck and build.
- 183 tests in 13 files under `src/lib/__tests__/`, synthetic data only, on: results roll-up and women/men sums, progress and on-track, the quarterly table and its checks, breakdown tables, pre-flight deadlines, the name scrub, data checks, sign-off rules and solo mode, policy layering, photo consent, procurement thresholds, Finance's workbook reader, budget against spending, and B3's any-spreadsheet import.
- Tests cannot reach the database or the AI: both keys are blanked in `vitest.config.mts`.
- No bug that changes a donor figure was found. Two behaviours are pinned as they are and need Tucker's eye:
  - **Photo consent.** A recognisable person with consent for "Donor reports" only is still held back from the donor report (`lib/photos.ts` `shareLimit` needs "comms" or "social"). Safe side, but the consent form offers a choice that does nothing. Question in the morning report.
  - **Name scrub.** A capitalised word just before a name is swallowed with it ("Visited Zarmal's" becomes "a farmer's"). Safe side; left alone.

## 23:14 Phase 2. Audit (`docs/AUDIT-2026-11-09.md`)

- Five tables plus dead code, duplicate helpers and stale docs, from six read-only passes. The short list of what breaks trust is at the top of the file.
- Written while Phase 1 ran; nothing was changed until it was in.

## 23:14 Phase 3a. Route gaps (branch `surge/route-guard`)

One guard, extended (`src/server/guard.ts`): `handle` (failures become plain messages), `guard` (who, organization, project, role), `readBody` (Zod on input), `audit` (one row per change). No second guard was written.

- **Bug fixed: approving or returning a bill.** The audit row used the bill number where the database needs an id, so the entry was refused after the approval was saved: the person saw an error and the trail had no row. `logAudit` now files numbered things (a bill, a purchase) under their project with the number in `detail.ref`. Test added (`audit-row.test.ts`). **Tucker: check the live audit log for missing `bill_approved` rows since B2 merged.**
- **Organization check.** `requireViewer` now refuses a project of another organization, answering as if it did not exist. "View as" only reaches people in the administrator's own organization.
- **Review queue.** `decide` only touches a record of the project in the address, and refuses hand-recorded results (they go through Results, where the checks and the "not your own" rule are). Input checked with Zod.
- **Field records.** `PUT /field` checks its input (was an unchecked cast) and writes `field_saved`.
- **Audit rows added:** `month_closed`, `policy_donor_chosen`, `policy_custom_donor_saved`, `policy_conflict_decided`, `policy_donor_rules_layered`, `kobo_connected`, `kobo_disconnected`, `kobo_forms_saved`, `kobo_auto_sync_on/off`, `kobo_farmer_list_sent`, `donor_added/changed/removed`, `work_item_added/done/reopened/notes_changed/deleted`, `procurement_plan_rebuilt`, `project_created`, `bill_recorded`, `bill_voucher_started/filed`, `view_as_stopped`.
- **Smaller:** agreement rules must fit their rule's type; setup's document read only lands on the trail of a project the person works on; malformed JSON on procurements is a 400, not a 500; annual report year must be a whole number.
- **Errors.** An unknown project is a 404 with what to do, not a 500 saying "Run npm run db:seed". An unexpected failure no longer shows a driver's message or SQL: it says it was recorded, that nothing typed is lost, and to try again.
- **Left alone, in the morning report:** opportunities and payroll export (on the do-not-touch list) still have audit gaps; `GET /policy` is readable by donor accounts because two screens load it for everyone; staff, session and timesheet routes are not yet organization-scoped (one organization today); the bill book is still read-modify-write with no lock.

## 23:20 Phase 3b. One door for AI (branch `surge/ai-door`)

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

## 23:23 Phase 3c. One function per number (branch `surge/one-number`)

Each pair was pinned by a test first (`one-number.test.ts`), then one function kept.

- **Overspent budget line.** The report said overspent at budget + 1; the budget page and Home at approved + 0.5%. One rule now, `spentOver` in `lib/budget-view.ts`; the report's checks, `overspentLines`, pre-flight, Home and the budget page all call it.
- **Report deadline on Home.** Home's tile always said the 10th of the month after the quarter; pre-flight read the deadline from Tasks or the donor's rule. Both now call `reportDeadline` (`server/preflight.ts`). Home falls back to the 10th only when no deadline is set anywhere, and says so.
- **Our rows in a consortium workplan.** Four places matched the partner column to exactly "ROP"; the workplan reader also accepted "Roots of Peace" and "ROP/FAO". All call `ourWork` (`lib/budget.ts`) now. The lens review keeps its own copy (do-not-touch list).
- **Supplier screening out of date.** The register counted calendar months; the procurement step counted days against months x 30.44, so a supplier screened 1 January passed one and failed the other on 1 July. One rule, `screeningStale` (`lib/suppliers.ts`), the register's.
- **Tracking table sums** (`server/outputs.ts`) now come from `totalsOf`, the function the reports use. Same figures as before.
- **Not done, in the morning report:** "on track" still has two meanings (the report judges against the workplan, Progress cards against time gone in the year); the afghani rate is a constant 70 in three places; "today" is the server's UTC day in about 48 places, which is wrong near midnight in Kabul; the project spend total and the budget page total differ by design (overhead and phases) and neither says so. Each needs a decision or a stored value, not a refactor.

## 23:28 Phase 3d. Errors that keep the person's work and say what to do next (branch `surge/errors-keep-work`)

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

## 23:29 Phase 3e. Dead code (branch `surge/dead-code`)

- Removed six exports nothing uses, each checked by a search and then by the type checker and lint: `methodNeeds` (`lib/kobo-suggest.ts`), `PARAM_KEYS` (`lib/presets.ts`), `rolePerson` (`lib/procurement.ts`), `READINESS_FORM_ID` and `seedAll` (`lib/project.ts`), `AI_ACTIONS` (`server/limits.ts`).
- Left: `RUN_CODES` (payroll) and `isWorkday` (timesheets) are unused too but sit in the HR area, which is not to be touched.
- Not done: the 17 copies of the `call` fetch helper, 10 of `addDays` and 7 date formatters (audit, section 6). They agree today; folding them is a wide mechanical change better done with someone watching.

## 23:35 Phase 4. Entered once (branch `surge/entered-once`)

Nothing was migrated or dropped. Where a fact had two stores, code now reads one; the spare column or copy is listed in the morning report.

- **Donor name.** Setup and Settings write the `donors` table, but the quarterly report, annual report, FACE form, weekly update and evidence pack read `projects.donor`, which no screen writes: a project made in setup printed no donor. They now call `donorNameOf` (`server/field-store.ts`): the donor entered in setup or Settings; the old column only when none is entered, or to say which of several donors a single-donor report is for.
- **Project goal.** Reports and AI drafts read `goalOf`: the goal as a plan approver worded it on the results framework, else the goal from setup. Before, the framework wording never reached the report.
- **Donor's code for a target.** Progress and the baseline report used the code typed per donor in Settings and showed the app's internal code when that was blank, while the quarterly report used the code entered in setup. Progress and the baseline report now fall back to the setup code.
- **Spent to date.** Re-uploading a budget file with a "spent" column put old spending back over Finance's import, and the procurement calendar then showed the wrong amount left. Once an import exists, a budget re-upload no longer touches spent.
- **Spent this quarter.** A typed figure replaces Finance's in the report. The report page already said so; pre-flight now lists it too, under Worth fixing, with both figures.
- **Procurement thresholds in words.** The method descriptions on the procurement calendar and the instructions given to the AI stated $500 / $5,000 / $25,000 whatever rules were in force. Both now read the rules in force, the same source `levelFor` uses. The draft and check routes load the project's rules first; before, the AI was told ROP's defaults even on a project with a donor's stricter thresholds.
- **Not done, with the reason, in the morning report:** report deadlines have one store but three doors (Settings donor form, setup's agreement step, Tasks); the quarterly report's info box (title, duration, agreement number, director, locations, partner) is typed on the report and carried forward; the afghani rate; "money left" copied into each request; photo consent held on the photo and on its story; people held in both `staff` and the HR record (HR is not to be touched); six indicator fields only a script can set.

## 23:40 Phase 5, C6. Every AI flag says why (branch `feature/flag-reasons`)

Plan, in place of "wait for my go": audit each place a flag or suggestion is raised against four things (a reason, what it looked at, two one-tap actions, the choice on the audit trail), then add only what is missing, with one shared component.

What each place had and now has:

| Place | Reason | What it looked at | Two actions | Choice on the trail |
|---|---|---|---|---|
| Data checks on a result (rules, not AI) | had | **added**, and says these are fixed rules | had: Accept, Query | had; **now with the flags the person saw** |
| Claim check on the report text | had | **added** | **added: Fix the text, The text is right** | **added: `qpr_claim_decided`** |
| Kobo question suggestions | had | **added** | had Accept; **added: Not this one** | accept had; **added: `kobo_suggestion_declined`** |
| Spending file columns | had | had | confirm or change, had | had |
| Setup from documents | had (source per value) | had | confirm or skip a section, had | had |
| Monthly review draft | a draft, not a flag | had | edit or keep | had |
| Procurement step check | had | **added** | tick "reviewed" or raise an issue, as before | saves were already logged |

- One component, `src/components/app/ai-why.tsx` (`LookedAt`, `Why`), and one text file, `src/lib/i18n/ai-why.ts`, in four languages (Spanish, Dari and Pashto are my drafts).
- A claim-check finding someone decided to keep as written no longer counts in pre-flight's "sentences questioned"; one marked to fix still does. "Fix the text" takes the person to the section. A decision can be taken back.
- Results page: errors scroll into view and a loading line shows while it loads (it was blank), using the pieces from Phase 3d.
- **Not done:** per-finding buttons on the procurement step check. The findings are a plain list on the purchase record; giving each its own decision means changing the record's shape inside the 1,000-line workspace. In the morning report as a follow-up.

## 23:45 to 00:41 Stopped: usage limit

The session stopped at the usage limit part-way through C1 and resumed at 00:41. C1's half-built work was parked as one commit on its own branch, unmerged; a short morning report was written in case the night ended there. Nothing was lost.

## 00:43 Phase 5, C1. Home: Approve, Fix, Due (branch `feature/home-three-buckets`)

Plan, in place of "wait for my go": keep the family panel and the single next step; put one list under it in three groups; move the old "Needs you" list into it; add nothing else.

- **Waiting on you**, under the next step: **Approve** (plan and budget sign-off, proposed plan changes, monthly review sign-off, report release, results to accept), **Fix** (results MEL queried, overspent lines to explain, and this person's part of what stands before the next report), **Due** (Finance's workbook to import, the report's ready-by date, the month's review). One row, one line, one tap. An empty group is hidden.
- It shows everything waiting on the person across all their roles, not only the view chosen in the switcher.
- **Fix reads pre-flight itself**, so Home can no longer give a different blocker count from the pre-flight screen. The old "Clear N stop items" action, counted by a second function, is gone, and MEL's report tile uses pre-flight's count.
- The next report is loaded once and shared by the panel and the list.
- Under "More", the old list's place now holds only "Off plan" for leads.
- Rows built by `waitingRows` (`src/lib/home-buckets.ts`), with tests. New text in four languages (my drafts for es, fa, ps). The action sentences from the server are still English, as before; they move in C4.

## 00:45 Phase 5, C3. Progress: one row per target (branch `feature/progress-rows`)

Plan: change the existing table's row only (`indicator-table.tsx`); keep its data source.

- Each row, in this order: name, target for the year, result so far, a status word with a mark (**On track**, **Behind**, **No data**; never colour alone) and a short second word (target met, delayed, not due yet, due this quarter, not in this year's workplan), then the date of the last accepted result.
- Tapping anywhere on the row opens the proof panel from A2 (before, only the number did, and the name went to Results).
- On a phone the parts stack; nothing scrolls sideways.
- The status is still the workplan judgment the reports use (`suggestStatus`), put into three words by `targetStatus` (`src/lib/target-status.ts`), with tests. A target with nothing accepted yet is "No data" even when results are waiting for MEL.
- "Target for the period" is the year's target, the period this table already covered.
- The cards that donor accounts and demo projects see were not changed: they judge "on track" against time gone in the year, the second meaning the audit found. Question in the morning report.
- New text in four languages (my drafts for es, fa, ps).

## 00:48 Phase 5, C2. Project manager first (branch `feature/pm-path`)

The walk was done by reading the code, not on a phone: nobody was awake to hold one. Taps are counted from Home.

| Step | Taps before | What was in the way | Now |
|---|---|---|---|
| Home | 0 | nothing | same |
| Accept results | 2 (Approve row, then "Accept N") | needs the MEL role: a manager without it is refused. Fine in solo mode | same |
| Check budget | 1 (budget tile) | nothing | same |
| Write the next report | 2 to 3: Home only linked to pre-flight, and the Report tab opens the last quarter that ended, not the one under way | no direct link | **1: "Open the report" on Home's next-report panel, for the right quarter** |
| Pre-flight | 1 | nothing | same |
| Release | pre-flight, scroll to the bottom, Open the report, Mark final | when nothing blocked, the way on was the last thing on the page | **the next step is at the top of pre-flight when nothing blocks: 2 taps** |
| Explain an overspent line | Home sends you to Budget, but the explanation is typed on the report's Project information | a second screen | **not fixed**: in the morning report |
| Import Finance's spending | on the report page or Budget; needs the Finance role | a screen meant for Finance | not fixed: it is Finance's step by the authority table |

- **Field staff who only use KoboCollect** now land on a short Home: it says their data comes in through KoboCollect and nothing needs entering here, lists anything MEL sent back, and shows the latest submissions received with each one's status. No tiles and no data entry. It applies when the person's only view is Delivery, the project is connected to KoboToolbox and no target takes results by hand.
- **Not as specified:** the list is the project's latest submissions, not the person's own. The app does not keep who sent a Kobo submission (it is recorded as "kobo"), so it cannot tell. The screen says so. To show a person's own, the app needs each person's KoboToolbox username: question in the morning report.
- New text in four languages (my drafts for es, fa, ps).

## 00:50 Phase 5, B4. Kobo nightly reconcile (branch `feature/kobo-nightly-reconcile`)

Plan: reuse the existing `sync` and `koboToResults` unchanged; add only the nightly caller, its schedule and its record on the health page.

- `GET /api/kobo/reconcile` (`src/server/kobo-reconcile.ts`): runs the same sync as the button and the webhook for every project connected to KoboToolbox, one after another; one project failing does not stop the rest. Protected by `CRON_SECRET`, compared in constant time; with no secret set it refuses to run. The check is `cronAllowed` in the shared guard.
- **It was never run tonight.** Running it calls KoboToolbox, which the guardrails forbid. Only its pure parts are tested. It goes live when this is merged and deployed.
- What happens to edits and deletions is the existing sync's behaviour, which I read but did not change: a result still waiting for MEL is updated; an accepted result is not changed, and the sync writes `kobo_changed_after_acceptance`. **I did not verify on a screen that MEL sees that flag**: worth one look on `SFTP-2026`.
- One audit row per project per run (`kobo_reconciled` or `kobo_reconcile_failed`, with the counts). Settings, Health has a new section showing each project's latest run.
- `vercel.json` has a third scheduled job at 00:45 UTC, before the 01:30 daily email. **I could not check the Vercel plan's limit** (the Vercel CLI is blocked for this session, rightly). If the deploy refuses a third job: delete that entry from `vercel.json` and set `KOBO_RECONCILE_IN_DIGEST=1`; the daily email job then runs the reconcile first.

## 00:53 Phase 6, C7. "Why we ask" help (branch `feature/field-help`)

- One register, `src/lib/field-help.ts`, one component, `src/components/app/field-help.tsx` (a "?" with a phone-sized tap area), text in four languages in `src/lib/i18n/field-help.ts` (es, fa, ps are my drafts).
- Six fields have their "?": on recording a result, women and men, young people, province and district, what was done, and proof; on a story, consent.
- Each line was checked against the code. Where there was nothing real to say the line is absent: only two fields have a Source line (the target's own breakdown; the Afghan youth policy for the 18 to 35 band), because the repo holds no written source for the others.
- `docs/DATA-PROTECTION.md` has a new section, "What we collect and why", generated from the register. A test fails when the two differ; `UPDATE_DOCS=1 npm test` rewrites the section.
- **Short of "done when":** Photos and HR have no "?" (both are on the do-not-touch list), and the AI-proposed values rely on C6's "It looked at" line rather than this help. Question in the morning report: may the "?" be added to Photos and HR?

## 00:55 Phase 6, B5. Docs match the app (branch `feature/docs-current`)

- `README.md` rewritten: what the app is and does today, where things are, how it is built, how to run it, and the warning that a push to `main` migrates the live database. The "untested prototype, saved in the browser" text is gone.
- New `docs/CURRENT-STATE.md`: one table of every feature area with status, main files and open questions, written from the code. It says plainly that nothing was checked by running the app.
- A dated note at the top of the v1 spec points to it. The spec itself is unchanged.
- Three places where code and spec disagree are listed for Tucker, undecided. The list is not complete: I compared only what the audit touched.

## 00:55 Phase 6, C5 and C4: not started, on purpose

- **C5, sample project.** It needs a new column on projects, seed data written into the database for each new organization, and read-only handling across the app. None of it can be tried without a database, which tonight's rules rightly forbid. Too large to build blind.
- **C4, plain words.** The item asks for the full before-and-after list of strings before anything changes, across four languages. 54 English strings use "indicator", "actual" or "disaggregation"; changing the Dari and Pashto words for them unseen is the kind of change a native reader should see first. Not started; the count and the files are in the audit (section 4, Jargon).

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
- When a project has one donor entered, reports print that name. With several donors and nothing in the old column, they print the names joined with "and".
- When the results framework has a worded goal, reports and AI drafts use it rather than the goal typed in setup.
- A budget re-upload leaves spent alone once Finance's spending has been imported. To change spent, import spending.
