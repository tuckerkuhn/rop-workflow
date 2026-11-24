# Page review against the product definition, 21 Nov 2026 (night)

**The product:** a complete grant-management package for a locally led organization running its first
institutional grant, with no outside subscriptions. Big organizations pay for premium.

**The test for every page:** keep it if a first-time grantee would fail an audit, miss a report or
lose the next grant without it.

**The design language (round 3):** Ledger for management and admin (ruled numbered rows, figures in a
column, one gold-washed row to look at first), Bands for field staff, an AI assistant on premium.

## Stage 7 (monitor, review, report): built this session

18 pages became 10 places. Nothing was deleted from the database and every old address still works.

| Before | Now |
|---|---|
| Pre-flight (own page) | On each report at `#checks`. `/progress/preflight` redirects |
| Quarterly, Annual and final, FACE (three nav entries) | One place, **Reports**, with a tab strip. The FACE tab shows only when a donor is a UN agency |
| Stories, Photos and posts (two nav entries) | One place, **Stories and photos**, with a tab strip |
| Weekly update (under Reports) | Under Progress, beside Results: it is an input, not a report |
| Results framework, Target details (two nav entries) | One place in Set up, with a tab strip |
| Lessons and close-out (no nav entry) | A tab beside Monthly review |
| Post drafting (free) | Premium feature `social_posts`. The photo library, tips and consent stay free |

New, because a first-time grantee needs them:

- **Report calendar** on Progress: every report owed around now with its date and state.
- **Feedback and complaints log** (`/progress/feedback`): what people told the project and what was
  answered. A serious matter is read only by its recorder, plan approvers and administrators.
- **"Why this matters"** line on Results, Weekly, Budget, Monthly review and Audit trail.

Not done: `/progress/records` is not a small duplicate. It is the older all-in-one project page
(1,000+ lines) and still linked from Project design and Tasks. It needs a decision, not a merge.

## The other 37 pages: verdicts, not yet built

| Stage | Page | Verdict | Why |
|---|---|---|---|
| 1 Opportunity | Opportunities | Keep | Finding and screening grants is how the next grant is won |
| 1 | Portfolio | Keep, premium candidate | Only matters with several projects. A small organization has one |
| 2 Design | Project design (market window) | Keep, optional | Specific to trade projects. Should not block a project that is not about a market window |
| 2 | Results framework and targets | Keep | Merged this session |
| 2 | AI review of the plan | Keep, premium | AI feature |
| 3 Proposal | Proposals | Keep | Largest fundraising page. Needs the same restyle |
| 4 Funding | Set up a project | Keep | The agreement's dates, donors, budget |
| 4 | Rules (policy and donor rules) | Keep | The page that teaches the donor's rules. Should carry the most "why" lines |
| 4 | Settings, donor funding | Keep | |
| 5 Prepare | Procurement calendar | Keep | |
| 5 | Suppliers | Keep | Screening is an audit item |
| 5 | (missing) Farmer selection | **Add** | Who was chosen and by what rule is a standard audit question |
| 5 | (missing) Baseline | **Add** | No baseline, no measured change. Could be a section of Results framework |
| 6 Deliver | Work, Activities | **Merge** | Two lists of the same work |
| 6 | Procurements, Bills, Month close (`/work/closeout`) | Keep | Month close should say "month close", not "closeout" |
| 6 | Grants (agribusiness grants) | Keep, optional | Only for projects that give sub-grants |
| 6 | Farmer profile | Keep | |
| 8 Close | Lessons and close-out | Keep | |
| Organization | People, My record | Keep | One component already |
| Organization | Leave, Timesheets, Expenses, Payroll | Keep | Timesheets are an audit item for any donor paying salaries. Payroll text names ADP: reword for small organizations |
| Organization | Onboarding, Offboarding | **Merge** | One "Joining and leaving" page |
| Organization | Organization audit | Keep | |
| Organization | Resources | Keep | |
| Admin | Organization rules, People and access, Health | Keep | |
| Outside | About, Approve by link, Share by link | Keep | |

**Count if all verdicts are taken:** 55 pages today, about 47 after the merges, with 2 added.

## Wording to change for small organizations

