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
- **Not changed, for Tucker (morning report):** translation sends Dari and Pashto notes as written (it cannot translate otherwise, and the name rules read English only); photo coaching sends the photo itself, which `docs/DATA-PROTECTION.md` says never happens; the assistant sends staff names and the typed question; the opportunity brief has no voice rules; the lens review replaces earlier decisions on screen when run again. Each is on the do-not-touch list or needs a policy decision.

## Decisions

Each is reversible. Listed as they are made.
- Tests: vitest 4, not 5, so no existing dependency had to change.
- Another organization's project answers 404, the same as a project that does not exist, so a code cannot be confirmed by guessing.
- Audit rows for the new gaps are written by the route after the save, not inside the store's transaction. Simpler and safe to revert; a crash between the two would lose the row, not the change.
- Hand-recorded results can no longer be decided through the review-queue route. The Results page was already the only screen that did it.
- Story drafts no longer send interview notes with names in them. The first name still goes when consent is recorded. If stories read worse for it, change `scrubbed(...)` to `asIs(...)` in `src/server/stories-store.ts`.
- Procurement drafts get ROP's voice rules. To undo, set `voice: false` for `procurementDraft` in `src/lib/ai-jobs.ts`.
- The door writes its own `ai_run` audit row for every call, beside the rows each job already wrote. Nothing was removed from the trail.
