# 07. Five-lens review and the one ranked backlog

Written 20 Nov 2026 on `main` at `2aa1f81`, with the changes below in the working folder and not yet committed. It builds on the 9 Nov audit, the 15 Nov pass and `02-audit.md`; it does not repeat them. The question this time: does each workflow serve the five people who depend on it: the person doing the work, the manager, the donor, the auditor and whoever writes the report.

**How I looked.** The local app in demo mode, phone width (375) and laptop width (1280), looking only: nothing was saved. Screens opened: sign-in, Home (extension agent, donor), Progress (donor), Projects, Work, All projects (chief executive, vice president), the project audit trail, the Organization audit log, the person menu. Home's data was also read for the vice president and the country director. The rest is from the code. **Not opened this time:** the procurement steps, HR, payroll, timesheets, leave and expenses screens.

**Checks on the finished work:** typecheck clean, lint 0 errors and the same 11 old warnings, 622 tests pass (616 before, 6 new).

## What changed today

### Navigation

| Change | Before | Now |
|---|---|---|
| Phone tab bar | Home, Record, Check, Report, Assistant, More | Home, + New, Projects |
| Sidebar | Home, Record, Check, Report, Organization, Resources | Home, Projects, Organization, Resources. Projects lists its groups; one group at a time lists its pages |
| Projects page (`/project`) | Did not exist | Every project page in groups: Work, Progress, Reports, Set up, Across projects |
| + New on a phone | A button in the top bar | The centre of the tab bar, same list |
| Assistant on a phone | A tab | A button in the top bar on every screen. Not floating: the step's action buttons are pinned to the bottom of the screen and a floating button would cover them |
| Organization and Resources on a phone | Under More | In the person menu |
| "Activities" | Next to "Field activities" | "Workplan" (menu, page title) |
| Set up | No menu entry | A group for the people who may change the project: Project design, Results framework, Target details, Project settings, Project rules, Market windows |
| Opportunities, Proposals, All projects | Organization | Projects, under "Across projects". The same roles open them |
| A donor's second tab | "Check" | "Progress" |

"All work" keeps its name. I had proposed "Tasks"; the page lists tasks, field steps and purchases together and was renamed from Tasks on purpose.

Every page that could be reached before can still be reached. `docs/ux-audit/functionality-baseline.md` has the entry.

### Fixes from the review

| # | Lens | What was wrong | What it does now |
|---|---|---|---|
| 1 | Management | All projects was empty in demo mode: the demo project is left out of the portfolio and it is the only project there. A chief executive opened "No projects yet." | In demo mode the demo project is listed, with results, money against time, what needs attention and what to celebrate. A live organization's portfolio is unchanged |
| 2 | Donor | The donor's Home came from the first demo: a hard-coded "March progress report", the sample season name and the sample package value, on any project | On a database project it shows the project's own first four targets with accepted results, the project's name and one true sentence about how reports reach the donor. Browser-only demo projects are unchanged |
| 3 | Auditing | Recording a distribution wrote an audit entry with no person: the trail said "System" | The entry names who recorded it (or the matched KoboCollect collector) and the farmer |
| 4 | Auditing | 29 kinds of audit entry had a plain line; at least 60 more showed as "distribution: distribution approved" | Plain lines for distributions (recorded, checked, approved, sent back), donor links (made, closed, opened), month close, bills, the KoboCollect approver and rule conflicts. Every other entry reads as words with its facts, for example "Donor added (name Demo Foundation)" |
| 5 | Auditing | Recording an opportunity, changing it, the match call, reopening it and starting design wrote no audit entry. Only its own history held them and that is saved with the list | Each writes an entry |
| 6 | Auditing | The Organization audit log showed four kinds of entry. Proposal entries were written and shown nowhere; "View as" the same | It shows opportunities, proposals and each use of View as, people by name, with a CSV download of what is on screen and a loading line |
| 7 | Auditing | The project audit trail had no menu entry | It is under Projects, Progress for the people the server lets read it |
| 8 | Implementation | Five sentences still sent people to "Tasks", renamed Work weeks ago | They say Work |

