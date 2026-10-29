# ROP Project Harness: Build Spec v1

Oct 28, 2026 · @Tucker Kuhn

## Summary

**The ROP Project Harness links one project from opportunity to donor report in a single record, so every reported number traces back to its evidence.** AI drafts, checks and flags. Named people approve. ROP is the first user and locally led organizations are the end state.

**Pilot:** test the full thin path on the Western Highlands project (past, paused, restart pending), demoable by Dec 10, 2026. The Afghanistan World Bank work (ARLP/ACRP) is the target for production use.

**The pilot works if all four hold:**

1. **Donor-ready output:** the report goes out with light edits only.
2. **Traceable:** click any number in the report and see its source evidence.
3. **Daniel runs it unaided:** ops uses it without Tucker.
4. **Report time cut:** a progress report takes under 2 hours instead of days.

## Decisions

These 28 choices from the Oct 28 Q&A are fixed unless changed here.

| Area | Decision |
| --- | --- |
| Users | ROP staff first, partners later |
| Scope | Full spec; build one thin slice first |
| Pilot | Test on Western Highlands; World Bank Afghanistan is the goal |
| First slice | Full thin path: design, approve, implement, measure, report |
| Pilot users | Tucker, Daniel Sandoval, field staff/enumerators |
| Report | ROP standard progress report as the base, mapped onto the donor template |
| Stack | Cursor + GitHub + Claude; Supabase (Postgres); KoboToolbox for field data; SharePoint as reference |
| Existing pieces | Absorb current reporting, proposal and procurement AI workflows; procurement precheck skill; SharePoint procedures |
| Finance/HR | NetSuite stays the ledger, BambooHR stays HR; harness reads exports, never replaces them |
| Results structure | Generic levels (Goal, Outcome, Output, Activity) mapped to each donor's framework |
| Disaggregation | Gender, age/youth, indigenous/ethnicity, location, household members |
| Languages | English, Spanish, Dari, Pashto available; each user sees only their own |
| AI autonomy | AI drafts and flags; a named human approves |
| Sign-offs | Project plan + budget, procurement steps, report release; more case by case |
| Design principle | Human-centered AI design |
| Evidence | Anything relevant (Kobo, geotagged photos, scanned paper, procurement docs); everything flows together |
| Opportunity pipeline | In the spec, built after the pilot |
| Proposal reviewers | AI reviewer lenses, with a human owning each lens where available |
| Match step | No hard gate; harness shows key info (incl. 50% gross income analysis) for a human judgment call |
| Impact indicators | Optional library (net income, resilience, environment, equity), picked per project |
| Budget vs actuals | Core management tool; NetSuite exports imported in a simple, guided step |
| Kobo flow | Daily scheduled API pull into a review queue |
| Personal data | Pseudonymized: farmer IDs everywhere, names/phones in a locked table, agents see IDs only |
| Multi-org | Every record carries an organization ID from day one; ROP only in pilot |
| Cadence | Monthly AI-drafted project review + live flags |
| Tasks | Live in the harness only |
| Builder | Tucker in Cursor, Spencer as guide |
| Timeline | Thin path demoable by Dec 10, 2026 |

## Architecture

**Build the thin ROP workflow and the shared data model; integrate everything that already solves a hard problem.** The harness is the spine. Kobo, NetSuite and SharePoint feed it. Claude agents work on top of it through a small set of defined jobs.

| Layer | Tool | Role in the harness |
| --- | --- | --- |
| App | Next.js/React web app, built in Cursor, code in GitHub | Project setup, approvals, tasks, review queue, reports |
| Database + files | Supabase (Postgres + storage + auth) | Single source of truth; evidence files stored against records |
| AI | Claude API | Agent jobs (section on agents); every output saved as a draft with its sources |
| Field data | KoboToolbox | Offline forms; daily API pull into the review queue |
| Finance | NetSuite export (CSV) | Actuals by budget line; guided monthly import |
| Policy + procedures | SharePoint | Rules & Controls read from ROP procedures; procurement docs linked, not copied |
| Report output | Word + PDF export | ROP standard report and donor template from the same records |

