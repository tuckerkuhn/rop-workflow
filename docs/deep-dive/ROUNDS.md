# Rounds: tightening the app until nothing big is left

## Morning summary, 25 Nov

Checked against the log and the commits.

**Rounds.** Seven ran, 1 to 7, one an hour from 00:16 to 06:56. None was missed. None failed.
All pushed to `deep-dive/handoffs-2026-11-24`. Nothing touched main or Supabase.

**Big items fixed overnight (10).**
- Training attendance is one record per session.
- The app makes the readiness, training and farm visit forms.
- Weekly photos keep their place, for people who may see names.
- A donor's view never names a kept document.
- The donor evidence pack never names held proof.
- A donor's account gets no signed note picture and no photo place.
- A farmer photo's place no longer goes to staff kept from names.
- A first year's annual report can be released.
- A bill sent back can be corrected and recorded again.
- Home tells the approver and Finance that a bill waits.

**Big items still open (2).**
- A signed monthly review keeps no copy of its figures (AA).
- A paid purchase or bill does not reach the books. Finance types it twice (AI).

Not walked yet: most of chain 2 and all of chains 3 to 6. More big items may be there.

**Decisions.** Recommended choice first. Letters match "Needs Tucker" below.
- AA. Signing a monthly review keeps that day's figures. Or it shows today's.
- AI. A paid purchase or bill posts to the books by itself. Or Finance keeps typing it.
- X. Refuse a report's release before its period ends. Or keep the warning.
- AB. A donor's account sees only photos cleared for donors. Or all, as now.
- 19 smaller ones, O to AK, are under "Needs Tucker".

**Tests.** 1,204 pass, up from 1,138. Typecheck and lint are clean.

**Next action.** Answer AA and AI. Each unblocks a big item.

Tucker's instruction, 25 Nov 2026, 00:02: "Keep making rounds until we don't need any big changes
left and then start clearing out the medium changes. It must be very tight to be useful and to be
adopted." Each round is one working session, alone, with nobody to ask. Test everything yourself.

**If you are starting a round: read this whole page, then do exactly what "One round" says.**

## Rules that do not change

- Work only on branch `deep-dive/handoffs-2026-11-24`. Never `main`: pushing to main goes live and
  runs migrations on the live database.
- Never touch Supabase, real email addresses or real people's data. Fictional demo data only, on
  the throwaway local database (`docs/deep-dive/tools/setup-local.sh`).
- No migration. No new paid service. No secret in the repo. English only.
- **Tighten what exists. Do not add pages, sections or features.** A fix may add a button, a line of
  guidance or a check where a person is stuck. If the only fix is a new feature, write it in "Needs
  Tucker" below and move on.
- Templates and project settings, not one-off code for one project.
- All field data comes in through KoboToolbox. Nobody approves data they collected. The Director of
  MEL checks KoboCollect data first. Every distribution needs a photo of the signed goods received
  note, added only by the storekeeper or the extension agent.
- A GPS point and a farmer's name go only to people who may see participant names.
- Keep the by-role design: Ledger for management, Bands for field staff. Do not restyle.
- Writing in the app and in these docs: plain words, short sentences, no em dashes, no comma
  before "and", no development-sector jargon. Say what happens next.
- Fixes, not just findings. Every fix has a test or was run in the browser, and the log says which.

## What "big" and "medium" mean

- **Big:** a person cannot finish their step, a number is wrong or lands in the wrong period, a
  rule can be bypassed (approving your own work, proof supplied by the approver), private data goes
  to someone who should not have it, proof does not reach the person who vouches for it, or data
  typed in one step has to be typed again in another.
- **Medium:** the step works but the person has to stop, guess or go looking: unclear wording, no
  "what happens next", a dead end with no link, a date or name shown in a confusing form, a slow or
  jumpy screen, an error message that does not say what to do.
- **Small:** polish. Do not spend a round on it.

## One round

1. **Start (10 min).** `git fetch origin && git checkout deep-dive/handoffs-2026-11-24 && git pull --rebase`.
   Read the log at the bottom of this page. If its last entry says IN PROGRESS and started less than
   50 minutes ago, another round is running: stop without changing anything. Otherwise add your entry
   as IN PROGRESS with the time, commit and push it, so the next round knows.
   Then `bash docs/deep-dive/tools/setup-local.sh`, start the app, and in `docs/deep-dive/tools`
   run `python3 make-photos.py` and `nohup node fake-kobo.mjs &`.
2. **Pick the work.** Take the first open item in "Queue" below. If the queue's big items are all
   done, walk the next chain in "Chains to walk" as every role in it, on a phone-sized screen
   (`walk.py`), and write what you find into the queue as big or medium before fixing anything.
3. **Fix, biggest first.** One fix at a time: change it, test it, commit it. Use
   `sim-kobo.ts` to make a fictional KoboCollect record when the path needs one.
4. **Check (15 min).** `npx tsc --noEmit`, `npx eslint`, `npx vitest run` (about four minutes).
   Everything passes or the round is not finished. Then walk the distribution chain once more
   (make a record, check it as rahima, approve it as nadia) to prove nothing earlier broke.
5. **Close (10 min).** Update the queue and your log entry (DONE, what was fixed, what was found
   and left, test count). Add anything Tucker must decide to "Needs Tucker", lettered. Update
   `10-field-ledger.md` only when a field was added, cut or prefilled.
   `git -c push.negotiate=true push`.
6. **Stop rule.** If you walked a whole chain and found nothing big, say so in the log: that chain
   is clear. When every chain is clear of big items, rounds work the medium list. When a round
   fixes fewer than three medium items because it could not find more, write "NOTHING LEFT WORTH A
   ROUND" as the log's last line. Later rounds that read that line stop at once.

Do not start a second item with less than 20 minutes of the hour left. A finished small round is
worth more than a half-built large one.

## Practical notes (learned the hard way)

- Sign in as a demo person with the header `x-demo-user: <id>` (API) or localStorage
  `rop-session-v1 = {"userId":"<id>"}` (browser). People: `bilal` storekeeper, `farida` extension
  agent, `omar` MEL officer, `rahima` Director of MEL, `nadia` project manager, `yusuf` finance,
  `zahra` procurement officer, `karim` country director, `marcus` vice president (a visitor to the
  field), `daniel` director of operations. Projects: `A-2027` (running), `GT-2027` (just won, empty).
- `npm ci` fails here on the lock file. The setup script runs `npm install` and restores the lock.
  Never commit a changed `package-lock.json`.
- `npm run build` cannot run here (it fetches fonts). CI builds on a pull request.
- Database tests use an in-memory Postgres. Pattern: `src/server/__tests__/distribution-proof.db.test.ts`.
- `audit_log.entity_id` is a UUID. A farmer number does not go there.
- A person's client saves a farmer with a version number. Adding to a farmer from the server
  (a photo) makes that person's open page stale, so keep field staff on their own save path.
- The demo store holds 100 kg of NPK, enough for two distributions. A third is correctly blocked.
- Email is not set up locally. Never write "has been emailed" unless the record says it was.
- Screens use `tx("English sentence")` for text. Keep new text in that form.
- Before writing a new file, check its name is free: `git ls-files | grep <name>`. Round 2 wrote over
  an existing test file by its name and had to restore it.
- Home is `/home`. The review queue on `/progress/results` is closed until "Review N" is pressed.
- The first call to a page or request takes about five seconds here while it is built. A browser
  script that closes the page before the reply comes can leave the record unsaved: wait for the
  message on the screen.
- `FAKE_FORMS=<file> node fake-kobo.mjs` also answers the list of forms in the account, from a JSON
  list of `{ "uid", "name" }` in that file (none when the file is missing). The Setup step that
  lists forms can be walked that way: `/setup?step=kobo-forms`, after `sim-kobo.ts` has made the
  local connection.
- A made form is checked with the standard converter: `pip install pyxform --break-system-packages`,
  then `python3 -m pyxform.xls2xform form.xlsx form.xml`.
- The three checks can run in the background while a walk is under way. They take about five minutes.
  Round 3: the full test run and a browser walk at the same moment ran the sandbox out of memory and
  the app was stopped (`dmesg | grep -i "killed process"` shows it). If a page will not open, look
  there, start the app again and walk after the tests have finished.
- A weekly item keeps where its photos were taken in `places`, by file hash, in its payload.
  `loadUpdates` never returns it. `updatePlaces(code, viewer)` in `src/server/results-store.ts` gives
  it, and only to a viewer who may see participant names. Read weekly places nowhere else.
