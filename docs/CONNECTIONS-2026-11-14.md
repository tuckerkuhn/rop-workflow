# Connections: where data passes between parts of the app

Written 14 Nov 2026 from `main` at `1314fda`; sections 2b to 5 were brought up to date the same evening against `4199486` (any project can run Field activities). Line numbers in the table are from the first pass and have since moved: search for the function name.

**How this was checked.** The checks now live in the repo: `npm test` runs 388 tests, of which 27 in `src/server/__tests__/` run whole flows against an in-memory Postgres with the real migrations. First pass: the code was read, then run: the app was started against a local Postgres with all 25 migrations and the fictional A-2027 data, and the distribution chain was walked in a browser as Nadia, Bilal and Farida. Flows marked "read only" were read but not run. HR, payroll, timesheets, leave, expenses, onboarding, offboarding and opportunities were not reviewed: they do not carry project data from the field to the donor.

Each flow is scored against six properties: entered once, checked at the handoff, owned, traceable, consistent, recoverable.

## 1. The flows

| # | Flow | Trigger | Checked at handoff | Owner told | On retry or failure | Score |
|---|---|---|---|---|---|---|
| 1 | Field step to distribution record (`src/app/api/projects/[code]/field/route.ts:77`, `src/server/distribution.ts:140`) | Storekeeper moves a farmer from Distribute to Plant | Gate refuses with a reason (`src/lib/distribution.ts:50`) | Project manager: email plus Home | Was: a retry stored a second record. Now: the waiting record is reused (`distribution.ts:148`) | Was weak, now strong |
| 2 | Distribution to approval (`distribution.ts:343`) | Manager approves from the email link or Home | Gate re-run against what is approved | Finance task, procurement list, audit row, one transaction | Decided once; a second decision is refused | Was weak, now strong (see gaps 2 and 3) |
| 3 | Distribution sent back (`distribution.ts:343`, `462`) | Manager sends back with a reason | Reason required | Was: the storekeeper, whoever recorded it, with no way to fix it. Now: the recorder, with fix and resend on the same screen | Was a dead end. Now: back to pending with history | Was missing, now strong |
| 4 | Procurement received note to store stock (`distribution.ts:106`, `src/lib/distribution.ts:81`) | Requester signs the goods received note | Stock counts signed notes only | Storekeeper sees why a package cannot go out | n/a | Was missing (stock was typed by hand), now strong |
| 5 | Kobo readiness form to farmer step (`src/server/kobo-link.ts:204`, `src/server/review.ts:56`) | Sync or webhook, then MEL accepts | MEL accepts each record | Correction task with deadline on a No (`review.ts:96`) | Sync is safe to repeat; edits after a decision go to the audit log | Strong. Task goes to the first extension agent on the project, not the one who visited |
| 6 | Kobo distribution form to approval (`kobo-link.ts:321`, `distribution.ts:184`) | Sync | Same gate and flags as the app | Manager email plus Home | Safe to repeat | Strong (read only: no Kobo account in the test) |
| 7 | Kobo submission to result (`src/server/kobo-results.ts`) | Every sync | MEL accepts or queries | MEL on Home | Was: a queried Kobo result stayed queried for good. Now: returns to MEL when fixed in Kobo (`kobo-results.ts:182`) | Was weak, now strong |
| 8 | Result recorded by hand to MEL to recorder (`src/server/results-store.ts:88`, `152`) | Record, accept, query, correct | Data checks; nobody accepts their own | Recorder sees queried results on Home (`src/server/home-store.ts:222`) | Corrected result returns to MEL with history | Strong |
| 9 | Accepted results to indicators, Home, monthly review, quarterly report (`src/server/progress-store.ts:93`) | Read on demand | Counts accepted only | n/a | n/a | Strong: one function counts for every screen (read only) |
| 10 | Spending import to budget lines (`src/server/actuals-store.ts:106`) | Finance imports a workbook | Lines not in the budget are listed | Finance sees "import due" on Home | Re-import replaces the same months | Strong (read only) |
| 11 | Handoff tasks to Home (`src/lib/home-buckets.ts:72`, `home-store.ts:236`) | Any handoff that makes a task | n/a | Was: tasks existed but Home never showed them on database projects. Now: Fix or Due row for the owner; unowned tasks go to the project's leads | n/a | Was missing, now strong |
| 12 | Field work to Home (`home-buckets.ts:96`, `home-store.ts:230`) | Farmer reaches a step a role owns | n/a | Was: nothing; a storekeeper's Home was about reports. Now: "Distribute the input package: 2 farmers are waiting for you" | n/a | Was missing, now strong |
| 13 | Procurement steps, bills, monthly close (`src/server/procurement-store.ts:16`, `src/server/bills-store.ts:19`) | Each save | Server re-runs the screen's rules | Step owner sees it in Record | Procurements refuse a stale save; the bill book is saved whole with no such check | Procurement strong, bills weak (read only) |
| 14 | Daily digest (`src/server/notify-store.ts`) | Nightly job | n/a | Everyone with an email | New items only | Strong, but the demo project is left out on purpose (`notify-store.ts:64`) |

## 2. What was fixed on this branch

Each has a rule test in `src/lib/__tests__/` and was run end to end.

