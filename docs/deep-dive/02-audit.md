# 02. Audit

Written 16 Nov 2026 against `main` at `79b4f5a`. Baseline before any change: 473 tests pass, typecheck clean, lint 0 errors.

**How I walked it.** The app ran on a throwaway local Postgres with the fictional A-2027 data. I called the API as each demo person (project manager, storekeeper, extension agent, MEL officer, finance, lead, administrator) and opened Home, the approval page and setup at phone width (390 px) and laptop width (1280 px). HR, payroll, leave, timesheets and expenses were read, not walked: they do not sit on the farm input distribution path. Earlier passes (`docs/CONNECTIONS-2026-11-14.md`, `docs/UX-PASS-2026-11-15.md`) fixed a lot; I did not re-list what they closed, and I re-checked the gaps they left open.

**The five principles** (short names used in the table): P1 human-centered and AI native, P2 entered once, P3 simple on a robust base, P4 guides the decision, P5 ethical, efficient, effective.

**Severity:** Blocks = blocks the Jan 10 demo. Hurts = hurts it. Polish = neither. **Effort:** S under half a day, M up to two days, L more.

## The short version

The distribution chain works end to end and is well guarded. Four things stand between it and the brief:

1. A project manager can approve a distribution they recorded or collected themselves (A1).
2. A distribution can close with the recipient's signature not confirmed (A2).
3. The demo has no Director of MEL, the finished project is not marked as started in the database, and there is no "just won" project to set up (D1 to D3).
4. Nothing carries one project's setup to the next. Every new project starts from blank screens and hand-run scripts (T1 to T3).

## A. Approval logic

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| A1 | `src/server/distribution.ts` `decideDistribution`, `mayApprove`; `distributions/[id]/route.ts` | **Self-approval is possible at the manager step.** Anyone with the field manager role approves any distribution on the project. Nothing compares the approver with who recorded it (app) or collected it (KoboCollect). A person holding both storekeeper and manager roles, or a manager who sends the KoboCollect form, approves their own work. The "nobody approves what they collected" rule covers the MEL check, results and field forms, but not this last and most important decision. | P5 | Blocks | S |
| A2 | `src/lib/distribution.ts` `flagsFor`; `decideDistribution` | **A distribution closes without the signed note.** "Recipient's signature or thumbprint not confirmed" is a flag the manager may ignore. From the app the storekeeper must tick it first, but a KoboCollect record answered "not signed" can be approved, the farmer moves to Plant and the supplier payment task is made. The brief says the signed note is required before it closes. | P5, P4 | Blocks | S |
| A3 | `src/lib/kobo-approval.ts` `DEFAULT_KOBO_APPROVAL` | The default for every project is "anyone with the MEL role", which lets a MEL officer's colleague approve but does not put the Director of MEL in front of KoboCollect data. The brief's rule exists only as an option each project must choose by hand. | P4 | Hurts | S (decision) |
| A4 | `decidersOf` | Reporting-line fallback is correct for one level: when the only approver is the collector it goes to who they report to. It stops there. If that person is missing, inactive or not on the project, the record has nobody ("nobody yet" is shown, which is honest), and no one is told. | P4 | Polish | S |
| A5 | `src/server/distribution.ts` `correctionTask` | A readiness "No" makes a correction task for the *first* extension agent on the project, not the one who made the visit, even when the KoboCollect account is matched to a person. | P4 | Hurts | S |
| A6 | `prepare` in `distribution.ts`; `.env.example` | **"Instant" depends on a setting nobody is told about.** The approval email needs `RESEND_API_KEY`, which is not in `.env.example`. Without it the only notice is the Home row, seen when the manager next opens the app. The record says "Not emailed" with the reason, which is good, but for the demo the email must be on, and in demo mode it also needs `NOTIFY_TEST_TO`. | P4 | Hurts | S |
| A7 | KoboToolbox setup screen | The collector rule only works once each KoboCollect account is matched to a person. An unmatched account is treated as "collector unknown", so the named approver could approve a record they collected. I found no reminder on Home that accounts are unmatched. | P5 | Hurts | S |
| A8 | Approval link | A decision from an emailed link needs no sign-in (by design, single use, 14 days, hashed). It is recorded under the manager the link was sent to. Acceptable, but a forwarded email approves as that manager. | P5 | Polish | Decision |

