# Functionality baseline (UX audit, 2026-11-19)

The record of what the app can do before the usability work starts. Every item here must still be
reachable after each change (Phase 4 checks against this list). Gathered from the code and a
walk-through of the screens; roles in brackets.

## Navigation as it is today

- Desktop sidebar: Home · Record (Field activities, Procurement, Activities, Grants) · Check (Results,
  Review, Budget) · Report (Weekly, Quarterly, Annual, Stories, Photos, Face) · Organization (only with
  an organization role) · Resources. Sub-items show only under the open section, employees only.
- Phone: bottom bar with Home, Record, Check, Report (and Organization when held). No sub-items; no
  Resources.
- Top bar: project picker, "+ New" menu, USD/Afs currency, person menu (language picker inside).
  Work pages add tabs (All work, Field activities, Procurement) and role tabs (e.g. "Extension 5").
- Not in the menu, reached from Home cards: Timesheet, Leave, Expenses, My details. Settings from the
  person menu.
- AI assistant (employees): floating button on desktop; on phones an "Assistant" tab in the bottom
  bar (changed in batch C, same panel).

## Changes so far (checked against this list)

- Batch A (feedback): visible "Loading…" on pages that were blank while loading; the 17 browser
  confirm/prompt boxes replaced by in-page questions with the same choices (Cancel never acts; the
  opportunity reopen no longer goes ahead with an empty reason); confirmations added before
  restoring the HR sample records and withdrawing an HR proposal; disabled buttons say why; errors
  without a server message say what to do instead of a status code. No function removed.
- Batch C (phone): the progress tracker names the current step; the header slides away while
  scrolling down and returns on scroll up; the step's action buttons stay above the tab bar; the
  assistant is a tab; no text below 12 px; the field season summary wraps to two rows. No function
  removed.

## Home `/home`
Role dashboard: next step, Waiting on you (Approve / Fix / Due), Getting started checklist, quarter
figures, next report and what blocks it, queried results, my results, "More" (numbers and quarter's
work), HR cards. "View Home as" lens (Leadership, People, MEL, Finance, Procurement, Delivery). Stage
sign-off and move with note and confirm.

## Record
- Field activities `/work?source=field`: farmer queue by role; season pipeline counts; store stock;
  farmer steps Train → Prepare plot → Verify readiness (Yes/No) → Correct and recheck / Decide remove
  or extend → Distribute inputs (signed-note photo) → Plant and follow up (planting record, photo) →
  Season record. Checks with "why" help; raise and resolve issues; MEL findings (validate → decide →
  act). Manager: input package setup, farmer list import, target counting choice. Farmer profile
  `/field/farmers/[id]`: satisfaction, story notes, photos, planting.
- Distribution approval `/approve/[code]/[id]`: manager approves or sends back (link or signed in);
  KoboCollect check; recorder fixes a sent-back record.
- Procurement `/work?source=procurement`: queue by role (holder, approver, procurement, finance,
  Home Office), projected "coming to you"; 28 possible steps chosen by value level, from Confirm the
  need to Close out; documents generated and signed (requisition, RFQ, solicitation, contract, payment
  approval form, expense voucher with ledger, closeout checklist); AI drafts and AI check; bids and
  committee; supplier screening; receiving; payments with tax withholding and exchange rate; expense
  voucher coding and VENDBILL #; distribution lists.
- Procurement calendar `/work/plan`, Suppliers `/work/suppliers`, Bills `/work/bills`, Monthly
  closeout `/work/closeout`, Large procurements board `/work/procurements`.
- Activities `/work/activities`, Grants `/work/grants`, Opportunities `/work/opportunities`,
  Proposals `/work/proposals` (track record Word download).

## Check
- Results and proof `/progress/results`: record, import, attach proof, accept, accept many, query,
  correct, reopen [MEL].
- Monthly review `/progress/review`: AI draft, propose, decide, sign off, withdraw.
- Budget and spending `/progress/budget`; Progress `/progress`; Targets `/progress/targets`;
  Framework `/progress/framework`; Field records `/progress/records`; Audit trail `/progress/audit`;
  Learning `/progress/learning`.

## Report
Weekly `/progress/weekly` (items, files, send/lock); Quarterly `/progress/report` (AI drafts, claim
check, GRM, risks, overspend reasons, practice release, release, share links); Annual
`/progress/annual`; Pre-flight `/progress/preflight`; Stories; Photos and posts; FACE form
`/progress/face`. Donor link `/share/[code]/[token]` (read-only, figures open their records).

## Set up and design
Project setup wizard `/setup`: name, country, crop (with crop plan), dates, goal, targets, donors,
review; then budget, voucher coding, deadlines, rules, workplan; then KoboToolbox connect, forms, map.
Fill from documents. Lens review `/setup/lens`. Market windows `/design`. Portfolio `/portfolio`.

## People and organization
People `/people` (HR ledger, proposals, approvals, import, seal), My details, Leave, Timesheets,
Expenses, Payroll (ADP RUN and bank files), Onboarding (policies, contract signing), Offboarding,
Organization hub and audit, Settings (you, project, organization, people and roles, rules this
project follows, notifications, password, health). Resources library.