Not changed on purpose: no migration, no change to any approval rule, no change to HR, payroll or procurement screens.

## What each lens found

**Implementation.** The strongest of the five. Home tells each person the one next step, the queue is in three plain groups and the person who records sees what was sent back. The weak point was finding things, which the navigation change addresses. Still open: the season's steps are one fixed path in code (batch 17) and KoboCollect forms are built by hand (batch 18).

**Management.** Home for a lead is good: what to approve, what to fix, what is due and one line that crosses workflows ("2 farmers are waiting for inputs still being bought"). Two gaps. Nothing says how long an approval has waited, except large purchases and grants. And the portfolio says where each project stands but not what is waiting or on whom.

**Donor overview.** The weakest. A signed-in donor gets Home and Progress. Reports reach them only by a link someone makes by hand after release. They see no money. And they are shown a different judgment from staff: on the demo project Progress tells the donor all four targets are "Behind" while All projects tells the chief executive "On schedule, 4 more on track". The staff judgment comes from the workplan; the donor's cards still use the older forecast line.

**Auditing.** Well built underneath: one guard on every route, nobody approves what they recorded, the HR record is sealed in the database. Three gaps remain after today. The project audit log is only protected by the app, not by the database, though the screen says entries cannot be edited. There is no read-only account for an outside auditor. And the Organization audit log shows the newest 800 entries with no period filter.

**Reporting.** The chain is complete: weekly update, monthly review, report check, quarterly report, release, annual and final, funding request. Three gaps. There is one report format. The report's header facts are typed again every quarter (batch 15). And the demo project has no report deadline, so Home says "no deadline set".

## The one ranked backlog

This replaces the order in `03-plan.md`. Batch numbers are from there. S is under half a day, M up to two days, L more.

### Now: before 10 January

| # | What | Lens | Effort | Note |
|---|---|---|---|---|
| 1 | **Run the demo from the deployed app and time Home there.** On a laptop against the remote database Home took 11.6 to 14.1 seconds over four loads and All projects took over 20. Home makes about 25 lookups one after another. On the server each is quick. If Home takes over 2 seconds there, do batch 20 first | All | S to check, M to fix | Yours and Spencer's |
| 2 | **Decide whether the demo shows the donor's view.** If yes, fix the two judgments first (row 9), or the audience sees "Behind" and "On schedule" for the same project inside a minute | Donor | Decision | Yours |
| 3 | KoboToolbox sandbox for the demo (04-log, decision 1). Still waits on a sandbox login | Implementation | S | Yours |
| 4 | Give the demo project a report deadline: a donor rule in Project rules or a Report deadline milestone in Work. Put it in the demo reset so it survives | Reporting | S | |
| 5 | Remind an administrator of unmatched KoboCollect accounts on Home (batch 12) | Auditing | S | Not rechecked today |
| 6 | Warn when a linked field form counts toward no target (batch 11) | Reporting | S | Not rechecked today |
| 7 | Demo picker shows database projects only (batch 9) | Implementation | S to M | Not rechecked today |
| 8 | Reset the demo data the morning of the demo; confirm the email settings on the demo server (04-log) | All | S | Yours |

### Not now: after 10 January

| # | What | Lens | Effort | Needs |
|---|---|---|---|---|
| 9 | One on-track judgment for donors and staff: the donor's Progress cards use the workplan status | Donor | M | A donor-safe status in the progress data |
| 10 | Make the project audit log add-only in the database, as the HR record is | Auditing | M | Migration |
| 11 | A read-only auditor account: one project or the organization, for a set period, with the audit trail, proof and reports and no HR contents | Auditing | M to L | Design note |
| 12 | Age on every Approve row ("waiting 6 days") and a nudge to the approver's manager after a set number of days | Management | M | |
| 13 | After release: make the donor link and send it in the same step; list released reports inside the donor's account | Donor, Reporting | M | |
| 14 | Report header facts stored on the project (batch 15) | Reporting | M | Migration |
| 15 | A donor's own report format, chosen per donor | Reporting | L | |
| 16 | All projects: what is waiting and on whom, across projects | Management | M | |
| 17 | Home opens with fewer lookups (batch 20), if row 1 did not force it earlier | All | M | |
| 18 | Period filter and a server-side download for the Organization audit log | Auditing | S to M | |
| 19 | Proposals: someone added to a proposal with nothing assigned yet has no way in. The menu shows Proposals to the core only; Home shows a row only once they own or must sign something | Implementation | S to M | |
| 20 | Season steps from a template (batch 17); KoboCollect forms generated in the app (batch 18); training sessions as a thing (batch 16) | Implementation | L, L, M | |
| 21 | Exchange rates per currency and month (batch 19) | Reporting | M | |
| 22 | Expense claims carry a budget line (batch 24) | Reporting | M | |
| 23 | Store issue voucher as a number (batch 10) | Auditing | S | Your voucher naming decision |
| 24 | A plain line for each remaining audit entry kind, as they come up | Auditing | S each | |
| 25 | Second-level reporting-line fallback (batch 23); "field forms" wording (batch 21); the last demo constants on the staff dashboard cards (batch 22) | Implementation | S each | |