- No demo person both writes the weekly update and is kept from participant names. A test that needs
  one makes one: `{ ...omar, id: "writer-no-names", pii: false }`.
- `useShownAgain` (`src/components/app/use-shown-again.ts`) counts each time a page left open is
  looked at again. A screen that lists what waits for a person puts the count among what its read
  depends on. In a browser script, set `document.visibilityState` and send `visibilitychange`.
- The log's times are Guatemala time, six hours behind the sandbox clock: `TZ=America/Guatemala date`.
- `act.py` (in `tools`) opens a page as a demo person, presses what it is told and prints the page.
  `walk.py` only opens pages. The app's own "are you sure" box is part of the page and repeats the
  button's words: press the second one (`'click:Accept 10' 'click:Accept 10#1'`).
- Round 4: the app was stopped for lack of memory by walking alone, after about 25 pages. It can
  be started with `NODE_OPTIONS=--max-old-space-size=3072 nohup npx next dev -p 3000 > /tmp/dev.log 2>&1 &`.
  It still went down once more after about 30 pages. Before the last walk, check it answers
  (`curl -s -o /dev/null -w "%{http_code}" localhost:3000/about`) and start it again if not.
- The demo has no released report before 1 January 2027 (the project starts on 1 October 2026). To
  see what a donor sees: accept the results as `omar`, press "Mark final and release to the donor"
  as `marcus`, then "Send and share" and "Make a link". Open the link with no sign-in.
- A page that sends the person on with `redirect()` shows "Application error" here. An address
  that only sends people on is a `route.ts` that answers with the redirect
  (`src/app/(app)/progress/preflight/route.ts`).
- What a donor is told about a kept document comes from `onFileKinds` in `src/lib/evidence.ts`: how
  many and of what kind. A file's name or a link's title never goes to a donor.
- The donor's own account is `elena`. Her Home links to Progress, the released reports and each
  farmer's page.
- Every proof file in the demo is a PDF. To see a photo in the evidence pack, add one to a result
  (`POST /api/files` as `omar`, then the results action `proof` with a caption), and mark it checked
  on the local database: the row in `project_state` with key `photos` holds
  `{"photos": {"<hash>": {"coach": {"isPhoto": true, "people": "none"}}}, "posts": []}`.
  `tools/pack.py` downloads a pack in the browser and prints what is in it.
- `act.py` can fill in a form since round 5: `fields:`, `label:`, `sel:`, `file:`, `btn:`, `btnx:`.
  To record a result: `'sel:#record-pick|IND-4' 'btn:Record a result' 'label:How many|3'
  'fill:main textarea|What was done' 'file:main input[type=file]|note.jpg' 'btnx:Record'`.
- The app starts itself again when memory runs short, and the first page after that is slow. A
  script that times out reading a page has met this: run it again.
- What a donor's account is sent of a farmer is cut in `forOutside` (`src/server/field-store.ts`).
  The donor evidence pack's proof is shaped in `donorPackProof` (`src/lib/evidence.ts`).
- Where a farmer's photo was taken is left out for a reader who may not see participant names
  (`withoutPlaces` in `src/server/field-store.ts`), who gets `hasPlace: true` in its place. Their
  save gets each place back from the stored record (`withPlaces`, called in `keepHidden`).
  `hasPlace` is never stored. `POST /api/projects/A-2027/field/photos` as `farida` with a `gps`
  adds a photo that holds a place.
- To make the local database new in the middle of a round, stop the app first
  (`pkill -f "next dev"`), run the setup script and start the app again. A released report's page
  shows the copy kept at release, so a change to a report is seen only on a database made new.
- The annual report waits only for the quarters the project ran in (`quartersDue` in
  `src/lib/period-report.ts`). Its own range is still the calendar year.
- A report's rows are judged as "period over" unless told otherwise (`buildRows` in
  `src/lib/qpr.ts`, last argument). `src/server/qpr-store.ts` tells it from today's date.
- Chain 2. The purchases are at `/work?source=procurement`. One purchase opens with
  `/work?source=procurement&open=PR-2027-009&project=A-2027`. `/work/procurements` is only the
  board of large purchases. More demo people: `hamid` procurement manager, `farid` and `laila`
  budget holders, `sarah` Home Office compliance, `omid` a second Finance person.
- The demo holds a purchase at most steps (`seedProcurements` in `src/lib/procurement.ts`). Its
  dates are written for March 2027 and moved to today when the database is made. A change to it
  shows only on a database made new, or after "Reset sample data" on the purchases page.
- A step's checks, who owns it and whether it can be sent back are in `steps` in
  `src/lib/procurement.ts`. What the server refuses is in `src/server/procurement-guard.ts`.
- Bills: the rules are in `src/lib/bills.ts`. A bill sent back is never changed. The corrected
  bill is a new one and `redoneAs` finds it by the same document or the same payee and invoice
  number. Who may record, approve and prepare the voucher is `billRoles` in
  `src/server/bills-store.ts`. Home's two rows for bills are in `homeActions`
  (`src/server/home-store.ts`).
- A paid purchase and a filed bill do not post to the books (`09-finance.md`, "What posts
  automatically"). Do not build it: Needs Tucker AI.
- In a test `karim` has no leadership view of Home: the people who hold roles come from a table
  the test database does not fill. Use `marcus` for a row only leadership sees.
- `act.py`: `'btn:Open'` presses "Open AI assistant". On a purchase press `'btn:Review document'`
  and then `"click:It’s correct"` (with the curled apostrophe).
- The app also started itself again twice in round 7, each time just after a file it uses was
  changed. The next page then fails once: wait six seconds and run the script again.

## Chains to walk, in order

Each chain: list every field each role is asked for, where it could come from instead and where it
is used next. Then walk it as each role on a phone. The distribution chain is done (`10-field-ledger.md`).

1. **Results to report.** Field forms accepted, results accepted by MEL, Progress, monthly review,
   quarterly report, the donor's view. As `omar`, `nadia`, `marcus`, a donor. Can an auditor get from
   any number in the report to the record and the photo that prove it?
   *Rounds 4, 5 and 6 walked all of it.* One big item is left and it waits for Tucker (Needs
   Tucker AA, big item 1 in the queue). No round can build it. The next round walks chain 2.
   Not walked, all small paths: "Move budget" and "Re-plan an activity" as changes to the plan, the
   final report for the whole project, the donor's annual report by a share link.
2. **Purchase to payment.** Procurement calendar, purchase request, quotations, approval, goods
   received note, bill, payment, budget line. As the requester, `zahra`, `karim`, `yusuf`.
   *Round 7 walked part of it.* Walked: a request from "Submit the requisition" to "Choose how to
   buy", the pages for "Receive and inspect" and "Check the payment", a bill from recording to
   approval with a send-back, "Record a payment" and the procurement calendar. Not walked: the
   request for quotation, quotations, screening, the contract, signing the received note, the
   payment form, the second Finance check, approving the payment, the three voucher steps,
   "Record the payment", close out, a bill's voucher, month close, approving the calendar, "Ask
   for something not on the calendar", the supplier register and the procurement register.
   The chain is not clear. One big item waits for Tucker (Needs Tucker AI).
3. **Just won to ready.** Project `GT-2027`: from the won proposal to a project that can record its
   first distribution. As `nadia` and as someone who has never run a grant. Count every field asked.
4. **Readiness, training and farm visits.** From the phone to the farmer's record and the target.
   As `farida`, `omar`, `rahima`. Includes the queue's training item.
5. **Home, for every role.** Does each row lead to the thing it names, in one tap, and does that
   screen say what happens next? Empty states and error states included.
6. **People and money for staff.** Timesheet, leave, expenses, approval, payroll. As any staff
   member, their manager, `yusuf`.

## Queue

Big, open:
1. **A signed-off monthly review keeps no copy of its figures.** *Waits for Tucker (Needs Tucker
   AA). Do not build it until he answers: walk the next chain instead.* Found in round 5. The
   review for October, opened on 25 November, shows 11 farmers trained: the year's figure as it
   stands today, under "to the end of 2026 Q4". One training was held by 31 October. Signing off
   stores the name and the time only (`readReview` in `src/server/monthly-review-store.ts`), so the
   signed October review will show December's figures in January. Keeping the figures at sign-off
   is the fix. It changes what sign-off means.
2. *Done in round 7.* **A bill sent back cannot be put right.** Found in round 7, chain 2. `yusuf` recorded a
   fictional internet bill and `karim` sent it back with a reason. `yusuf` then reads "Sent back"
   and the reason at the end of a line of small print. There is nothing to press. His Home says
   nothing. To go on he must type the whole bill again and attach the document again.
3. *Done in round 7.* **A bill waiting for approval is on nobody's Home.** Found in round 7. With the bill waiting,
   `karim`'s Home said "3 approvals are waiting on you" and listed three other things. Only a
   person who opens "Bills paid directly" by himself sees it. Approved bills do reach Finance's Home.
4. **A paid purchase or a filed bill does not reach the books.** *Waits for Tucker (Needs Tucker
   AI). It is a new feature.* Found in round 7. Procurement and Bills keep their own records.
   The books behind the budget's "spent" are written only by "Record a payment", where Finance
   types the supplier, what it was for, the line and the amount again and attaches the receipt
   again. `09-finance.md` lists it as not built.

Medium, open:
1. Dates still show as 2026-11-24 in some places. Use `longDate` or `periodLabel` from
   `src/lib/weekly.ts` where a person reads a date in a sentence. Done in rounds 3 and 4: the weekly
   page's messages, the quarterly report page, the annual report's heading and release line, the
   Results page's "Showing" line, a share link's line, the records a donor opens. Left: Home's row
   "Last week's weekly update (2026-11-15 to 2026-11-19) is not marked sent" (`src/server/preflight.ts`;
   its words are in four languages in `src/lib/i18n/preflight*.ts`, so the dates go in as the words
   `{from}` and `{to}`), the monthly review ("to 2026-10") and the rows of the review queue on
   Results ("2026-11-25 · 2026-Q4 · Village B"). Round 5 did the monthly review: "Signed off by
   Marcus Bell on 25 November 2026", "to the end of October 2026", "Sign off the review for
   November 2026". Its Month box is the browser's own.
2. Some days are cut from a UTC timestamp and show tomorrow's date in the evening in Guatemala.
   Seen in round 3 on the weekly page: "today" is the server's UTC day (`weeklyView` in
   `src/server/weekly-store.ts`), so after six in the evening in Guatemala an item can be dated
   tomorrow, and "Sent by Omar Sadiq on 25 November 2026" is the UTC day it was sent. The same
   holds for "Released 25 November 2026" on a report and for the day a share link was made.
