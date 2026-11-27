# Open items, all notes (25 Nov 2026)

One list of everything still open across every notes file in `docs/` and `docs/deep-dive/`,
each checked against the code on 25 Nov. About 38 older items were found already done and are
left out. The rounds queue (medium 1 to 27, 19 open) stays in `ROUNDS.md` and is not repeated.
Not walked yet: most of chain 2 and chains 3 to 6 (`ROUNDS.md`).

## 1. Decided by Tucker, 25 Nov (all option a)

- **11-handoffs-review A to N:** confirmed as built.
- **Share link from a preview copy:** allowed. It says "A draft shared for review" and carries the Draft watermark.
- **Accepted result with no proof:** warns before a release, does not block. The reason is kept.
- **Farmer list upload starting at Distribute:** allowed as a mid-season start; the audit log records it.
- **Store issue voucher:** a tick box for v1.0.
- **Report tab:** opens on the last quarter that ended.
- **Target details after plan sign-off:** as for the rest of the plan, a plan approver with a written reason, or a proposed change in the monthly review. Built (`c48c43d`).
- **Overspend reason:** Finance may give it too. Built (`e80186d`).
- **An approved distribution:** waits for MEL, as today.
- **Emailed approval link without sign-in:** kept.
- **Proposals (outside sign-ins, support-cost base, SharePoint checks):** after v1.0.
- **The public repo:** stays public. Test data only.

## 2. To build or fix (size S, M or L)

- **Afghani rate fixed at 70, no quetzal rate** (M: `demo.ts`, bills route, `procurement-plan.ts`).
- **Report header facts** (agreement number, director, locations, partner) are typed on the first
  report and carried forward, not kept on the project (M, `qpr.ts`).
- **Expense claims carry no budget line** (M, `expense.ts`).
- **The audit log is not add-only in the database** (M, needs a migration).
- **No read-only auditor account** (M to L).
- **Nobody can approve:** the record says "nobody yet" and nobody is told; no fallback (S to M,
  `kobo-approval.ts`, `distribution.ts`).
- **Workplan "planned" quarters use calendar quarters** (M).
- **No indirect-cost rate per donor** (M).
- **Finance's out-of-scope list** (`09-finance.md`): functional currency screen, staff advances,
  payroll journals, statements. Mostly after v1.0.
- **Season steps written into the code** (L, probably after v1.0, `field.ts`).
- **Staff and timesheet routes not scoped to an organization.** Safe with one organization (M).
- **Duplicate helpers:** 28 fetch helpers, 17 `addDays` (M, cleanup).

Fixed on 25 Nov (branch `build/open-items-2026-11-25`): the weekly caption no longer asks for the
village; the bill book is locked while saved; a payroll download writes an audit row; Home tells MEL
about farmers left open on a training record; a result reopened after a signed review stays in its
records; the data protection note says what the AI would send; "?" help on the photo consent and HR forms
(Dari and Pashto wording for a native reader); HR records for every demo person.

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
- **Secrets:** reset the Supabase password and the Kobo key before real data. (The repo stays
  public: Tucker, 25 Nov, test data only.)
- **ADP RUN layout:** confirm it. The download is still named "-DRAFT-LAYOUT".
- **Vercel plan:** confirm it runs all four nightly jobs.
- **Real projects and the books (AQ):** load a project's spending to date into the books before
  real use, or its "spent" shows only what was posted in the app.
- **The external data protection review document** holds open decisions; it is not in the repo.

## Before the 10 Jan demo: database connections (decided 27 Nov, option 3)

"Draft with AI" and other reads failed with "max clients reached in session mode, pool_size 15":
everything shares 15 connections. Done now: the local dev server stopped, the live site holds 1
connection per instance (was 2). Revisit before the demo: try Supabase's transaction pooler again on
a preview under load (it lost replies on 24 Nov), or raise the pool size in Supabase.

## 4. Unsure, to look at

- Four tests tied to today's date may fail when the clock reaches 10 Jan.
- Daniel's 23 Nov review is marked "feedback unrecorded". The 23 Nov decisions may already cover it.
- "LEFT -150" shown to a donor with no word beside it (round 6). There is now an over-budget mark; not seen on screen.
- "bilal.kobo not matched" on the approval page may come from the test tool.
- A purchase recorded as paid on an earlier day is offered for posting. Intended?
- Does the World Bank have its own data protection rules? (Build spec.)