## B. Connections between workflows; data entered twice

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| B1 | `farmers` table and `field_items` | A farmer is stored twice: a row in `farmers` (with plots, initials) and a JSON document in `field_items` (step, village, hectares, sex). Village and enrollment live in both and can drift. Known since 10 Nov. | P2 | Hurts | L |
| B2 | `staff` and the HR ledger | A person is stored twice with no link kept in step. Roles and `reportsTo` on `staff` drive every approval; the HR record is kept separately. I did not trace whether a reporting line changed in HR reaches `staff`; `docs/CURRENT-STATE.md` says the two are not kept in step. | P2 | Hurts | M |
| B3 | Store issue voucher | "Store issue voucher number recorded" is a tick box. No number is kept, so the distribution cannot be matched to the paper voucher or to NetSuite. | P2 | Hurts | S |
| B4 | Expense reports | Staff expense claims carry a funding source and account code but no budget line, so they do not reach Budget and spending until Finance's workbook is imported. | P2 | Polish | M |
| B5 | NetSuite, BambooHR | Both are file imports by hand. Nothing breaks, but "entered once" depends on someone exporting each month. No reminder for BambooHR; Finance has one on Home. | P2 | Polish | L |
| B6 | Demo project stage | A-2027's stage lives in the browser (`useProjectStage`, localStorage) *and* in the database (`projects.stage`). After seeding, the setup screen says "This plan is signed off (Execute)" while the server and Home's lead action say Design: "Sign off the plan and budget to start Execute". | P2, P3 | Blocks | S |
| B7 | Quarterly report header | Title, agreement number, director, locations and partner are typed on the report each quarter and stored nowhere else. | P2 | Hurts | M |
| B8 | Distribution to target | Works, once: an approved distribution makes one pending result for the target the package names. But MEL must still accept it one by one or in a batch, a second human step after the manager's approval and (for KoboCollect) the first check. Three people touch one handover. | P3 | Polish | Decision |

## C. Dead ends, next steps, decisions

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| C1 | Approval page `/approve/[code]/[id]` | The page lists checks and flags well, but when Approve is refused the reason arrives only as an error after the tap. The manager is not told up front "you cannot approve this because..." and what to do instead. | P4 | Hurts | S |
| C2 | Home, project manager | "Check 9 field forms from KoboCollect" is shown for demo records that were typed, not from KoboCollect. The wording is wrong for them. | P4 | Polish | S |
| C3 | New project, Field activities | A new project opens Field activities on "What does one farmer receive?" with empty boxes. Nothing says what comes next (farmer list, forms, who approves) or offers a starting point. | P4, P3 | Hurts | M |
| C4 | Setup wizard | 15 or 16 steps for a new project. The three-uploads path shortens it, but the KoboToolbox steps still need hand work outside the app (see T2). | P3 | Hurts | M |
| C5 | Storekeeper's Home | Good: it says the store has nothing to hand out and what unblocks it. But the storekeeper cannot act on it and the row has nowhere useful to go. | P4 | Polish | S |
| C6 | Project picker | "Afghan Table Grapes" and "Western Highlands" appear in the picker in demo mode but exist only in the browser. Western Highlands says itself that nothing is loaded. In a demo, three projects in the picker where one is real reads as clutter. | P3 | Hurts | S |

## D. Demo readiness

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| D1 | `src/lib/demo.ts` | No Director of MEL in the demo cast, and A-2027 has no KoboCollect approval rule saved. The rule the brief describes cannot be shown. | P4 | Blocks | S |
| D2 | `src/server/demo-seed.ts` | A-2027 is seeded at stage Design. The "fully set up" project asks the lead to sign off its plan. | P3 | Blocks | S |
| D3 | Seed | There is no second database project. The brief asks for one just won and still to be set up. | P4 | Blocks | S |
| D4 | Demo data | The demo opens with the storekeeper refused (no NPK until a received note is signed). It is a good story but it must be scripted, or it looks like a fault. | P4 | Hurts | S (script) |
| D5 | Demo data dates | The sample story is re-dated from the day it is loaded and goes stale. It must be reset shortly before Jan 10. | P3 | Hurts | S (script) |