Translations (batch 8) wait until the rest is ready by your rule. They are not ranked.

### Decisions that are yours

1. **Does the demo show the donor's view?** (row 2)
2. **Do donors see money?** Today a donor sees results and no spending. Budget and spending is staff only.
3. **Organization on a phone.** It is two taps away in the person menu. If HR and Finance staff work mostly on phones it should be a fourth tab for those roles.
4. **May a donor link go out before release?** Open since 10 Nov (`CURRENT-STATE.md`).
5. **An approval from an emailed link** is recorded under the manager it was sent to, with no sign-in (02-audit A8). Unchanged.

## Second pass, 20 Nov afternoon (unattended)

Tucker's instruction: make every change you see fit and keep working. How I read it: no migration, nothing committed or pushed, nothing saved in the app (looking only). The decisions listed above are left to him. Everything below is in the working folder with the first pass.

**Checks:** typecheck clean, lint 0 errors and the same 11 old warnings, 646 tests pass (616 at the start of the day; 30 new, 14 of them against a real database in memory).

### 1. Home opens in about half the time

Measured on the laptop against the remote database, in development mode (where every screen asks for its data twice):

| What | Before | After |
|---|---|---|
| Home's data, asked for alone | 12.8 s | about 5.5 s |
| Home ready on screen | about 17 s | 8 to 10 s |
| Requests Home makes | 27 | 18 to 20 |
| Monthly review data | 7.8 s | about 3.5 s |
| Quarterly report figures | 5.8 s | about 3.2 s |
| Progress summary | 13.7 s | 5.6 s |

On the server each lookup is a few milliseconds, so the gain there is smaller. Row 1 of the backlog still stands: time it on the demo server.

What changed:

- **Reads that do not depend on each other start together** (`src/server/early.ts`) in Home, the monthly review, the report figures, the budget view and the Progress summary. Each is still awaited where it was used, so the order of the rows and the logic are unchanged.
- **A request keeps what it has already read** (`src/server/request-memo.ts`): which project a code names (asked about thirty times by Home), the HR record, the reporting line, the results, the report figures, the budget view and the review. Only for GET requests, only for that one request. A request that changes something reads the database every time, as before.
- **Home and the next report come in one request** (`/home?with=next-report`) instead of two that each rebuilt the same review.
- **Staff on a database project no longer load the field records, the review queue and the purchases on Home.** Those feed the older panels (a donor's Home, a browser-only demo project, a manager looking at a report's work) and were requested for everyone.
- **"+ New" asked for the KoboToolbox address twice per screen** after the first pass put it in the tab bar too. Once now, kept for a minute.
- **A laptop's database pool is 10 connections, was 5.** The server's stays 3. The running dev server keeps its old pool until it is restarted.

Two things kept exactly as they were, on purpose: listing distributions (it first deals with records that have just arrived, which writes) and the read of open tasks after it both stay in sequence.

Tests: the same answers with and without a request's memory for Home, the Progress summary, the framework, the report check and All projects, alone and read together in either order.

### 2. A donor and staff see one judgment