3. A weekly photo added before round 3, or one whose phone removed the place, has no place and the
   weekly page says nothing about it. The farmer page offers "use this device's location" for such
   a photo. The weekly page does not (Needs Tucker U).
4. Done in round 6 (the report and Progress gave different words for the same target).
5. The demo counts one farmer twice. F-0005's training on 20 and on 24 November are two typed-in
   results, both listed as clean. The field forms queue flags the second as "Possible duplicate of
   KB-101". After "Accept 10" the demo says 11 farmers trained. A typed-in result holds a count
   and no farmer number, so the app cannot see this itself: it is the sample data
   (`demoResults` in `src/lib/demo-design.ts`), which makes a result from a record the checker flags.
6. A target card on Results says "8 of 250 farmers" and Progress says "8" of "20". One is the
   whole project and one is this year. Neither says so.
7. The report's narrative has headings "Activity 1.a: Activity 1.a" and "Activity IND: Activity
   IND" for targets that sit under no activity.
8. Home for the extension agent says "IND-5 (Change in net farm income) has a target but no result
   recorded in the period". IND-5 is the app's own code. The donor's code or the name alone would do.
9. The result form lists Afghan provinces (Kandahar, Helmand) for every project. The demo's
   Village B has none to pick.
10. A donor's Home asks the server for KoboToolbox settings and field forms and is refused three
    times (403). Nothing shows on the page. It is wasted work on a slow line.
11. The monthly review opens on last month and its heading says "to the end of 2026 Q4". A person
    reads this month's figures under last month's name. Goes with big item 2.
12. Done in round 6 (the annual report's line about quarters with no saved report).
13. Done in round 6 ("Approve and apply" asks first).
14. More dates not in words, seen in round 6: "Quarterly progress report, 2026 Q4" and "as the 2026
    Q4 report gave it" for a donor, "Mark the 2026 Q4 report final" in the release question,
    "to the end of 2026 Q4" on the monthly review. Part of medium 1.
15. A donor reads, for the income target, "No survey yet this quarter · No survey yet · target 25
    this year · Behind · not done". One "no survey yet" would do.
16. The annual report for 2026 gives its period as "1 January 2026 to 31 December 2026" and shows
    Q1 to Q3 as 0 for a project that began on 1 October 2026.
17. A donor reads two budgets for one grant. Her quarterly report says "USD 10,750 spent of USD
    193,200 approved" and that indirect costs are not shown. Her annual report, released the same
    day, says "Budget USD 346,200, Spent USD 17,950, Overhead included": the whole agreement with
    the cost share. Neither says which it is. Needs Tucker AF.
18. On the donor's reports list on 25 November, with the October to December report released, the
    line reads "Next report: Monthly report: January, due 8 February 2027". Not looked into. It
    may be right, if the quarterly report stands for the monthly reports of its months.
19. Done in round 7. "Record a bill" opened on a project starts with the funding source "General and admin
    (non-contract)". A bill recorded without changing it is charged to no project and no budget line.
20. Done in round 7. Home asks the country director to "Release the 2026 Q3 report in the app". The project began on
    1 October 2026. Round 6 fixed the same thing on the annual report (`quartersDue`).
21. The demo's books and the demo's purchases disagree. The books hold "Seed, first lot: Kabul
    Seed Company, USD 4,850.00". The purchase PR-2027-006, "Certified maize seed (OPV), first
    lot", is $3,100. Sample data (`src/server/demo-ledger.ts`, `seedProcurements`).
22. A purchase names one person for a step that several people may do. After `karim` approved a
    request it said "Waiting on Hamid Wardak (Procurement officer)". Hamid is the procurement
    manager and `zahra`, the officer, had it on her list and did it. `zahra` was also told a
    request was "with Farid Sultani" while it sat on `nadia`'s list.
23. Dates in the procurement pages are not in words: "Needed by 2026-12-16", "~11-26" under
    "Coming to you", "2026-11-21 · Farid Sultani" in the history. A bill reads "Invoice KN-1101,
    2026-11-25". Part of medium 1.
24. Small things seen on a purchase: "1 documents" and the demo's requisition gives its funding
    source as "Award A-2027 (fictional) · body rules apply".
25. Done in round 7. The demo's purchase at "Check the payment" (PR-2027-009) had an invoice with
    no number and no date. Finance read "Enter the invoice as received" and cannot enter one at
    that step: procurement enters it at the step before and a real record cannot pass that step
    without it. The only thing to press was "Record corrected invoice or credit note".
26. The demo's two closed purchases (PR-2027-006 and PR-2027-007) hold the same kind of invoice,
    with no number and no date. Not seen on a screen. Sample data.
27. At "Check the payment" the button "Record corrected invoice or credit note" ticks the check
    and asks for nothing. Read in the code only (`resolve` on the check `match` in
    `src/lib/procurement.ts`). Walk it before changing it.

Done: see `11-handoffs-review.md` and `10-field-ledger.md`. Round 1: training attendance is one record
per session with its farmers ticked (was big item 1). Round 2: the app makes the readiness, training
and farm visit forms (was big item 1), Accept stays put while a photo loads (was medium 5), the
counts in `11-handoffs-review.md` are dated (was medium 4). Round 3: weekly update photos keep their
place for people who may see participant names (was big item 1), Home is read again when a person
comes back to it (was medium 3), Setup offers the distribution form beside the other three (was medium 4).
Round 4: the donor's view counts kept documents and never names them (big, found in the walk), the two
old addresses work, the quarterly report gives one blocking count and warns before an early release.
Round 5: the donor evidence pack counts held proof and never names it (was big item 1), a donor's account
is not sent the signed note's picture or a photo's place (big, found in the walk), a result sent back is
pointed to and its answer shows for MEL, the monthly review asks before it locks.
Round 6: the place of a farmer's photo is not sent to staff who may not see participant names
(was big item 1), the annual report of a project's first year can be released (big, found in the
walk), a report under way and Progress give the same word for a target (was medium 4), a donor's
annual report names its figures on a phone, the annual report names quarters with no saved report
(medium 12), a change to the plan asks before it is applied (medium 13).
Round 7: a bill sent back can be corrected and recorded again with nothing typed twice (was big
item 2), Home tells the approver a bill waits and tells Finance a bill came back (was big item 3),
a bill recorded on a project's page starts as that project's and the form says what is still
needed (medium 19), Home asks for a report's release only for a quarter the project ran in
(medium 20), the demo's payment check has its invoice (medium 25).