## E. Templates: what is hard-coded to one project

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| T1 | `project_state` `field-setup`, `kobo-approval` | Each project's input package, season and approval rule are typed from nothing. There is no way to start a project from another project's setup or from an ROP standard. | P2, P3 | Blocks | M |
| T2 | `kobo/*.py`, `kobo/acrp_distribution.json` | A project's KoboCollect forms are built by running Python scripts by hand with a JSON file per project, then uploaded to KoboToolbox by hand. This is exactly the ad hoc per-project work the brief rules out. | P3 | Hurts | L |
| T3 | `src/lib/field.ts` `fieldSteps` | One fixed season path for every project: Train for land preparation, Prepare, Verify, Distribute, Plant. Step names, checks and the 7-day correction deadline are in code. A grape or coffee project with different stages cannot change them. | P3 | Hurts | L |
| T4 | `AFN_PER_USD = 70` in `lib/demo.ts`, used by bills, procurement and the calendar | One fixed afghani rate in code. Guatemala (quetzal) and Vietnam (dong) have no rate at all. | P3 | Hurts | M |
| T5 | `"A-2027"` literals | About a dozen places test for the demo code (`field-store.ts`, `procurement-guard.ts`, `use-rows.ts`, `dashboard.tsx`, two Kobo routes default to it). Most are demo guards and harmless; `dashboard.tsx` shows the demo package value for any project. | P3 | Polish | S |
| T6 | `SEASON`, `PACKAGE_USD` in `lib/field.ts` | Maize, "Village B" and the demo package value are exported constants still read by the dashboard cards. | P3 | Polish | S |
| T7 | `COUNTRIES` in `lib/project-setup.ts` | Fine: Afghanistan, Guatemala and Vietnam are all there. | | | |

## F. Data model: training, readiness checks, farm visits

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| F1 | `evidence`, `field_items` | Training attendance and farm visits are recorded, but only as the raw form in `evidence.payload` and a line in the farmer's timeline. The tables made for them (`training_attendance`, `field_visits`, `input_distributions`) are never written. Readiness is the exception: accepting one writes `readiness_checks`. | P2 | Hurts | M |
| F2 | Field activities download | The only analysis data set is the farmer table: one row per farmer with a date per step. It cannot answer "how many visits per farmer", "which trainer", "attendance by session" or "time from visit to decision", because one row per farmer loses repeat records. | P1 | Hurts | S |
| F3 | Training | A training session is not a thing in the app. Attendance is one record per farmer; nothing groups farmers into a session with a date, place, topic and trainer. | P2 | Hurts | M |
| F4 | Collector | The KoboCollect account is kept on the record (`completed_by`), so who collected is known once accounts are matched. Records synced before the match show the account name only. | P2 | Polish | S |
| F5 | Reporting | Trained farmers and visits count toward a target only when someone maps the form to the target in setup. Unmapped, they move farmers but count nowhere. I found no warning for a field form with no target. | P4 | Hurts | S |

## G. Empty, loading and error states; phones on weak connections

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| G1 | Home | About 22 requests on open. Fine on office wifi, slow on 2G. The placeholder while loading is good. | P3 | Hurts | M |
| G2 | Approval page, Field setup, KoboCollect approval setting | English only: none of the three uses the translation layer. The approver the demo features reads Dari or Pashto. | P1 | Hurts | M |
| G3 | Offline | The service worker keeps the app shell and an outbox for saves. Not checked on a real phone on a weak connection. Field staff are meant to use KoboCollect offline, so this matters less for collectors than for approvers. | P3 | Polish | M |
| G4 | Phone layout | No sideways scroll on Home or the approval page at 390 px. Nothing to fix found on the two screens I opened; the other 46 were covered at phone width by the 15 Nov pass. | | | |
| G5 | Errors | Good: every refusal is a sentence a person can act on, and unexpected errors go to Settings, Health. | | | |

## H. Security and permissions basics

| # | Where | What is wrong | Breaks | Severity | Effort |
|---|---|---|---|---|---|
| H1 | Repo, `src/lib/demo.ts` | The repo is public and the demo cast includes two real ROP staff by name, alongside fictional people. Git history keeps them even if changed now. | P5 | Hurts | Decision |
| H2 | Supabase password, Kobo key | Both earlier passes say these still need resetting before real data. Still true; I have no access to do it. | P5 | Blocks real data, not the demo | S (yours) |
| H3 | Routes | Every API route checks sign-in, project membership and organization, except five that are open by design and each has its own check: the Kobo webhook (per-project password), the digest job (cron secret), session, view-as and the donor photo link (token). Checked by listing every route file. | | | |
| H4 | `DEMO_SIGN_IN=1` | Anyone can act as anyone, by design, on fictional data. If the Jan 10 demo runs on a public address it needs `SITE_PASSWORD` set. | P5 | Hurts | S (yours) |
| H5 | CI | Pushing to `main` applies migrations to the live database. Safe as long as this branch is never pushed there. None of my changes adds a migration. | | | |
| H6 | Staff, session, timesheet routes | Not scoped to an organization (known, safe with one organization). | P5 | Polish | M |

## What is already right and should not be touched

- The gate and its plain-language refusals. The stock lock. One counting function for every screen.
- Send back, fix and resend on one page with history.
- Farmer IDs, never names, in emails, exports and on devices.
- "Not emailed: reason" on the record instead of silence.
