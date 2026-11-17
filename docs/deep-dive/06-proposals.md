# 06. Proposals

Built 17 Nov 2026 on `deep-dive/ux-and-connections`. It is for future calls from any donor. One team's submission tracker for a recent call informed the shape (one table per person, status, what to do, file to save the final as, the donor's clock, upload order). Nothing from that call is in the code or the sample data: the donor, figures and people in the demo are invented.

## What it is

The work between "this opportunity is a match" and "submitted", in the Organization area at `/work/proposals`.

A call for proposals becomes one list. Every item has one owner, a status, what to do and where the final file is saved. Every item is one of three kinds:

| Kind | What it means | What it carries |
|---|---|---|
| **Checkbox** | The donor only checks it is there and correct. No points, and a missing one can sink the proposal. | Owner, signer if someone must sign, due date, file |
| **Scored** | Evaluators score it against the call's grid. | The same, plus the most points, what the grid asks for, what earns the best score against the win themes, and a rating band |
| **Decision** | A named person decides before others can finish. | Owner and due date |

The screen answers two questions and keeps them apart:

1. **Can it be submitted?** Yes only when every decision is made, the budget is inside the call's limits and every checkbox item and scored section is final. It lists what stops it, most serious first.
2. **How would it stand?** A band, not a score: **Differentiator, Competitive, Fringe, Not competitive**. It weighs each scored section by its points in the grid. A low band never stops a submission; it tells the leads where to spend the remaining hours.

Above both is one line: the next step.

## How it adapts to different donors and projects

- **Three ways to start.** From the standard donor package (20 items most institutional calls ask for, a starting point to edit). From an earlier proposal (the same items and win themes, nobody assigned, every item marked to check against the new call). From nothing.
- **Build the list from the call.** Paste the part of the call that says what to submit and how it is scored. AI lists each item in the call's order with the call's own references, marks it checkbox, scored or decision, and writes what would earn the best score against the win themes. Every item it adds is marked for a person to check. Needs `ANTHROPIC_API_KEY`; without it the button says so.
- **Win themes.** Up to three reasons to choose the organization, chosen per proposal by the people running it. Guidance on scored sections and AI ratings are written against them.
- **The call's limits.** A budget ceiling, a limit on support costs as a share of the total and on indirect costs as a share of direct costs. Leave empty what a call does not set. The screen says by how much each is broken.
- **The donor's clock.** The deadline is kept in the donor's time zone and shown to each reader in theirs: "Tue 17 Nov, 23:59 Kabul = 11:29 your time", with the day when it differs.
- **Views.** By person (the tracker's shape), by the call's order, and the order files are uploaded to the donor's portal.

## Rating a section

- A reviewer picks a band, says why in a sentence and what would move it up a band.
- **Nobody rates a section they wrote.** The same rule as every approval in the app.
- **AI can suggest a first rating.** Paste the section's draft; it is read against what the grid asks for. The suggestion is shown and never counted until a reviewer confirms or changes it.
- Change what the grid asks for on an item and its rating is cleared: it was a rating against the old text.

AI reads what is pasted. It does not open files in SharePoint: the app has no live link to it.

## Who can open it

Each organization sets its own core. Changed 17 Nov after your review: the first version matched job titles and offices; that was ROP's shape hard-coded.

| Who | How | What they can do |
|---|---|---|
| **The core** | The organization names it: everyone holding chosen role types in the authority table (default: executive head and programme management), named people, or both. Set on the Proposals page by the executive head or an administrator | Start a proposal; see and run every one: build the list, assign, rate, add contributors, record the outcome |
| **A contributor from staff** | Anyone running the proposal adds any colleague | That proposal only: see it, move their own items, sign what they are named to sign |
| **A contributor from outside** | Anyone running the proposal adds them by name, with organization and email | Holds items and can be a signer. No sign-in: the people running the proposal update their items and record their signature |
| Anyone else | | Nothing. The menu entry is not shown and the API answers as if there were none |

Role types follow the HR record: give someone the role and they are in at once.

## Connections

| From | To | What crosses |
|---|---|---|
| Opportunities | Proposals | A matched opportunity has "Start the proposal"; the title and donor carry over, and an opportunity has one proposal |
| Authority table (HR record) | Proposals | Who holds the role types in the core; the staff list for adding contributors |
| Proposals | Home | "Sign Declarations for the proposal ..., 6 days to the donor's deadline" for a signer; "... 2 items are yours" for an owner. Urgent inside 72 hours |
| Proposals | Audit log | Started, AI runs, ratings, contributors, outcome |
| Proposals | Next proposal | Start from an earlier one |

Not connected yet: a won proposal does not start the project's setup with its results framework and budget. That is the natural next step (see below).

## What was checked

- 30 rule tests and 16 database tests: the core by role type and by name, changing it, a contributor's limits, someone from outside holding and signing items, signing, rating, the readiness answers, the band's weighting, budget limits, the donor's clock, the three starting points, Home rows.
- Run in a browser on a local copy with the fictional sample proposal, as the executive head at laptop and phone width (no sideways scroll), confirming an AI-suggested rating by tapping. As the demo's lead account: the core list, and adding someone from outside by typing. As a contributor: sees the one proposal. As a storekeeper: refused.
- **Not run:** the two AI actions (build from the call, suggest a rating). There is no API key in my sandbox. The prompts, schemas and the path around them are written and typed; the first real run is yours.
- English only.

## Where things are

| File | What |
|---|---|
| `src/lib/funding-proposals.ts` | Every rule: the core, kinds, statuses, bands, readiness, budget limits, the donor's clock, the standard list |
| `src/lib/funding-proposals-sample.ts` | The fictional sample |
| `src/server/funding-proposals-store.ts` | Storage (two documents per organization: the proposals and the core; no migration), the actions, the two AI calls |
| `src/app/api/proposals/route.ts` | The API |
| `src/components/work/proposals-page.tsx` | The screen |

## Decisions for Tucker

1. **Outside contributors have no sign-in.** They are tracked, and the core updates their items. Giving a consultant or a partner their own sign-in limited to one proposal is possible and is new work on accounts, not on this section. Recommended: wait until a real proposal needs it.
2. **Support cost share is measured against the budget total.** Some donors measure it against direct costs. Recommended: keep the total as default and add the choice when a call needs it.
3. **Should the app check the files itself?** Today "final" is what the owner says, and AI rates text someone pastes. With a live SharePoint link the app could confirm each final file exists and read drafts directly. Recommended: yes, after one real proposal has run through this, so the link is built for what the team actually does.

Settled on 17 Nov: anyone can be added to a proposal; the core is the organization's choice; a low band never blocks a submission.

## Next, in order

1. Run "Build the list from the call" on one real past call and compare it with the tracker the team made by hand. That is the test that matters.
2. A won proposal starts project setup with its results framework, workplan and budget (entered once).
3. Attach the call and section drafts as files instead of pasting, once the SharePoint link exists.
4. A go/no-go check at fixed points before the deadline, using the two answers above.
5. Dari, Pashto and Spanish.