## Needs Tucker

Decisions A to N are in `11-handoffs-review.md`. Rounds add theirs here, lettered from O.

- **The real phone test.** No round can do it. The form "SANDBOX ROP Input distribution" is deployed
  in his KoboToolbox account. The steps are at the end of `11-handoffs-review.md`. Since round 1, also
  upload `kobo/training_attendance.xlsx` and look at the tick list of farmers on a real phone: does a
  search box show above the list when the list is long?
- **O. Dari and Pashto for the new training question.** Rounds write English only. The tick list's
  label reads "Farmers who attended the classroom and field parts of the session" in English and
  reuses the word "Farmer" in Dari and Pashto. A native speaker should word it. Setup's one line
  about the training form also changed in English only.
- **P. One held farmer stops the whole session record.** The rule from before is kept: a farmer on
  the waiting list or left out in Farmer selection cannot be moved by a field form. With one record
  per session, the MEL officer now sees "F-0012 is waitlisted in Farmer selection. Select them first,
  or send this form back" and nobody on that record is recorded until one of the two is done. The
  other choice is to record everyone else and skip the held farmer. Say which you want.
- **Q. A project already collecting with the earlier training form.** I cannot see your KoboToolbox
  account. If a real project uses the earlier form, replace its file there with the new one. Nothing
  else is needed: its old records and its link to a target keep counting.

- **The real phone test, added in round 2.** Download the three made forms from Setup (the step
  "Which forms belong to this project?"), upload each to the sandbox account and fill one in on a
  real phone. Look for three things. A planting date after the visit date is refused with a
  message. An area above the farmer's plot is refused. The farmer's plot size shows under "Area planted".
- **R. Which forms a project in Afghanistan uses.** The forms the app makes are English only. The
  files in `kobo/` have Dari and Pashto drafts but are made by a script. Until a native speaker has
  worded them, a project that needs Dari or Pashto on the phone still needs the `kobo/` files. Say
  when the wording is reviewed and the app's forms can carry all three languages.
- **S. The plot photo is required on the readiness form the app makes.** It was optional on the
  earlier file. A record without it was flagged for the checker and left the farmer's photo check
  open, so the form now asks for it. Say if a readiness visit may be sent without a photo.
- **T. The training sessions are the same three for every project**: land preparation and planting,
  crop care and irrigation, harvest and storage. A project with other sessions would need them as a
  project setting. That is a new setting, so it is not built. Say if you want it.

- **U. A weekly photo with no place of its own.** Many phones and messaging apps remove the place
  from a photo. The weekly page then keeps no place for it and asks nothing. On the farmer page a
  person can press one button to use the place of the device in their hand. Say if the weekly page
  should offer the same. It is a new button, so it is not built.
- **V. Who sees where a weekly photo was taken.** The rule followed is yours: only people who may
  see participant names. In the demo that means the storekeeper, the extension agent, the MEL
  officer and the project manager see it. The Director of MEL, the country director and the vice
  president do not. Say if the Director of MEL should, since she vouches for field data.
- **W. Photos already on weekly items have no place.** The place is read on the phone when the
  photo is added, before it is made smaller. The stored copy does not hold it. Nothing can bring
  it back for photos added before round 3.
- **The real phone test, added in round 3.** Add a photo to a weekly item from a real phone, taken
  with the camera's location on. The form should say "Place found in the photo" under it. Then
  open the item as the project manager and press "Show on a map": the map should show the plot.
  No round can see the map. This sandbox cannot reach OpenStreetMap.

- **X. Releasing a report before its period has ended.** On 25 November the vice president could
  release the report for October to December in two taps. It is then locked for good. The question
  he is asked now says "This period has not ended: it ends on 31 December 2026. A result accepted
  after today will not be in the report the donor receives." The other choice is to refuse the
  release until the period has ended. It is not built: it changes who may do what and when. Say
  if you want it.
  From round 6 the annual report asks the same question when its year has not ended. On 25
  November the annual report for 2026 can be released once MEL has accepted the waiting results.
- **Y. A report can be released with nothing written.** In the local test the report went out with
  all 15 sections "Not written yet". Empty sections are listed as worth fixing and do not block.
  Say if an empty Executive Summary should block the release.
- **Z. What a donor is told about a kept document.** Before round 4 a share link and a donor's
  account listed each file by its name ("Attendance sheet: F-0005, 2026-11-24.pdf"). A name typed
  by staff can hold a farmer's name, so the donor now reads "1 PDF document". This holds for links
  already sent. If a donor must be able to ask for one document by a reference, that reference
  would be a new thing. Say if you want it.

- **AA. What a signed monthly review shows.** Today it shows the year's figures as they stand on
  the day it is opened, whatever month it is for, and signing keeps no copy. The other choice:
  signing keeps the figures of that day, and the page shows them for good, with the date. It is
  not built, because it changes what your signature on a review means. Say which you want.
- **AB. What a donor's account sees of a farmer.** A donor's account can open each farmer's page:
  number, village, plot size, sex, age band, household size, satisfaction comments, staff names and
  every photo. From round 5 it is not sent the signed goods received note's picture or where a
  photo was taken. The other photos still go, with no check of the consent rule that a report's
  photos must pass. Say if a donor's account should see farmer photos at all, or only those cleared
  for donors.
- **AC. A donor's Home shows results before any report is released.** With no report released,
  `elena` reads "Farmers trained in land preparation 11 of 250". The reports page gives a donor
  released figures only. Say if Home should do the same.
- **AD. The donor evidence pack's "What was done" column.** It gives each result's note with names
  taken out by a rule that reads English only and misses some names. The pack now gives no file
  name and no link title. Say if the note should go to a donor at all.
- **AE. An empty monthly review can be signed off.** The question now says what is not written.
  It does not refuse. Say if an empty summary should block the sign-off (as Y asks for reports).

- **AF. Which budget a donor's annual report gives.** The donor's quarterly report gives the lines
  her grant pays: USD 193,200 approved, with no indirect costs. Her annual report gives the whole
  agreement, with the cost share and overhead: USD 346,200. Say which a donor should read on the
  annual report. Nothing was changed.
- **AG. The words for a target in a report that is opened before its period ends.** Until round 6
  the quarterly report said "Behind · delayed" for work planned for the quarter under way, on the
  page, in the Word file and on a donor's link, while Progress and the monthly review said "On
  track". It now says what they say until the period has ended, and judges as before after that.
  A report released early is kept with the words of that day. Say if you want it otherwise.
- **AH. Staff who may not see participant names are told that a photo's place is kept.** The
  farmer's page still says "place recorded" beside the photo for them. They are never sent the
  place. A donor's account is told nothing, as before. Say if staff should be told nothing either.

- **AI. A paid purchase or a filed bill and the books.** Procurement and Bills each keep their own
  record of a payment. The books behind the budget's "spent" are written only on "Record a
  payment", so Finance types the same payment a second time and attaches the receipt a second
  time. The other choice: recording a purchase as paid, or filing a bill's voucher, writes the
  payment to the books by itself. It is not built. It is a new feature and it decides which
  record the budget trusts. `09-finance.md` asks the same thing as its question 20. Say if you want it.
- **AJ. Where a new bill starts.** On a project's page "Record a bill" started as "General and
  admin (non-contract)", with no project and no budget line. From round 7 it starts as the project
  on the screen and asks for a budget line. General and admin is one choice away. Say if most
  bills are general and admin and should start there.
- **AK. A bill sent back keeps its number and the corrected bill gets a new one.** BL-001 stays
  on the list as "Sent back" with the reason and the line "It was corrected and recorded again
  as BL-002". The other choice: the same bill is changed and sent again under its own number. It
  is not built, because it changes a bill after an approver has ruled on it.

## Log

Newest last. One entry per round: started, status, chain or item, fixed (with test or browser),
found and left, tests passing.

- **Round 0. 24 Nov 22:26 to 25 Nov 00:20. DONE.** The distribution chain, three passes in one
  session with Tucker. Proof reaches checker and approver, where and when read from phone and
  photo, the app makes the distribution form, visitors can add photos, three holes closed.
  1,138 tests pass. Detail in `11-handoffs-review.md`.