A donor's Progress cards now carry the workplan status staff see ("On track", "No data: due this quarter") in place of the forecast line's "Behind". On the demo project the donor saw "Behind" four times; now three "On track" and one "No data: due this quarter", as staff do. Found on the way and fixed: the framework data a donor's browser receives named the staff who own each activity. A donor now gets the activities without the names.

### 3. Home says how long an approval has waited

Results to accept, field forms to check, KoboCollect distributions to check and distributions to approve show "waiting N days" from two days on, red from a week. Not done: telling the approver's manager after a set number of days.

### 4. Two reminders on Home (batches 11 and 12)

For the people who can fix them (project manager, plan approvers, administrators; the MEL owner for the second): "Match N KoboCollect accounts to the people who use them" and "N linked KoboCollect forms count toward no target". A form counts through a question linked to a target, a target counted straight from that kind of form, or the input package's target.

### 5. Smaller changes

| What | Why |
|---|---|
| The project picker lists database projects only when a database is connected (batch 9) | "Afghan Table Grapes" and "Western Highlands" lived in the browser alone and sat beside real projects. One condition in `current-project.tsx`; with no database they are listed as before |
| Proposals is in the menu for someone on a proposal's team | They had no way in until they owned or had to sign an item. A signed-in person is told only about their own place on a team |
| The Organization audit log takes a period | From and To dates return every entry in the period (up to 5,000) in place of the newest 800 |
| People: the six links under the title wrap on a phone | "Leaving and renewals" was squeezed into three lines at the edge |
| Leave: someone with no HR record is told so | It showed "The rules for No paid leave (consultant)" and nothing else |
| `05-demo-script.md` uses the new navigation | Two steps said "Check" and "Record"; a short section lists what the audience will see differently |

Also opened this pass, at phone width, with no failed request and nothing scrolling sideways: the procurement workspace, HR's Home, People, Payroll, Onboarding, Timesheets, Leave and Expenses.

### Left alone and why

| What | Why |
|---|---|
| A report deadline on the demo project | The sample deadlines are fixed dates on purpose and three tests rest on the fourth quarter having none. A donor rule in Project rules takes a minute by hand |
| Released reports inside a donor's account | A project can have two donors and one quarterly report. Who sees which report is a decision before it is a feature |
| The project audit log made add-only in the database | Needs a migration |
| A read-only auditor account | Needs a design note first |
| The demo's field staff have no HR record | Timesheets, Leave and Expenses each tell Farida she has no record. True of the sample HR book (14 people). It is a dead end if the demo wanders there |

### The backlog after this pass