**Build:** project record, results framework, activities and tasks, approvals, evidence links, review queue, budget vs actuals view, report assembly.

**Integrate, don't build:** surveys and offline collection (Kobo), ledger (NetSuite), HR (BambooHR), document storage of procedures (SharePoint).

**Defer:** live integrations beyond Kobo, complex permissions, configurable dashboards, partner-facing access, the opportunity pipeline.

**Cost at pilot scale:** Supabase free tier to start, $25/month Pro once real data lands; Kobo Community plan is free (1 GB file cap, so store photos in Supabase, not Kobo); Claude API usage is the main variable cost.

## Foundation and data model

**The Foundation from the whiteboard is the harness itself: seven parts every stage uses.** Build it once and each workflow plugs in.

| Foundation part | What it does in the build |
| --- | --- |
| Shared data | One Postgres schema; every record has `org_id` and `project_id` |
| Evidence | Files and Kobo submissions linked to the activity and indicator they prove |
| Rules & Controls | ROP procedures from SharePoint as checkable rules (thresholds, required docs, who approves) |
| AI agents | Named jobs that read records and write drafts or flags, never final values |
| Human decisions | Approval records: who, what, when, what changed, why |
| Audit trail | Append-only log of every create, change, approval and agent action |
| Tasks & calendars | Tasks tied to activities, with owner and due date, inside the harness |

### Core records

The key chain is **Activity → Indicator → Target → Actual → Evidence.** Every reported number is an Actual, and every Actual must point to Evidence and an approval.

| Record | Key fields | Links to |
| --- | --- | --- |
| Organization | name, country, languages | everything |
| Opportunity | donor, deadline, fit notes, match info, status | Proposal (later) |
| Project | name, donor(s), dates, locations, status, S/B/C phase | Results, Budget, Team |
| Result | level (Goal/Outcome/Output), statement, parent | Project, Indicators |
| Activity | name, sequence step, location, start/end, owner, status | Output, Tasks, Budget lines |
| Indicator | definition, unit, disaggregations, data source, frequency, library tag | Result, Targets, Donor mapping |
| Target | value per period and disaggregation | Indicator |
| Actual | value, period, disaggregation, status (draft/validated/approved) | Indicator, Evidence, Approval |
| Evidence | type (Kobo, photo, scan, procurement doc), file or URL, GPS, date, uploader | Actual and/or Activity |
| Participant | farmer ID, community, gender, age band, ethnicity, household size | Activities attended; PII table |
| Participant PII | name, phone, exact GPS | locked; Participant only; no agent access |
| Budget line | category, activity, planned amount, period | Activity, Actuals spend |
| Spend | amount, period, NetSuite reference | Budget line |
| Procurement | request, bids, award, contract, delivery, status, SharePoint links | Activity, Budget line |
| Task | title, owner, due date, status | Activity |
| Approval | object, approver, decision, comment, timestamp | any record |
| Donor mapping | donor framework item ↔ harness indicator/result | Indicator, Report template |
| Report | period, template, sections, status | Project, Actuals, Spend |
| Agent run | job, inputs, output, sources, flags | any record |

### Field sequence (from the field map)

Activities follow ROP's standard sequence, as a template a project can edit:

1. Staff recruited and onboarded
2. Farmers recruited
3. Training of trainers
4. Farmer trainings
5. Farm input package procurement
6. Farm input package distribution
7. Farm visits
8. Follow-on farmer trainings
9. Agribusiness support
10. Marketing support

Cross-cutting across all steps: MEL, budget, expense, payment, compliance, donor reporting, org comms, HR support. Supporting functions: logistics, government affairs, audits, data management, tender.

## Stages

**Five stages from the whiteboard, each with its inputs, what AI does, what a human decides and what it produces.** Pilot scope is marked per stage.

### 1. Develop (opportunity to match)

*Pilot: spec only, built after Dec 10.*

- **Input:** opportunity from a donor call, desk research, field research, team or org experience.
- **Steps:** discover and track opportunity → frame context (needs and problems; donor-informed and team-confirmed, or team-identified) → match.
- **AI:** pulls opportunity details, summarizes fit against ROP's model and past projects, drafts the match brief with key info: need, donor priorities, 50% gross income analysis, ROP capacity, risks.
- **Human:** the match call. No match = save resources for a better opportunity, with the reason recorded.
- **Output:** Opportunity record with a match decision.