- **Round 1. 25 Nov 00:17 to 00:44. DONE.** Queue, big item 1 (training attendance, one record
  per session). One item, finished. No second item: a later round may start 50 minutes after this
  one began, and the checks take about ten of those. Neither big item left fits in what remained.
  Design, written before building. It needs no migration and the old records keep working, so it is built.
  - *The form.* One record per training session. The trainer picks the session and the date once, ticks
    every farmer who attended (question `farmers`, a tick list from `farmers.csv`), gives the register
    reference once and takes one photo of the signed page. The per-farmer "did the farmer attend" is cut:
    a farmer who is not ticked did not attend.
  - *Stored.* One row in `evidence` per session, as now. `farmer_code` stays empty. The ticked farmer
    numbers stay in the stored answers (`farmers`: "F-0004 F-0005"). No new table or column.
  - *Checked.* The review queue shows one row, "Training attendance, 12 farmers", with the farmer numbers
    and the register photo. The MEL officer accepts once. Accepting does for each ticked farmer what it
    did for one before (`applyTraining` in `src/server/review.ts`), in one transaction.
  - *Rules kept.* A farmer on the waiting list or left out in Farmer selection still blocks the accept,
    and the message names them. Nobody accepts a record they sent. The data checker flags a ticked farmer
    who is not on the list or is past Train, and a second record for the same session and day.
  - *Counted.* Each ticked farmer counts once toward a people target, on all three paths: a target
    counted straight from training forms (`actualFor`), a question linked in Setup counted as "each
    different answer once" (`mappedValue`), and the result record made for MEL (`koboToResults`), where
    women, men and young people are added up from the farmers' own records.
  - *Old records.* A record with one `farmer` and `attended` yes or no reads, flags, accepts and counts
    exactly as before. Both shapes can sit in the same queue.
  Fixed:
  - *Training attendance is one record per session.* Built as designed above. The form
    (`kobo/build_field_forms.py`, `kobo/training_attendance.xlsx`) converts cleanly with the standard
    XLSForm converter. The queue row, the photo and the accept were run in the browser on a phone-sized
    screen as omar and as rahima with a fictional record (`sim-kobo.ts training`, new). After the accept
    the page said "Training recorded for 3 farmers. 1 moved to Prepare the plot. 1 stays at Train: F-0003
    (contribution not yet paid). 1 already past Train, attendance noted: F-0005." Test:
    `src/server/__tests__/training-session.db.test.ts`, 8 tests: the queue row and its flags, one accept
    for many farmers, the audit line naming every farmer, the selection hold, all three counting paths,
    records from the earlier form beside the new ones, and the records table (one row per ticked farmer).
  - *A link on either farmer question counts both shapes.* A project that linked the earlier form's
    `farmer` question to a target keeps counting when it changes to the new form, with no change in
    Setup. Without this the new records would have counted nothing. Test: same file.
  - *An absence counted as a farmer trained.* Found while reading the counting code. On a target counted
    straight from training forms, an accepted record from the earlier form that said "did not attend"
    added one farmer trained. It no longer does. Test: same file.
  Found and left:
  - Accept can do nothing just after the photo is opened (medium 5 in the queue).
  - Dari and Pashto wording, the held farmer and projects on the earlier form: Needs Tucker O, P, Q.
  - Women, men and young people on a session's result are filled in only when every counted farmer's
    record gives them. One farmer with no sex recorded leaves the session's women and men empty for MEL
    to fill in. A part count would have read as the whole.
  Checks: 1,146 tests pass (1,138 before), typecheck clean, lint clean. Distribution chain walked on
  the final code after a fresh local database: a fictional KoboCollect record for F-0007, checked by
  rahima, approved by nadia, farmer moved to planting. The refusal for nadia before the check was seen
  on the final code too, on a record for F-0008 that the store then rightly blocked (no NPK left).
  `10-field-ledger.md` updated: the per-farmer attendance question is cut.
- **Round 2. 25 Nov 01:16 to 01:40. DONE.** Queue, big item 1 (the app makes the readiness, training
  and farm visit forms), then two medium items that fitted. Big item 2 (the place on weekly photos)
  was read and not started. It touches about ten readers and a private point. It did not fit in
  what was left. What was read is in the queue under it.
  Decisions made alone, to check: the made readiness form requires the plot photo (Needs Tucker S).
  The made forms are English only, like the distribution form the app makes (Needs Tucker R). The
  training sessions stay the same three for every project (Needs Tucker T). The buttons are on the
  Setup step where the project's forms are chosen, because that is where a person with no form stops.
  Fixed:
  - *The app makes the readiness, training and farm visit forms.* `src/lib/field-forms.ts`, same
    approach and same question names as before, so everything already read, flagged, accepted and
    counted still is. On the Setup step "Which forms belong to this project?" there are three
    buttons, the steps to put the file on phones and "I have uploaded it. Load the list again",
    which keeps what is already ticked. Before, the step said "This account has no survey forms yet"
    and stopped.
    Three things are tighter than the hand-built files. The farm visit form asks for the number
    planted or for the area planted, never both, by the crop plan saved in Set up (the number only
    when the plan has a spacing, so the app can always turn it into hectares). A date in the future,
    a planting date after the visit and an area above the farmer's plot are refused on the phone.
    The readiness form requires the plot photo.
    Run in the browser on a phone-sized screen as nadia: the empty step, the three downloads, the
    list loaded again with three forms and each one's purpose guessed from its title. All three
    files, and a farm visit form for a crop counted by the vine, convert cleanly with the standard
    XLSForm converter and its checker. Tests: `src/lib/__tests__/field-forms.test.ts`, 7 tests (the
    questions, the choice lists, what is refused on the phone, the visit form by area and by count).
    `src/server/__tests__/made-forms.db.test.ts`, 5 tests: each file opens as a workbook, the visit
    form follows the saved crop plan, and an answer to every question on each made form is read
    back by the app.
  - *Accept stays put while a photo loads* (was medium 5). Measured on a phone-sized screen as
    rahima: after "See the photo and where it was recorded" the Accept button moved 570 pixels down
    the screen in two jumps within a second, as the facts and then the photo arrived. A tap aimed at
    Accept landed on the photo. The box now opens at its final size and the button does not move
    (measured: one position for four seconds, on a readiness and a training record). Then run: the
    tap aimed before the photo arrived and made after it landed on Accept, the request was sent,
    "Field activities updated: Readiness: Yes. Moved to distribution." showed and the record was
    saved. No test: it is layout. I cannot prove this was the cause of what round 1 saw, only that
    the cause it named was real and is gone.
  - *The counts in `11-handoffs-review.md` are dated* (was medium 4), and point here for the current ones.
  Checked, not changed:
  - Medium 3. A distribution sent back by the checker (rahima, F-0009) is on bilal's Home the next
    time it loads, by the request and in the browser. A Home left open does not show it. Reworded in the queue.
  Found and left:
  - Home does not load again when a person comes back to it (medium 3).
  - The distribution form is downloaded in another place than the other three (medium 4).
  - Needs Tucker R, S, T and the real phone test of the three made forms.
  Checks: 1,158 tests pass (1,146 before), typecheck clean, lint clean, on the final code (only
  these pages changed after). Distribution chain walked in the browser after that, on the local
  database made new at the start of this round: a fictional
  KoboCollect record for F-0007. For nadia, Approve could not be pressed before the check and the
  page said "Step 1 of 2: check the KoboCollect record". rahima saw the signed note and pressed "I
  have checked this record". nadia approved. The farmer moved to planting.
  `10-field-ledger.md` updated: the farm visit form asks one of two questions, the readiness photo
  is required, and finding 5 is closed.