Done: rows 5, 6, 7, 9, 18 and 19. Partly done: row 12 (the age is shown; no nudge to the manager) and row 17 (Home's lookups run together and repeat less).

Still open before 10 January, in order: row 1 (time Home on the demo server), row 2 (does the demo show the donor's view: the contradiction that made it risky is gone), row 3 (KoboToolbox sandbox), row 4 (a report deadline on the demo project, by hand), row 8 (reset the demo that morning: the waiting ages are counted from the day the sample is loaded).

## Decisions settled, 20 Nov (afternoon)

Tucker answered three of the decisions above.

1. **The demo shows the donor's view and it is to be ready by 10 January.** This is now a piece of work in its own right: released reports inside the donor's account and money. Its design waits on his answers to three questions (when a donor sees spending, how one budget is shared between two donors and at what level of detail).
2. **Donors see money.** ROP reports it to them anyway. They see how their own money is spent. How each donor's reporting is done has nuances still to be written down.
3. **Organization is a tab on a phone** for the people whose role opens part of it. Built: the phone tab bar is Home, + New, Projects and, for those roles, Organization. Resources stays in the person menu. Not seen on screen: the local app stopped answering the browser at the time.

## The donor's view, 20 Nov (evening)

Built on Tucker's three answers: a donor sees money only as a released report gave it, each donor has a setting for what its grant pays for and the donor sees every budget line of its grant. He also confirmed the four points on how donor reporting differs: cost share, indirect costs, each donor's own format and currency. No database change.

### What a donor now has

- **Home:** below the results against targets, three lines. The latest released report, the grant's spending in one sentence and the date of the next report. Each opens the page behind it.
- **Reports (a third tab for donors, beside Home and Progress):** every released quarterly report, newest first. A draft or a practice copy is never listed.
- **A report:** the same report as the emailed link, built by the same code (`donorSafeReport` in `server/share-store`), so the two cannot differ. People by role, places by district, photos the consent rule allows. Below it, "How the grant is being spent": approved, spent this quarter, spent to date and what is left for every budget line the grant pays for.
- **A donor's reading of a report is in the audit trail** (`donor_report_viewed`). Staff looking at what a donor sees is not recorded as the donor's reading. Neither is an administrator using View as.

### What staff now have

- **Project settings, "What each donor funds":** per donor, the whole budget or chosen lines, with each line marked paid by the grant, cost share or not this donor's. Changing it is in the audit trail (`donor_funding_set`). The project manager and plan approvers can change it. It is kept beside the project's other settings (`project_state`, key `donor-funding`).
- **"See what they see"** beside each donor opens that donor's Reports page as the donor has it, with a note saying whose view it is.

### The rules and where each is enforced

| Rule | Where |
|---|---|
| Released reports only | `releases()` in `server/donor-view-store` reads release copies alone |
| Money only as a released report gave it | The figures are the frozen copy's own. A test changes spending after the release and the donor's figures do not move |
| A donor sees its own grant only | A donor account is matched to its donor entry by organization name. Asking for another donor's view returns its own |
| Two donors and nothing set: no money shown | `fundingFor` in `lib/donor-funding`. A project's only donor is taken to fund the whole budget |
| Cost share is apart and never counted in the grant's totals | `roleOf` and `donorMoney` |
| Each donor's own format | Only the targets that donor tracks, under that donor's own references, with that donor's own next report date |
| Currency | Amounts stay in the agreement's currency as released. Nothing is converted |
| Indirect costs | Shown only where the report states them cleanly: a grant that pays for the whole budget, figures that include overhead, one agreement phase. Otherwise the page says they are not shown and why |

### Limits to know

1. **Nothing shows until a report is released.** The sample data has no released report. Release is refused while pre-flight lists anything that blocks. For the demo the sample data needs one released report, or the release has to be rehearsed as a step.
2. **A-2027 has two donors, so neither sees money until someone sets what each funds.** That is the rule working. It takes a minute in Project settings.
3. **A donor that pays for part of the budget sees no indirect figure.** The report states indirect costs for the whole agreement only. A rate per donor would fix it. Not built.
4. **A line can be marked as paid by two grants.** Settings says how many are. Each of those donors then sees the line's full figures, which is right for a co-funded line and wrong if it was a slip.
5. **Budget lines kept in a second currency are not in the line list.** The report's own figures leave them out.

### Checks

25 new tests (13 on the rules, 12 against the test database). 671 tests pass. Typecheck clean. Lint clean on every file touched.

## What was not checked

- **The donor's screens were not seen in a browser.** The local app did not answer on `localhost:3000` (its last recorded activity was 2:27 pm). Home's three lines, the Reports tab, a report with its money table and the setting in Project settings are checked by tests and by the type checker only.

- Nothing was saved, so the new audit entries for opportunities and the recorder's name on a distribution were not seen on screen. The distribution database tests pass with the change.
- The Organization audit log had no proposal or opportunity entries in this database to show.
- Procurement, HR, payroll, timesheets, leave and expenses screens were not opened.
- A production build was not run.

### Demo data for the donor's view (20 Nov, late)

Loading or resetting the demo project (server/demo-report) now sets what each donor funds (Demo
Foundation: the programme lines, with the two salary lines as its cost share; Agri Futures: the two
operations lines) and releases the last quarter that has ended, with its frozen copy, as a real
release does. A report for a quarter still under way could not exist, so before 1 January 2027 none
is released (the project starts on 1 October); reset on the morning of the demo, the donor opens on
the 2026-Q4 report and its spending, and the next report moves on to 2027-Q1. Tests:
src/server/__tests__/demo-report.db.test.ts. Known: run with the clock at 10 January, four older
tests (field saves, a Kobo result on Home, one report count) fail with or without this change: they
are tied to today's date and need looking at before the demo.