### 2. Design (proposal to project plan)

*Pilot: in scope. Western Highlands plan is entered or rebuilt here.*

- **Input:** matched opportunity, ROP proposal template, past proposals, donor requirements.
- **Steps:** proposal draft → lens reviews → development logic → results framework → indicators and targets → budget → project plan.
- **AI:** drafts proposal sections from the template (absorbs the current proposal workflow); runs reviewer lenses (donor perspective, agronomic, agribusiness, market-based, gender, indigenous, underrepresented groups, local) and returns gaps per lens; suggests indicators from the library and the donor's required set; checks budget against activities.
- **Human:** each lens has a named human owner where one exists; Tucker or Daniel approves the project plan and budget.
- **Output:** approved Project with Results, Activities (from the field sequence template), Indicators, Targets, Budget lines, Donor mapping. This is the trigger into Execute.

### 3. Execute (implementation)

*Pilot: in scope for program and field delivery plus procurement status. HR and finance stay outside.*

- **HR & organization:** recruit, onboard/offboard, support. Pilot: a task checklist only; BambooHR stays the system.
- **Program & field delivery:** visits, training, distribution. Activities move through statuses with tasks and owners; Kobo submissions attach automatically as evidence.
- **Procurement:** request → bid → contract → delivery, tracked per activity with SharePoint documents linked. The procurement precheck skill runs at request and award against ROP policy thresholds.
- **Finance & accounting:** budget, expense, payment stay in NetSuite. Harness shows budget vs actuals by activity from the monthly export.
- **AI:** keeps tasks current from incoming evidence, flags late activities, prechecks procurement packages, drafts the monthly project review.
- **Human:** procurement sign-offs per policy; activity status changes the AI cannot confirm.

### 4. Verify (evidence to verified results)

*Pilot: in scope.*

- **MEL:** Kobo data lands in the review queue daily; AI rolls submissions up into draft Actuals by indicator and disaggregation.
- **Data cleaning/quality:** AI flags duplicates, outliers, missing fields, GPS outside the project area and Actuals with no evidence.
- **Financial reconciliation:** guided NetSuite import maps spend to budget lines; AI flags unmapped lines and variances over a set threshold.
- **Compliance:** checks against Rules & Controls (required docs present, approvals done, donor rules met).
- **Human:** MEL owner accepts or queries flagged data; accepted data becomes a validated Actual. Case-by-case sign-off beyond that.
- **Output:** verified results, every number linked to evidence.

### 5. Report, learn and improve

*Pilot: donor report in scope; the rest in spec.*

- **Donor reporting:** AI assembles the ROP standard report from approved records, then maps it onto the donor template. Absorbs the current reporting workflow. Report release needs a named sign-off.
- **Audit:** the audit trail exports per project and period.
- **Project adaptation:** the monthly review proposes changes (re-plan an activity, shift budget, adjust a target); approved changes flow back into Execute.
- **Lessons learned:** captured at each monthly review and project close, tagged by theme.
- **Future proposals:** lessons and verified results feed the proposal library used in Design.

### Key workflows to plug in after the pilot

Procurement, training, grants, MEL, reporting, compliance, audit, finance and accounting, mentor matching, hourly online consultants, grant pipeline, donor pipeline. Each one reuses the Foundation rather than building its own data.

## AI agents and human sign-offs

**Human-centered AI design: agents prepare, check and explain; people decide.** No agent writes a final value, sends anything outside ROP or sees personal data.

### Agent rules

- Every agent output is a draft with its sources listed and a confidence note.
- Every agent action is logged in Agent runs and the audit trail.
- Agents read Participant records by farmer ID only; the PII table is closed to them.
- Agents show their reasoning in plain language so the approver can disagree quickly.

### Agent jobs

