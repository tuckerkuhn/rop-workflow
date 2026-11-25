# Open items, all notes (25 Nov 2026)

One list of everything still open across every notes file in `docs/` and `docs/deep-dive/`,
each checked against the code on 25 Nov. About 38 older items were found already done and are
left out. The rounds queue (medium 1 to 27, 19 open) stays in `ROUNDS.md` and is not repeated.
Not walked yet: most of chain 2 and chains 3 to 6 (`ROUNDS.md`).

## 1. Waiting on Tucker's decision

- **11-handoffs-review A to N.** The first option of each was built (map, send-back, GPS,
  voucher...). Nobody has confirmed or changed them.
- **Share link from a preview copy.** A donor link can still be made from an unreleased preview
  (`share-store.ts`). Allow it? (CURRENT-STATE, AUDIT Q19, 07-five-lens.)
- **Accepted result with no proof.** It only warns before a release (`preflight.ts`). Should it block? (CURRENT-STATE, AUDIT Q8.)
- **Farmer list upload can start farmers at Distribute**, skipping the readiness check
  (`farmer-import.ts`). A real mid-season start, or a loophole? (CONNECTIONS.)
- **Store issue voucher** is still a tick box with no number kept (`field.ts`). Waits on the voucher naming decision. (03-plan batch 10.)
- **Report tab** opens on the quarter under way or the last one ended? (MORNING Q11.)
- **Target details after plan sign-off.** May they change? The server does not check. (MORNING Q12.)
- **Overspend reason.** May Finance write it? Today it is refused. (MORNING Q13.)
- **An approved distribution** counts at once, or waits for MEL (today it waits)? (UX-PASS.)
- **Emailed approval link** approves without sign-in. Keep it? (02-audit A8.)
- **Proposals:** sign-ins for outside contributors, support-cost base, SharePoint file checks.
  The recommendation was to wait on all three. (06-proposals.)

## 2. To build or fix (size S, M or L)

- **AI jobs and the data protection note** (S): translation sends Dari and Pashto text as written,
  and the photo check sends the photo itself; `DATA-PROTECTION.md` says neither happens. Nothing
  runs while there is no AI key.
- **Weekly photo caption asks for the village** (S, `weekly-page.tsx`).
- **The bill book has no lock**: two saves at once can lose one (S to M, `bills-store.ts`).
- **Afghani rate fixed at 70, no quetzal rate** (M: `demo.ts`, bills route, `procurement-plan.ts`).
- **Report header facts** (agreement number, director, locations, partner) are typed on the first
  report and carried forward, not kept on the project (M, `qpr.ts`).
- **Payroll file download writes no audit row** (S).
- **Expense claims carry no budget line** (M, `expense.ts`).
- **The audit log is not add-only in the database** (M, needs a migration).
- **No read-only auditor account** (M to L).
- **Nobody can approve:** the record says "nobody yet" and nobody is told; no fallback (S to M,
  `kobo-approval.ts`, `distribution.ts`).
- **A result reopened after a monthly review is signed** drops out of that review's record list (S, `proof.ts`).
- **Home does not tell MEL a farmer is left open on a training record** (S).
- **No "?" help on the photo consent form or the HR forms** (S, `field-help.ts`).
- **Demo field staff have no HR record**, so Timesheets, Leave and Expenses dead-end in the demo (S).
- **Workplan "planned" quarters use calendar quarters** (M).
- **No indirect-cost rate per donor** (M).
- **Finance's out-of-scope list** (`09-finance.md`): functional currency screen, staff advances,
  payroll journals, statements. Mostly after v1.0.
- **Season steps written into the code** (L, probably after v1.0, `field.ts`).
- **Staff and timesheet routes not scoped to an organization.** Safe with one organization (M).
- **Duplicate helpers:** 28 fetch helpers, 17 `addDays` (M, cleanup).

Fixed on 25 Nov while building AR: a photo could be checked only by the AI, so with no AI key no
photo could ever reach a donor. Photos can now be checked by hand in the photo library.

## 3. Outside the app (Tucker or others)

- **Real phone tests:** upload the four app-made forms to rop1997. Check GPS, the photo's day and
  place, search on the farmer tick list, and the map.
- **KoboToolbox:** replace the old training form if a real project uses it (Q). Redeploy ACRP's
  live form after the sandbox test (I).
- **Accountant:** the 21 questions in `09-finance.md` and AM (withheld tax). Confirm the USD 500
  self-post limit (Settings, Finance).
- **Policy owners:** the 21 decisions with no written rule (`AUDIT-2026-11-09.md`) and the
  procurement blueprint's unresolved list.
- **Agronomists:** `09-visit-plan-questions.md`, needed before visit plans are built.
- **A native speaker** for Dari, Pashto and Spanish (last, by Tucker's rule).
- **Backups by 10 Dec:** turn on point-in-time recovery, test a restore once, save one records download.
- **Demo day:**
  - Set DEMO_SIGN_IN, SITE_PASSWORD, RESEND_API_KEY and NOTIFY_TEST_TO on the demo server.
  - Time Home on the deployed app.
  - Rehearse once and reset the demo that morning.
- **Repo and secrets:** the repo is public and its history holds two real staff names: make it
  private. Reset the Supabase password and the Kobo key before real data.
- **ADP RUN layout:** confirm it. The download is still named "-DRAFT-LAYOUT".
- **Vercel plan:** confirm it runs all four nightly jobs.
- **Real projects and the books (AQ):** load a project's spending to date into the books before
  real use, or its "spent" shows only what was posted in the app.
- **The external data protection review document** holds open decisions; it is not in the repo.

## 4. Unsure, to look at

- Four tests tied to today's date may fail when the clock reaches 10 Jan.
- Daniel's 23 Nov review is marked "feedback unrecorded". The 23 Nov decisions may already cover it.
- "LEFT -150" shown to a donor with no word beside it (round 6). There is now an over-budget mark; not seen on screen.
- "bilal.kobo not matched" on the approval page may come from the test tool.
- A purchase recorded as paid on an earlier day is offered for posting. Intended?
- Does the World Bank have its own data protection rules? (Build spec.)