- **Round 3. 25 Nov 02:16 to 02:39. DONE.** Queue, big item 1 (the place on weekly update photos),
  then medium 3, medium 4 and one part of medium 1. No chain was walked: the queue had a big item.
  All big items in the queue are now done, so the next round walks chain 1.
  Decisions made alone, to check: the place is shown on the weekly page only, to the people who
  may see participant names, and on no other screen (Needs Tucker V). A photo with no place is
  added with no question (Needs Tucker U). A place already stored for a photo is never replaced
  by an edit. The map opens only when asked for, with the same line about OpenStreetMap as the
  approval page.
  Fixed:
  - *Weekly update photos keep their place* (was big item 1). The phone that adds a photo reads
    the place from it where it reads the date, before the photo is made smaller, and the form says
    "Place found in the photo. Only people who may see participant names are shown it." The item
    stores it by file (`places` in `updateSchema`, no migration). `loadUpdates` leaves it behind, and
    the type it returns has no such field, so none of its readers can pass it on. Only
    `updatePlaces(code, viewer)` gives it, and only to a viewer who may see participant names.
    The weekly page shows those people "Show on a map" under the photo. An edit keeps the stored
    place of every photo still on the item, whoever edits, drops it with a photo taken off and
    takes it for a photo added. The copy kept when a week is sent and the Word file do not hold it.
    A photo saved with no connection takes its place with it when it is sent.
    Test: `src/server/__tests__/weekly-photo-place.db.test.ts`, 8 tests: the shape accepted, nothing
    on what readers get, who is given it and who is not (a writer kept from names included), the
    weekly page's answer for each, an edit by someone whose screen never held it, a photo taken
    off and one added, places only for files on the item, and the copy kept when a week is sent
    (through the weekly route).
    Run in the browser on a phone-sized screen with fictional photos. As omar: two photos added,
    one with a place and one without, the form said so for the first only. "Show on a map" showed
    34.56230, 69.21010 and the map frame for that point. After an edit of the text the place was
    still there. With the connection off, an item with a photo was saved on the phone, and once
    the connection was back it was sent with its place under the photo's real file hash. As
    nadia: both buttons. As rahima, marcus and karim: the photos, no button, and no point anywhere
    in what the server sent them. The week was then marked sent: the copy kept holds no point.
    The Word file downloaded as nadia holds no point and its pictures hold no photo data.
    Not seen: the map itself. This sandbox cannot reach OpenStreetMap.
  - *Home is read again when a person comes back to it* (was medium 3). Home and the Tasks list
    read their rows again when a page left open is looked at again, not more often than every 20
    seconds. Run in the browser as bilal on a phone-sized screen: Home open, rahima sent a
    fictional record for F-0007 back, the row was not there, the page was looked at again and "Fix
    the distribution record for F-0007" showed with its link, with one new read and no reload.
    Looked at again 6 seconds after loading: no read. Looked at again with the connection off:
    the rows stayed and no error showed. No test: it is the browser's own event.
  - *Setup offers the input distribution form beside the other three* (was medium 4). The step
    "Which forms belong to this project?" has a fourth button. Run in the browser as nadia on a
    phone-sized screen: the file came down for A-2027 and the next steps showed. For a project
    with no input package the server answers "Save the input package first: the form is made from
    it" (seen by the request on GT-2027), and the step then shows a link, "Open Field activities",
    and says to press Input package there and come back (seen in the browser with that answer
    played back to the page). No test: one button on one screen.
  - *The weekly page's messages give the week as "22–26 November 2026"* (part of medium 1): the
    date outside the week, "Mark as sent", a week that overlaps another and an item dated in a
    week already sent. All four read in the browser or by the request.
  Found and left:
  - Dates and the UTC day: what is known is listed under medium 1 and 2 in the queue.
  - A weekly photo with no place gets none and the page is silent (medium 3, Needs Tucker U).
  - Needs Tucker U, V, W and the real phone test of a weekly photo.
  Checks: 1,166 tests pass (1,158 before), typecheck clean, lint clean, on the final code.
  The app was stopped by the sandbox for lack of memory while the tests and a walk ran together.
  It was started again and the walk finished. Distribution chain walked in the browser on the
  final code, on the local database made new at the start of this round, and this time through
  the send-back: a fictional KoboCollect record for F-0007, sent back by rahima with a reason,
  fixed and sent again by bilal, checked by rahima ("KoboCollect record checked by Rahima
  Stanikzai"), approved by nadia. The farmer moved to planting. The audit log shows each step in
  order, and that after bilal sent it again it waited for the check before going to nadia. The
  refusal before the check was seen on a second fictional record, for F-0008: for nadia the page
  said "Step 1 of 2: check the KoboCollect record", Approve could not be pressed, and the request
  itself was refused.
  `10-field-ledger.md` updated: the place on a weekly photo is read from the photo.
- **Round 4. 25 Nov 03:17 to 03:55. DONE.** Chain 1, results to report, walked in part. One big
  item found and fixed, a second written into the queue, four medium items fixed. The chain is not
  clear: what was not walked is listed under chain 1.
  Walked on a phone-sized screen with fictional data: `omar` accepted the 10 typed-in results and
  2 field forms. `nadia` opened Progress, the records behind a figure, the monthly review and the
  quarterly report. `marcus` released the report for October to December and made a share link. A
  donor with no account opened the link and the records behind a figure. The answer to the chain's
  question, as far as walked: from a figure on Progress, on the report and on the donor's link a
  person reaches each record, its date, its place and who accepted it. Staff reach the proof file.
  A donor is told a document is kept and sees captioned photos only, as designed.
  Out of order: the fixes were made as each thing was found. The queue was written at the
  close, not before the first fix as the page says.
  Decisions made alone, to check: a donor is told "1 PDF document" and no file name (Needs Tucker
  Z). An early release is warned about and not refused (Needs Tucker X). An old address is
  answered by the server, with no page of its own.
  Fixed:
  - *The donor's view counts the documents kept behind a record and never names them* (big, found
    in the walk). A share link and a donor's account listed each kept file by the name staff gave it
    and each link by its title: "Attendance sheet: F-0005, 2026-11-24 (sample).pdf". The demo's names
    hold a farmer number. A real one can hold a farmer's name. A donor may not see one. The
    server now sends "1 PDF document", "2 photos", "1 linked document" (`onFileKinds`,
    `src/lib/evidence.ts`, used in `src/server/share-store.ts`) and the names stay here. It holds
    for links already sent. Tests: `src/lib/__tests__/on-file.test.ts`, 3 tests.
    `src/server/__tests__/donor-view.db.test.ts`, 1 test added: nothing sent to a donor's account
    holds any kept file's name. Run in the browser as a donor with no account: "1 farmer · 24
    November 2026 · Village B. Accepted by MEL on 25 November 2026. Also on file with Roots of
    Peace, available on request: 1 PDF document." Not seen in the browser: the donor's own account
    page. It reads the same answer from the server, which the test covers.
  - *Two old addresses lead to their new pages again.* `/progress/preflight` and
    `/progress/records` showed "Application error" five times out of six, for any role. No screen
    links to them, so only a kept link or bookmark met it. Each is now answered by the server.
    Test: `src/server/__tests__/old-addresses.test.ts`, 3 tests. Run in the browser as nadia: each
    lands on its page, the report check on the right report, with no error. I could not tell
    whether the error also shows on the live site: this sandbox cannot build it.
  - *The quarterly report gives one blocking count.* As nadia the page said "Draft · 3 blocking"
    beside "Report check: 1 blocking" and "Blocks the report 1". It now says 1 in all three. Run in
    the browser. No test: one line on one screen. Release is still offered only when both the
    report's own checks and the Report check find nothing.
  - *A release before the period has ended is warned about.* The question now says "This period
    has not ended: it ends on 31 December 2026. A result accepted after today will not be in the
    report the donor receives." Read in the browser as marcus. No test: words in a question.
  - *Dates in words* (part of medium 1): the quarterly report's period, "It ends on", "Released 25
    November 2026 by Marcus Bell" and the line on a released copy, the Results page's "Showing"
    line, the annual report's period. A share link reads "made by Marcus Bell on 25 November 2026 ·
    works until 24 January 2027" (it said "made by marcus 2026-11-25"). The records behind a figure
    say "1 farmer", not "1 farmers". All read in the browser. Changed and not seen, because nothing
    in the demo shows them: the annual report's release line, the donor's annual report line and
    the evidence pack's line about the release. They passed the typecheck only.
  Found and left:
  - The donor evidence pack may name kept documents: big 1 in the queue, read in the code only.
  - The parts of chain 1 not walked: big 2 in the queue.
  - The report and Progress disagree about a target's status, the demo counts one farmer twice,
    "of 250" beside "of 20" and the "Activity 1.a: Activity 1.a" headings: medium 4 to 7.
  - Needs Tucker X, Y, Z.
  - Small, not queued: "0 women · 1 men", "1 farmers (1.2.1.1)" on Progress, "1 thing blocks the
    report. It cannot be released until they are fixed", "1 thing needs attention, 1 of them now".
  - The approval page tells the Director of MEL that the KoboCollect account bilal.kobo is not
    matched to a person. It comes from the record the test tool makes. Not looked into.
  Checks: 1,173 tests pass (1,166 before), typecheck clean, lint clean, on the final code (only
  this page and `tools/act.py` changed after). The app stopped twice. Once the sandbox stopped it
  for lack of memory during the walk. Once it was down after the tests. I did not see why:
  starting it again cleared its log. Distribution chain walked in the browser on the final code,
  on a local database made new for it: a fictional KoboCollect record for F-0007. For nadia the
  page said "Step 1 of 2: check the KoboCollect record" and neither Approve nor Send back could
  be pressed. rahima pressed "I have checked this record". nadia approved, the page said
  "Approved by Nadia Rahimi" and the farmer's record moved to planting. Not done this round: the
  request sent straight to the server before the check, which rounds 1 and 3 saw refused.
  `10-field-ledger.md` not changed: no field was added, cut or prefilled.