| Agent | Stage | Does | Hands to |
| --- | --- | --- | --- |
| Match brief | Develop | Summarizes opportunity, fit and key info for the match call | Tucker |
| Proposal drafter | Design | Drafts sections from template and past proposals | Proposal lead |
| Lens reviewer | Design | One pass per lens; returns gaps and suggested fixes | Lens owner |
| Indicator advisor | Design | Suggests indicators from library + donor set; drafts targets | MEL owner |
| Procurement precheck | Execute | Checks package against ROP policy (existing skill) | Daniel |
| Task keeper | Execute | Updates task status from evidence; flags late work | Activity owner |
| Data checker | Verify | Rolls up Kobo data; flags quality issues | MEL owner |
| Finance mapper | Verify | Maps NetSuite export to budget lines; flags variances | Daniel |
| Monthly reviewer | Report | Drafts monthly review: targets vs actuals, budget vs actuals, risks, proposed changes | Tucker + Daniel |
| Report writer | Report | Assembles ROP standard report, maps to donor template | Report approver |

### Required sign-offs

| Moment | Who signs | Blocks |
| --- | --- | --- |
| Project plan + budget | Tucker or Daniel | Start of Execute |
| Procurement steps | Per ROP policy thresholds | Award, contract, payment request |
| Data accepted as an Actual | MEL owner | Use in reports |
| Report release | Tucker (pilot) | Sending to any donor |
| Anything else | Case by case, set per project | As set |

## Pilot plan

**Six weekly milestones, demo on Dec 10.** Each week ends with something that runs, not a document. Rule: finish the week's milestone before adding scope; new ideas go to the Not Now list below.

### Week 1 (Oct 29 to Nov 4): data in place

- [ ] Gather Western Highlands proposal, results framework, budget, field data and one past report
- [ ] Supabase project, GitHub repo, Cursor setup with Spencer
- [ ] Schema for the core records, with `org_id` and the locked PII table
- [ ] Load Western Highlands structure: results, activities, indicators, targets

### Week 2 (Nov 5 to 11): Design + Approve

- [ ] Project page: results framework, activities, indicators, budget lines
- [ ] Indicator library with the four impact themes
- [ ] Plan + budget approval with the audit trail
- [ ] Lens reviewer agent on the Western Highlands plan

### Week 3 (Nov 12 to 18): Execute

- [ ] Activities with field sequence template, statuses, tasks, owners
- [ ] Procurement tracker per activity with SharePoint links
- [ ] Procurement precheck wired in

### Week 4 (Nov 19 to 25): Measure + Verify

- [ ] Kobo API pull into the review queue (test form if no live data)
- [ ] Data checker agent and accept/query flow
- [ ] Evidence upload: photos, scans, linked to Actuals

### Week 5 (Nov 26 to Dec 2): Budget + Report

- [ ] Guided NetSuite CSV import and budget vs actuals view
- [ ] Report writer: ROP standard report to Word/PDF, with click-through to evidence
- [ ] Donor mapping onto one donor template

### Week 6 (Dec 3 to 10): Daniel test + demo

- [ ] Daniel produces the report alone; log every point he gets stuck
- [ ] Time the report end to end against the 2-hour target
- [ ] Fix the top 3 blockers; demo Dec 10

### Not Now (parked)

Opportunity pipeline build, partner access, live integrations beyond Kobo, HR module, dashboards, mentor matching, consultant marketplace, Dari/Pashto UI.

## Open questions

Answer these before Week 1 ends. The first two block the build.

- [ ] Where does the Western Highlands data live today (SharePoint folder, Kobo forms, spreadsheets), and is there field data or only the plan?
- [ ] Which donor template is the mapping target for the pilot: a past Western Highlands donor, the World Bank format or the prospective restart donor?
- [ ] Who is the MEL owner who accepts data in the review queue: Daniel, a field lead or someone else?
- [ ] Who owns each proposal lens (gender, agronomic, agribusiness and so on) at ROP today, and which lenses have no human yet?
- [ ] Which ROP procurement thresholds apply (amounts and approvers), and is the SharePoint procedure current?
- [ ] What does the NetSuite export look like: which fields and is spend already coded by project and budget line?
- [ ] What variance threshold triggers a budget flag (for example 10% per line per quarter)?
- [ ] Does the World Bank project have its own data protection rules that change the PII design?
- [ ] What is the harness called?