The app names ROP's own tools in page text: NetSuite, ADP, SharePoint, BambooHR. A local
organization has none of them. Each mention should become the generic thing ("your accounting
system", "your payroll", "your shared folder") with the name coming from Organization settings.

## 22 Nov 2026: first merges and cuts

- **Records page cut.** It was the original six-tab prototype (sample text only) for the demo project
  and eight link tiles for every other project. `/progress/records` redirects to Projects; the
  component is deleted; the sample sign-off cards on Work open the real pages.
- **Work and Workplan are one place** with a tab strip; the sidebar lists it once.
- **Portfolio is listed only with more than one project.**
- **A deadline milestone belongs to the report its title names** (`milestoneFits`): "Quarterly
  progress report" no longer sets the annual report's date.
- Still to do from the same batch: tool names (NetSuite, ADP, SharePoint) as Organization settings;
  per-project switches to hide Grants and the market window design when a project does not use them.

## 22 Nov 2026 (afternoon): tool names, the look, stage 5

- **Tool names.** Pages and messages name the organization's own file store (`storeNames()`) and
  accounting system (`acct()`), read from Organization settings; generic words until they are set.
  Left as they are, on purpose: the ADP RUN file export and the BambooHR import, which are real
  integrations with those products and not labels.
- **Any secure link** shows a caution under link boxes to the person pasting the link.
- **Section headings** on Progress, Reports, Workplan and Project settings take the ledger heading.
  Boxes inside pages are not yet turned into ruled rows page by page.
- **Farmer selection** (`/work/selection`, project state key `selection`): versioned rules, a decision
  per farmer with reason and who, counts for reports, audit actions `selection_*`. It does not yet
  change a farmer's status in Field activities.
- **Baseline** already lived on Target details. That page now says why it matters and counts the
  targets without one.

## 23 Nov 2026: a week for each job

Home, for the people who manage, opens with **The week ahead** (`lib/week`, `server/week-store`,
`/api/week`): up to three priorities the app proposes and the person confirms, then four sentences
built from the records. No AI, and no numbers: the sentences report every exception, and a number
that is green nine weeks in ten was noise.

| Whose week (`weekKindFor`) | The four sentences |
|---|---|
| Leadership (admin, plan approvers, monthly review) | Reports due, what is blocked or behind, approvals waiting, what changed |
| Project manager (may change the project) | The same, plus budget lines over, results to check or correct, the weekly update |
| Technical lead (project role `technical-lead`) | Farmer selection, field issues and results sent back, approvals, the team's weekly updates |
| Finance (the Finance lens: procurement role `finance` or project role `finance-import`) | Month close and spending imports, budget lines over budget, what waits on them (purchase steps, bill vouchers, expense reports, payroll), what changed |
| MEL (field role `mel` or project role `mel-owner`) | Results and KoboCollect field forms to check (oldest first), results sent back and not corrected, targets with no data or behind before the next report, the report calendar |

- One week each, the first that fits (`lib/week` `weekKindOf`, used by the API and by Home's page): leadership, technical lead, manager, Finance, MEL.
- The week reads in few queries: the documents it needs for every project in one, field counts in one, procurements in one, and only what its kind uses. Home starts it alongside its own read, so it joins Home's read of the open project.
- A priority confirmed last week and not ticked done is proposed first the next week ("from last
  week"), with last week's score under the heading.
- The technical lead reads the field work and decides farmer selection. Approving distributions
  stays with the project's one field manager.
- Not built: visits against a plan (visits are planned a week ahead). The questions for the
  agronomists are in `09-visit-plan-questions.md`.

## 24 Nov 2026: field send-back, speed, and the first slice of the grant ledger

- **The technical lead sends field work back.** On Check › Results and proof he may send a pending
  readiness check, training record or farm visit back with a note (never accept it, never touch a
  distribution, never his own record). Enforced on the server (`lib/kobo-approval` `reviewRefusal`).
- **Speed.** Reads are kept for the length of a request; Home, the week ahead, sign-in, the
  portfolio and the boards read far less; the HR book is kept between requests behind a one-row
  check; Word and zip libraries load on click; other languages load only for their readers. Home and
  the week each answer in about 2 seconds locally (they took 4 to 6). Migration 0028 adds four
  indexes for the hottest reads.
- **The grant ledger** (`09-finance.md`, migration 0027): a chart of accounts, journal entries the
  database keeps balanced and unchangeable, months that lock, and bank reconciliation.
  - New pages: **Record a payment** (`/work/payments`, beside Bills), **Budget vs actual from the
    books** (foot of Budget), **Bank reconciliation** (a section of Month close, `/work/closeout#bank`).
  - A project's pages read spending from the books only once its books are kept in the app
    (project state `books`, set by the demo books and by `npm run ledger:post-expenditures -- --apply`).
    Until then a payment shows in Budget vs actual from the books and nothing else moves.
  - A nightly check (`/api/cron/ledger-check`) confirms the books balance and every completed
    reconciliation still matches; a problem shows on the leadership and Finance week ahead.
  - "Monthly closeout" is now called **Month close**.

## 24 Nov 2026 (later): procurement register, from the UNDP HACT follow-up

UNDP's open finding says no reports come out of a procurement system. The app already runs the
whole purchase (request, approval, quotes or bids, committee, supplier checks, contract, goods
received, payment voucher, close out), so the report is read from those records:

- **Procurement register** (`/work/register`, `lib/procurement-register`): one row per purchase with
  who asked and approved, how it was bought, the supplier, order, goods received, value, payments,
  voucher numbers, documents filed and where it stands. A month's report keeps purchases that moved
  that month or were still open at its end. Downloads as a spreadsheet. Nothing is stored.
- Still to build from the same follow-up: a **training log** (induction within 30 days, yearly
  refresher on anti-fraud and each donor's rules, up to three priorities a year) and a **quarterly
  internal review** (sample drawn by the procedure's rules, checklist, findings rated High, Medium
  or Low, nobody testing what they prepared or approved).

## 24 Nov 2026 (later): training log and opportunities from the call

- **Training log** (`/training`, `lib/training`, HR ledger kinds `training`, `training-plan`,
  `training-void`, `training-start`): carries out the Staff Training Policy in the UNDP response.
  Induction within 30 days, yearly anti-fraud and donor-rules refreshers, up to three priorities a
  year, proof per training, withdrawals kept, a spreadsheet for auditors. Nothing is due before HR
  sets the day the policy took effect. The onboarding induction counts.
- **Opportunities start from the call** (owner's request): paste the link or attach the CFP, RFP or
  similar (PDF, Word or Excel, several at once), and the app reads it and fills in the name, funder, deadline, value, country and what
  the funder wants. The fields appear only once there is a link or a document (or the person chooses to type it all). The person adds notes and any contact with the funder. The match brief reads the
  attached call. Only files the person attached themselves can be put on an opportunity.
- **The 50% gross income analysis is gone** from the form and the match brief (owner's decision).
  Older records keep what they had.
- **Connections:** each server instance holds at most 2 connections (Vercel) or 3 (laptop): the
  session pooler's 15 are shared by all of them.