- **Round 5. 25 Nov 04:17 to 04:51. DONE.** Queue, big item 1 (the donor evidence pack), then more
  of chain 1. Two big items fixed, three written into the queue, four medium items fixed. The chain
  is not clear.
  Walked on a phone-sized screen with fictional data: `omar` accepted the results. `farida`
  recorded a result, `omar` sent it back with a question, `farida` corrected it and `omar` accepted
  it. `nadia` read the monthly review and `marcus` signed it off. `marcus` downloaded the evidence
  pack, the audit pack and the Word file. `elena`, the donor's own account, opened Home and a
  farmer's page. The findings were written into the queue before the fixes that followed them.
  Decisions made alone, to check: a donor's account is sent no picture of the signed goods
  received note and no photo's place (Needs Tucker AB). An account outside Roots of Peace cannot
  save field records, whatever its settings say. In the donor pack a photo is called "Photo 1.jpg"
  and a held file is a count. The reason no file is attached has names taken out, as the note has (typecheck only: no
  result in the demo has one).
  The monthly sign-off asks first and does not refuse an empty review (Needs Tucker AE).
  Fixed:
  - *The donor evidence pack counts the proof that is held and never names it* (was big item 1).
    Opened as `marcus`: index.csv gave each held document by the name staff typed, "Attendance
    sheet: F-0001, 2026-10-31 (sample).pdf", and each link by its title. The server now sends the
    donor pack "1 PDF document", "1 photo", "1 linked document" with the reason each is held. A
    photo that may go to a donor goes in as "Photo 1.jpg" with its caption. A link's address and a
    held photo's caption are no longer sent for the donor pack. The audit pack is as before.
    Tests: `src/lib/__tests__/on-file.test.ts`, 4 tests added (`donorPackProof`).
    `src/server/__tests__/evidence-pack.db.test.ts`, 2 tests: nothing in the donor pack's index
    holds a kept file's name, a link's title or address, and the audit pack holds them all.
    Run in the browser as `marcus` after adding two fictional photos and a link to one result:
    the donor zip held one file, "proof/2026-11-15 ecadb333 Photo 1.jpg", and its index read "1 PDF
    document", "1 photo", "1 linked document" with no name. The audit zip held all 23 proof files by name.
  - *The Word file* was looked at the same way and needed no change. Downloaded as `marcus` and
    searched inside: one cleared photo under its caption, no file name, no link title, no address.
  - *A donor's account is not sent the signed note's picture or where a photo was taken* (big,
    found in the walk). `elena` opened a farmer's page from her Home. The server hid the farmer's
    name and sent every photo as stored, the signed goods received note among them. The note is
    now listed with no picture and no photo carries its place, for any account outside Roots of
    Peace. Test: `src/server/__tests__/donor-field.db.test.ts`, 2 tests. Seen by the request: for
    `elena` 2 notes and 0 pictures, for `marcus` and `nadia` 2 pictures. A save sent as `elena` is
    refused (403). In the browser her farmer page lists the note with a drawn placeholder.
  - *A result sent back is pointed to* (medium). Home's row opened Results, which said "Nothing
    waiting for you". It now says first "MEL sent 1 of your results back with a question. It does
    not count until you answer." with a button, "Open 1.1.2.1 Farm visits completed", that opens the
    card and goes to the result. Run in the browser as `farida`. No test: one note on one screen.
  - *The answer to MEL's question shows* (medium). A corrected result came back to `omar` with a
    closed line "Corrected 1 time". He now reads "MEL asked: Which two farmers were visited?
    Answer: F-0003 and F-0004. The second sheet is added to the photo." and "The figure and the
    date were not changed". Run in the browser as `omar`. When the figure was changed the line
    gives the old one and the new one: that wording was not seen in the browser. No test.
  - *The monthly review asks before it locks* (medium). One tap signed off an empty review for
    good. The question now says "Sign off the review for November 2026? It cannot be changed after.
    Nothing is written in the summary and the needs-attention note." Run in the browser as `marcus`.
    Its dates are in words (part of medium 1), read in the browser. A person who can only read the
    review is told who writes it and who signs it. That line was not seen in the browser: both
    months in the local data were signed by then. It passed the typecheck only.
  - *A donor's account is not offered "Add photo"* on a farmer's page. The server refused it
    already. Not seen in the browser after the change: typecheck only.
  Found and left:
  - The place of a farmer's photo goes to staff who may not see participant names: big 1 in the
    queue. Started to read, not built: it needs the save path changed too and did not fit.
  - A signed monthly review keeps no copy of its figures: big 2, Needs Tucker AA.
  - The rest of chain 1: big 3.
  - Medium 8 to 11 in the queue. Needs Tucker AA to AE.
  - Small, not queued: the result form's own date and the rows under a target still read
    "2026-11-25 · 2026-Q4" (medium 1 lists them).
  Checks: 1,181 tests pass (1,173 before), typecheck clean, lint clean, on the final code (only
  this page and the tools changed after). The app started itself again at least once during the walk.
  Distribution chain walked on the final code after the tests: a fictional KoboCollect record for
  F-0007. For nadia the page said "Step 1 of 2: check the KoboCollect record" and neither Approve
  nor Send back could be pressed. The request sent straight to the server was refused: "Not
  approved yet: this record came from KoboCollect, and Rahima Stanikzai or Omar Sadiq checks
  KoboCollect data on this project before it is approved." rahima pressed "I have checked this
  record" and the page said "Checked." nadia approved, the page said "Approved by Nadia Rahimi"
  and the farmer's record moved to planting.
  Tools: `act.py` can fill in a form and `pack.py` reads a pack (see the notes above).
  `10-field-ledger.md` not changed: no field was added, cut or prefilled.
