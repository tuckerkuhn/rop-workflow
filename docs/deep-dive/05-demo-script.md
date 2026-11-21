# 05. Demo script, 10 January 2027

Ten minutes, click by click. Two projects: **A-2027** (running) and **GT-2027** (just won). Everyone and everything on screen is fictional.

**What was rehearsed and what was not.** Steps 1, 2, 4, 5, 6 and 8 were run on 16 Nov against a local copy: by API as each person, and steps 4 and 8 in a phone-sized browser. Step 3 (signing the received note) was opened on screen but not clicked through. Step 7 needs the choice in `04-log.md`, Decision 1. Rehearse the whole script once on the demo server before the day.

## The morning of the demo

1. Demo server settings in place: `DEMO_SIGN_IN=1`, `SITE_PASSWORD`, `RESEND_API_KEY`, `NOTIFY_TEST_TO` set to an inbox you can show on a phone.
2. Reset the sample data: Field activities on A-2027, "Reset sample data" (or `npm run db:seed` on a demo-only database). The story is dated from the day it is loaded, and GT-2027 goes back to nothing set up.
3. Two browser windows: a laptop window, and a phone or a narrow window for the field roles.
4. Sign in as Marcus Bell (fictional, Vice President, Programs). Project picker on A-2027.

## The line to open with (30 seconds)

"Every number we report to a donor should open the record and the proof behind it, and nobody should type anything twice. I will show one workflow end to end, farm input distribution, and then set up a project we just won."

## Part 1. One distribution, field to finance (6 minutes)

| # | Who (switch person top right) | Click | What the room sees | Say |
|---|---|---|---|---|
| 1 | **Bilal**, storekeeper, on the phone | Home | "Distribute the input package: 2 farmers are waiting, but the store has nothing to hand out yet. NPK 17-17-17: none left in the store... PR-2027-011 has been delivered: once its goods received note is signed, more can go out." | "The app will not let fertilizer leave the store that we have not signed for. Nobody typed that stock figure. It comes from procurement." |
| 2 | **Nadia**, project manager | Home | Next step: "Approve the input distribution to F-0002". Further down: "Receive and inspect: PR-2027-011 NPK fertilizer, second lot". | "Her Home is a list of decisions, most urgent first." |
| 3 | Nadia | Tap "Receive and inspect: PR-2027-011". Under Receive and inspect, enter what arrived, tick the inspection checks, sign the goods received note. | The purchase moves past Receive. | "This signature is the gate. Store stock is now 600 kg." |
| 4 | **Bilal** | Home, tap "Distribute the input package". It opens farmer F-0007. Tick "Recipient confirmed by signature or thumbprint" and the voucher number. Tap "Record distribution". | The farmer shows "waiting for approval". | "He confirms the farmer signed. Without that tick it cannot be recorded, and from a phone form it cannot be approved." |
| 5 | **Nadia**, on the phone | Show the email (subject "Approval needed: input distribution in Village B") if email is on. Tap the link, or Home, "Approve 2 input distributions". | One screen: what was handed out, the goods received checks in green, anything to look at, Approve and Send back. | "One screen, one decision. If she had recorded this herself the app would send it to the person she reports to. Nobody approves their own work." |
| 6 | Nadia | Tap Approve. | "Approved. Results: one farmer added to the target... Procurement: added to the distribution list... Finance: told when the purchase has a payment to release. Audit log: your decision is recorded." | "One tap, four teams updated. Nothing re-typed." |
| 7 | **Rahima**, Director of MEL (only with KoboCollect connected, see below) | Home, "Check the KoboCollect distribution..." | "Step 1 of 2: check the KoboCollect record". | "Data from a phone reaches nothing until the Director of MEL has looked. She never approves what she collected." |
| 8 | **Omar**, MEL officer | Home: "Accept or query 11 results waiting for you" (10 before any approval, one more for each distribution Nadia approves). Open Results, accept the new one. Then Projects, Overview (under Progress). | "Farmers receiving the input package" goes up by one. | "And that is the number in the donor report, with the distribution record behind it." |