1. **A distribution was charged to the wrong purchase.** With more than one purchase on a budget line, approval added the distribution list to whichever purchase came first, including one with nothing received, and told finance to pay that supplier. Now it draws on the oldest received purchase with enough left (`src/lib/distribution.ts:121`), and finance gets a task only when a payment is still to be made (`:133`).
2. **A retry made a second record.** Recording stored the evidence before the farmer's step. A lost connection then stored it twice, emailed twice and counted the stock twice. Now the waiting record is reused.
3. **Two people saving at once lost one set of checks.** Every distribution's checks sat in one document that was read, changed and written back. Now the database merges one entry in one statement (`distribution.ts:70`).
4. **Sent back went nowhere.** The task went to the first storekeeper, and nothing let anyone correct the record. Now it goes to the person who recorded it, who corrects quantities, signature and photo on the approval screen and sends it again. The manager is told and the history is kept.
5. **The approval screen showed old checks.** A goods received note signed after the record was made left Approve greyed out. Checks for a waiting record are now worked out when it is opened.
6. **Three stock figures.** The store's stock was typed (380 kg, 600 kg) while the gate used purchases. Field activities now shows received less handed out, and says what unblocks a refusal.
7. **Home did not show handoff tasks or field work.** See flows 11 and 12.
8. **A queried Kobo result could never be accepted.** See flow 7.
9. **The same change after acceptance was logged on every sync.** Now once per change (`kobo-results.ts:95`).
10. **Home and sidebar.** Your next step and Waiting on you are first on Home. The sidebar lists a section's places only when that section is open, and Field activities and Procurement are places under Record.
11. **Demo data.** Three first-lot purchases were added so the gate has real receipts: seed and the first fertilizer lot are received; the second fertilizer lot waits for Nadia's signature. Out of the box the storekeeper is refused with the reason, Nadia signs, and the distribution goes through.

## 2b. Second pass, same evening

The two commits made in Cursor after the first pass (per-project package, farmer list upload, the ACRP Kobo form) were run end to end on the demo project and on a made-up real project with three items in three units. They hold. What that run found and fixed:

12. **A Kobo record with nothing given could be approved.** It counted the farmer as supplied and moved them on to planting. The gate now refuses it (`src/lib/distribution.ts`, `gate`), and whoever fixes a sent-back record can add back an item of the farmer's planned package (`applyFix`).
13. **The server accepted any step for any farmer.** The workflow's order was enforced on the screen only. A farmer can now only stay at their step or move to one of its outcomes (`src/lib/field.ts`, `moveProblem`), so an old tab cannot put a farmer back at Distribute and nothing can jump past the readiness or goods-received checks.
14. **The emailed link approved as "the first manager".** Each manager now gets their own link and the decision is recorded under whoever used it (`src/server/distribution.ts`, `tokenOpens`).
15. **A change in Kobo after acceptance reached nobody.** MEL now has a Fix row on Home and a note on the result. Reopening it brings the new figure back to check at the next sync. If the edit is undone in Kobo the row clears itself (`src/server/results-store.ts`, `koboMismatches`).
16. **Home's headline on a project with no targets** read "on schedule: 0 of 0 targets". It now says there are no targets yet.
17. **A real project's field screen said its records were fictional.**
18. **Database tests are in the repo** (`src/server/__tests__/`, one new development dependency: `@electric-sql/pglite`). They cannot reach Supabase.

19. **The demo project's dates disagreed.** Its history sat in March 2027 beside records dated today, and the planting window was 126 days off. Loading or resetting the sample data now moves every date by the same number of days, so the story starts from that day (`src/lib/clock.ts`, `shiftDates`). Donor report deadlines keep their calendar dates. The story goes stale as days pass: reset the sample data before a demo.

## 3. Gaps still open, ranked

1. **A farmer list can start farmers at Distribute**, which skips the readiness check for them (`src/lib/farmer-import.ts`, `START_STEPS`). It is written to the audit log. Right for a project joining mid-season; a way round the gate otherwise. Your rule to set.
2. **The store issue voucher is a tick box, not a number.** Nothing links a distribution to a voucher. This touches your open decision on voucher names.
3. **A correction task goes to the first extension agent**, not the one who made the visit. The app does not keep who sent a Kobo submission.
4. **Home asks the server about 22 things when it opens** (double that on a laptop in development), including HR, timesheets and the review queue for every role. It works; it will feel slow on a weak connection.
5. **The bill book has no check against two people saving at once** (`src/server/bills-store.ts`). Field records are now protected for a farmer's step, but two people editing the same farmer's notes still overwrite each other.
6. **The distribution list at procurement close** needs "in stock" typed by hand to reconcile. Left alone on purpose: a count by a person is the control.
7. **No test drives the screens.** The browser walk-through (sign the received note, record, send back, fix, approve) was done by hand twice and is not in the repo.
8. **A production build was not run** where this was written (the fonts could not be fetched). CI runs it on every push.

## 4. Yours to decide

- Whether a farmer list may start farmers at Distribute (gap 1).
- Names on the distribution voucher, and Dari and Pashto label checks. New screen text from both passes is English only.
- Whether the demo should open with a refusal (as now) or with stock already in the store.

The package-to-budget-line mapping is no longer hard-coded: each project sets it in Field activities.

## 5. Before real data

Neither pass touches secrets or adds a migration. The Supabase password and Kobo key still need resetting. Nothing here was run against the shared database: every check ran on a throwaway database in memory.