- **Round 6. 25 Nov 05:17 to 05:52. DONE.** Queue, big item 1 (the place of a farmer's photo), then
  big item 3, the rest of chain 1. Two big items fixed, four medium items fixed. Chain 1 is walked
  in full. Its one big item left waits for Tucker (AA), so the next round walks chain 2.
  Walked on a phone-sized screen with fictional data: `omar` accepted the results and `marcus`
  released the October to December report. `elena`, the donor's own account, opened her reports
  list, the released quarterly report and the records behind a figure. `nadia` read the annual
  report to its end and the monthly review. `omar` proposed a change to a target and `marcus`
  approved it. `marcus` released the annual report and `elena` opened it. The findings were
  written into the queue before the fixes that followed them, except the donor's annual table on
  a phone, which was seen and fixed after.
  Decisions made alone, to check: staff who may not see names are told a place is kept and never
  what it is (Needs Tucker AH). A place such a person sends for a photo already stored is not
  taken. The annual report waits only for quarters the project ran in, and an early release is
  asked about, not refused (Needs Tucker X). A report under way uses the monthly review's rule
  for a target's word (Needs Tucker AG). A change to the plan asks before it is applied.
  Fixed:
  - *Where a farmer's photo was taken is not sent to staff who may not see participant names*
    (was big item 1). `rahima`, `marcus`, `karim` and `yusuf` were sent every photo's place. They
    are now sent the photo with a mark that a place is kept, and the farmer's page still says
    "place recorded". A save from a page that never held the place keeps it as stored: a photo
    taken off is gone, a photo added keeps the place it came with and a place sent for a stored
    photo is not taken. Test: `src/server/__tests__/farmer-photo-place-hidden.db.test.ts`, 6
    tests: what the four are sent, what the field request answers, what people who may see names
    get, an unchanged save, a save that adds and removes photos and a save by someone who may see
    names. Four of the six fail on the code as it was. Seen by the request after `farida` added a
    fictional photo with a place: `farida` and `nadia` got the point, the four got none and the
    mark, `elena` got neither. Run in the browser as `rahima`, `nadia` and `elena` on the
    farmer's page: "place recorded" for the first two, nothing for the donor. Not run in the
    browser: the save, because nobody in the demo both saves a farmer and is kept from names.
  - *The annual report of a project's first year can be released* (big, found in the walk). The
    three quarters of 2026 before the project began blocked it for good. It now waits only for
    quarters the project ran in. Tests: `src/lib/__tests__/quarters-due.test.ts`, 4 tests.
    `src/server/__tests__/annual-first-year.db.test.ts`, 3 tests: nothing blocks on 20 November
    2026, the October to December report blocks on 1 February 2027 and no quarter from before the
    project is listed as lacking a report. Run in the browser as `marcus`: "Blocks the report 0",
    the question said "This period has not ended: it ends on 31 December 2026", the report was
    released and `elena` saw it in her list and opened it.
  - *A report under way and Progress give the same word for a target* (was medium 4). The
    quarterly report judged every target as if its quarter had ended. Test: one added in
    `src/lib/__tests__/qpr.test.ts`. Run in the browser as `nadia` on a database made new: the
    report says "On track" three times, "No data" and "Not started", the same as Progress.
  - *A donor's annual report names each figure on a phone* (medium, found in the walk). `elena`
    saw a target's name and "410" with no heading, and the rest off the side of the screen. Each
    figure now sits under its name, as on the staff page. Seen in a picture of the page. No test.
  - *The annual report names the quarters with no saved report* (medium 12). It said "none
    missing" above "No quarterly report text saved". It now says "No quarterly report is saved
    yet for October to December 2026", and only for quarters the project ran in. Read in the
    browser as `nadia`. Test: in `annual-first-year.db.test.ts`.
  - *A change to the plan asks before it is applied* (medium 13), and gives its dates in words
    (part of medium 14). Run in the browser: `omar` proposed 20 to 16, `marcus` read "Approve this
    change? ... The plan changes at once, for Progress and for every report not yet released. A
    report already released keeps what it said." and approved. Before the fix, the same change
    left the released report at 20, seen by the request as `elena`. No test: one question.
  Seen for the first time in the browser, no change needed: the donor's reports list and her
  released quarterly report ("1 PDF document", no file name), the annual report's release line,
  the donor's annual report line, and the line that tells a person who can only read the monthly
  review who writes it. Round 4 and 5 had passed these by the typecheck only.
  Found and left:
  - A signed monthly review keeps no copy of its figures: big 1, Needs Tucker AA.
  - Medium 14 to 18 in the queue. Needs Tucker AF, AG, AH.
  - Not walked in chain 1: listed under chain 1. Not seen: the evidence pack's line about a release.
  - Small, not queued: a budget line over its amount shows "LEFT -150" to a donor with no word.
  Checks: 1,195 tests pass (1,181 before), typecheck clean, lint clean, on the final code (only
  this page changed after). The app was stopped once on purpose, to make the database new. It
  was not seen to stop by itself. Distribution chain walked on the final code after
  the tests, on a local database made new during this round: a fictional KoboCollect record for
  F-0007. For nadia the page said "Step 1 of 2: check the KoboCollect record" and neither Approve
  nor Send back could be pressed. The request sent straight to the server was refused: "Not
  approved yet: this record came from KoboCollect, and Rahima Stanikzai or Omar Sadiq checks
  KoboCollect data on this project before it is approved." rahima saw the signed note and no
  point, pressed "I have checked this record" and the page said "Checked." nadia approved, the
  page said "Approved by Nadia Rahimi" and the farmer's record moved to planting.
  `10-field-ledger.md` not changed: no field was added, cut or prefilled.
- **Round 7. 25 Nov 06:16 to 06:56. DONE.** The last round of the night. Chain 2, purchase to
  payment, walked in part. Two big items found and fixed, a third written for Tucker (AI), three
  medium items fixed. The chain is not clear: what was not walked is listed under chain 2.
  Walked on a phone-sized screen with fictional data: `nadia` filled in and submitted the request
  for soil test kits (PR-2027-016), `karim` approved it and `zahra` chose the request for
  quotation. `nadia` opened "Receive and inspect" and `yusuf` opened "Check the payment". `yusuf`
  recorded a bill, `karim` sent it back, `yusuf` recorded it again and `karim` approved it.
  `zahra` opened the procurement calendar and `yusuf` opened "Record a payment". The server's
  rules for a purchase (`procurement-guard.ts`) and for a bill were read in full: nobody approves
  their own request or their own bill and no way round either was found. The findings were
  written into the queue before the fixes, except the demo's invoice (medium 25), seen and fixed after.
  Decisions made alone, to check: a bill sent back is never changed and the corrected bill is a
  new one with a new number (Needs Tucker AK). A new bill starts as the project on the screen
  (Needs Tucker AJ). The approver's Home row for bills is marked "Now", as a purchase approval is.
  A paid purchase does not post to the books and no round builds it (Needs Tucker AI).
  Fixed:
  - *A bill sent back can be corrected and recorded again* (big, found in the walk). The person
    who records bills read "Sent back" and nothing else and had to type the bill again. The bill
    now says "Karim Ahmadi sent this bill back on 25 November 2026: ..." and what happens next,
    with a button, "Correct it and record it again". The form opens with everything that was
    recorded and the same document. Recording it makes a new bill and the first one says "It was
    corrected and recorded again as BL-002". The new bill carries no warning of a second payment.
    A bill that was not sent back and is recorded twice still does. People who cannot record
    bills read "Finance corrects it and records it again."
    Run in the browser as `yusuf` and `karim`: sent back, corrected (kind, project and budget
    line changed), recorded again, approved. The form's heading and the reason were seen on the
    phone screen, clear of the top bar.
  - *Home tells the people a bill waits on* (big, found in the walk). The approver's Home now has
    "Approve the bill from Kabul Net (fictional)" and Finance's has "Correct the bill from Kabul
    Net (fictional) that was sent back and record it again". Each opens Bills. The person who
    recorded a bill is not asked to approve it. Run in the browser as `karim` and `yusuf`: both
    rows seen and pressed.
    Test for both: `src/server/__tests__/bill-sent-back.db.test.ts`, 8 tests, through the bills
    request and Home: the approver's row, the row for a bill sent back, who may record again,
    the new bill with no warning and the first one closed, the warning kept for a true second
    recording and the rule that finds the bill that replaced one sent back.
  - *A bill recorded on a project's page starts as that project's* (medium 19) and under Record
    the form says "Still needed: ..." until it can be pressed. Record waits for the budget line
    where the project has lines. Run in the browser as `yusuf`: the form opened on A-2027, said
    "Still needed: the budget line" and the bill was saved on line 5.2. No test: one form.
  - *Home asks for a report's release only for a quarter the project ran in* (medium 20). Test:
    one added in `src/server/__tests__/annual-first-year.db.test.ts`. It fails on the code as it
    was. Seen in the browser as `karim` on a database made new: the row is gone.
  - *The demo's payment check has its invoice* (medium 25). Seen in the browser as `yusuf` on a
    database made new: "Invoice FT-0118 (fictional) of 2026-11-18" and the match is ticked by the
    app. The out-of-date screening and the open issue still hold the step, as the demo means them to.
  Found and left:
  - A paid purchase or a filed bill does not reach the books: big 4, Needs Tucker AI.
  - Medium 21 to 24, 26 and 27 in the queue. Needs Tucker AI, AJ, AK.
  - Most of chain 2 is not walked: the list is under chain 2. Chains 3 to 6 are not started.
  - Not seen in the browser: the line for people who cannot record bills and the Home rows for
    more than one bill. Typecheck and the test only.
  Checks: 1,204 tests pass (1,195 before), typecheck clean, lint clean, on the final code (only
  this page changed after). The app started itself again twice during the walk. Distribution
  chain walked on the final code after the tests, on a local database made new for it: a
  fictional KoboCollect record for F-0007. For nadia the page said "Step 1 of 2: check the
  KoboCollect record" and neither Approve nor Send back could be pressed. The request sent
  straight to the server was refused: "Not approved yet: this record came from KoboCollect, and
  Rahima Stanikzai or Omar Sadiq checks KoboCollect data on this project before it is approved."
  rahima saw the signed note and no point, pressed "I have checked this record" and the page
  said "Checked." nadia approved, the page said "Approved by Nadia Rahimi" and the farmer's
  record moved to planting.
  `10-field-ledger.md` not changed: it lists the fields of the distribution chain and a bill is
  not in it. A bill's fields are now filled in for the person in two places, both said above.
- **Item AA. 25 Nov 09:00. IN PROGRESS.** One decided item, not the queue. Tucker's decision, 25
  Nov 08:53: signing a monthly review keeps that day's figures. A signed review shows what was
  signed, not today's numbers. No migration: the figures go in storage the app already has.