**If asked "what if the note is not signed?"** Open any distribution from KoboCollect answered "not signed": the page says "This cannot be approved yet" and Approve is greyed out. Send back, the storekeeper confirms the thumbprint, it returns with its history.

**If asked "can we analyse this?"** Field activities, bottom of the page: "Download the field records table". One row per training, readiness check, visit and distribution.

### Step 7 without KoboCollect connected

Skip step 7 as a click. Instead, as Marcus Bell: Setup, KoboToolbox link, "Who approves KoboCollect data". Show "One named person: Rahima Stanikzai, stand-in Omar Sadiq" . Say the line from step 7.

## Part 2. A project we just won (3 minutes)

| # | Who | Click | What the room sees | Say |
|---|---|---|---|---|
| 9 | **Nadia** | Project picker, "Highland Coffee Renewal (fictional, just won)". Projects, Field activities. | "What does one farmer receive?" and a card: "Start from a project that is already running". | "A new project used to start from blank screens." |
| 10 | Nadia | Leave A-2027 selected. Tap "Copy its setup". | "Copied. What to do next:" with three numbered steps. The package is filled in below as a draft. | "The package, who approves field data and the targets come across. Farmers, records and money never do." |
| 11 | Nadia | Point at the note: "This project has no budget yet". Tap "Add the budget in Setup". | Setup for the project. | "Next she uploads the agreement, the logframe and the budget. The app proposes deadlines and budget lines and a person confirms each one. Then she picks the budget line for each input and saves." |

Stop there unless there is time. Uploading `docs/samples/sample-budget.xlsx` takes about a minute and needs `ANTHROPIC_API_KEY` on the server.

## Close (30 seconds)

"Entered once, checked by the right person, traceable to proof. Finance stays in NetSuite, HR in BambooHR, documents in SharePoint. This sits across them."

## Changed on 20 Nov: read before rehearsing

The navigation changed after this script was written (`07-five-lens-review.md`). The steps above use the new names.

- **Three places on a phone:** Home, + New, Projects. Record, Check and Report are one section, Projects. Its page lists every project page in groups.
- **The assistant** is the round button in the top bar on a phone, not a tab.
- **Home says how long an approval has waited** ("waiting 12 days", red from a week). The sample story is dated from the day it is loaded, so reset the demo that morning or the ages look neglected.
- **Two new Fix rows may show on Home** for Nadia, Omar and administrators: "Match N KoboCollect accounts to the people who use them" and "N linked KoboCollect forms count toward no target". They show when a project has linked forms, or accounts that have sent records. On the laptop used for this review the demo project already shows the forms row (3 forms). Either fix them before the demo (Project design, KoboToolbox link) or use them: they are the app telling a manager what would otherwise go unnoticed.
- **The project picker** lists database projects only. "Afghan Table Grapes" and "Western Highlands", which lived in the browser alone, are gone from it.
- **All projects** (Projects, Across projects) now lists the demo project in demo mode. It was empty.
- **A donor's Progress** now says what staff see ("On track"), not "Behind".
- **A donor now has Reports.** Signed in as Elena: Home shows the latest released report, the grant's spending in one sentence and the next report date. Reports lists every released report. A report ends with every budget line the grant pays for. **None of this shows until a report is released** and the sample data has none: see `07-five-lens-review.md`, "The donor's view". Before the demo, set what each donor funds (Settings, "What each donor funds") and have one released report in the data.

## If something goes wrong

| What you see | Do |
|---|---|
| Bilal can record at step 1 | The data was not reset, or the received note is already signed. Skip to step 4. |
| "Not emailed: ..." under the approval page | Email is not set up. Use Home instead of the link. The page says why. |
| Nadia has no "Approve" row | The record came from KoboCollect and waits for its first check: sign in as Rahima or Omar. |
| GT-2027 shows a filled package and no card | It was copied in a rehearsal. Reset the sample data. |
| Dates look old | Reset the sample data. |
