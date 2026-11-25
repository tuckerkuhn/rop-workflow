# Rounds: tightening the app until nothing big is left

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

## Chains to walk, in order

Each chain: list every field each role is asked for, where it could come from instead and where it
is used next. Then walk it as each role on a phone. The distribution chain is done (`10-field-ledger.md`).

1. **Results to report.** Field forms accepted, results accepted by MEL, Progress, monthly review,
   quarterly report, the donor's view. As `omar`, `nadia`, `marcus`, a donor. Can an auditor get from
   any number in the report to the record and the photo that prove it?
   *Round 4 walked it in part and it is not clear.* Walked: accepting typed-in results and field
   forms as `omar`, Progress and the records behind a figure as `nadia`, the quarterly report and
   its release as `marcus`, a share link as a donor with no account. Not walked: the donor's own
   account (`elena`), signing off the monthly review, the Word file, the evidence pack and the
   audit pack, a result sent back with a question, the annual report past its heading. The next
   round takes the queue's big item first, then these.
2. **Purchase to payment.** Procurement calendar, purchase request, quotations, approval, goods
   received note, bill, payment, budget line. As the requester, `zahra`, `karim`, `yusuf`.
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
1. **A donor's account is sent the photo of the signed goods received note and where each farmer
   photo was taken.** Found in round 5 as `elena`. Her Home lists "Recent field photos" and opens a
   farmer's page. The server (`loadField` in `src/server/field-store.ts`) hides the farmer's name and
   sends every photo as stored: the signed note, which has the farmer's name and signature on it,
   and each photo's place (`gps`). The distribution page gives the note to staff only.
2. **The place of a farmer's photo also goes to staff who may not see participant names**
   (`marcus`, `karim`, `rahima`, `yusuf`). Same cause as item 1. Read in the code in round 5, not
   fixed: these people can be given the right to save a farmer, and a save from a page that never
   held the place would wipe it. The fix has two halves: leave `gps` out in `loadField` for them and
   put it back by photo id in `keepHidden`, with a test like `field-names-hidden.db.test.ts`.
3. **A signed-off monthly review keeps no copy of its figures.** Found in round 5. The review for
   October, opened on 25 November, shows 11 farmers trained: the year's figure as it stands today,
   under "to the end of 2026 Q4". One training was held by 31 October. Signing off stores the name
   and the time only (`readReview` in `src/server/monthly-review-store.ts`), so the signed October
   review will show December's figures in January. Keeping the figures at sign-off is the fix. It
   changes what sign-off means: Needs Tucker AA.
4. **Finish chain 1.** Still not walked: the donor's own account past Home and one farmer page
   (her reports list and a released report), the annual report past its heading, and the monthly
   review's "Changes to the plan".

Medium, open:
1. Dates still show as 2026-11-24 in some places. Use `longDate` or `periodLabel` from
   `src/lib/weekly.ts` where a person reads a date in a sentence. Done in rounds 3 and 4: the weekly
   page's messages, the quarterly report page, the annual report's heading and release line, the
   Results page's "Showing" line, a share link's line, the records a donor opens. Left: Home's row
   "Last week's weekly update (2026-11-15 to 2026-11-19) is not marked sent" (`src/server/preflight.ts`;
   its words are in four languages in `src/lib/i18n/preflight*.ts`, so the dates go in as the words
   `{from}` and `{to}`), the monthly review ("to 2026-10") and the rows of the review queue on
   Results ("2026-11-25 · 2026-Q4 · Village B").
2. Some days are cut from a UTC timestamp and show tomorrow's date in the evening in Guatemala.
   Seen in round 3 on the weekly page: "today" is the server's UTC day (`weeklyView` in
   `src/server/weekly-store.ts`), so after six in the evening in Guatemala an item can be dated
   tomorrow, and "Sent by Omar Sadiq on 25 November 2026" is the UTC day it was sent. The same
   holds for "Released 25 November 2026" on a report and for the day a share link was made.
3. A weekly photo added before round 3, or one whose phone removed the place, has no place and the
   weekly page says nothing about it. The farmer page offers "use this device's location" for such
   a photo. The weekly page does not (Needs Tucker U).
4. The report and Progress disagree about the same figure. On 25 November, with 11 of 20 farmers
   trained and the work planned for Q4, Progress and the monthly review say "On track". The
   quarterly report and the donor's view say "Behind · delayed", for every target. Find which is
   right while the quarter is under way (`targetStatus` in `src/lib/target-status.ts` and what
   Progress uses) and make them agree.
5. The demo counts one farmer twice. F-0005's training on 20 and on 24 November are two typed-in
   results, both listed as clean. The field forms queue flags the second as "Possible duplicate of
   KB-101". After "Accept 10" the demo says 11 farmers trained. A typed-in result holds a count
   and no farmer number, so the app cannot see this itself: it is the sample data
   (`demoResults` in `src/lib/demo-design.ts`), which makes a result from a record the checker flags.
6. A target card on Results says "8 of 250 farmers" and Progress says "8" of "20". One is the
   whole project and one is this year. Neither says so.
7. The report's narrative has headings "Activity 1.a: Activity 1.a" and "Activity IND: Activity
   IND" for targets that sit under no activity.
8. A result sent back with a question is hard to find. Home's row "Fix 1 result MEL sent back with
   a question" opens Results, which says "Nothing waiting for you" at the top. Lower down it says
   "Of yours queried: answer them below 1" above five closed target cards. None is marked.
9. The answer to MEL's question is hidden. When the recorder corrects a result, it comes back to
   the MEL officer with a closed line "Corrected 1 time". The answer and the old figure are inside.
10. The monthly review is signed off in one tap, with no question, even with the summary and
    "Needs attention" empty. It cannot be changed after.
11. The monthly review tells a person who can only read it nothing about who writes it or who
    signs it off (`nadia`, the project manager, in the demo).
12. The monthly review's dates: "Sign off the 2026-10 review", "Signed off by Marcus Bell on
    2026-11-25", "to 2026-10". Part of medium 1.
13. Home for the extension agent says "IND-5 (Change in net farm income) has a target but no result
    recorded in the period". IND-5 is the app's own code. The donor's code or the name alone would do.
14. The result form lists Afghan provinces (Kandahar, Helmand) for every project. The demo's
    Village B has none to pick.
15. A donor's Home asks the server for KoboToolbox settings and field forms and is refused three
    times (403). Nothing shows on the page. It is wasted work on a slow line.

Done: see `11-handoffs-review.md` and `10-field-ledger.md`. Round 1: training attendance is one record
per session with its farmers ticked (was big item 1). Round 2: the app makes the readiness, training
and farm visit forms (was big item 1), Accept stays put while a photo loads (was medium 5), the
counts in `11-handoffs-review.md` are dated (was medium 4). Round 3: weekly update photos keep their
place for people who may see participant names (was big item 1), Home is read again when a person
comes back to it (was medium 3), Setup offers the distribution form beside the other three (was medium 4).
Round 4: the donor's view counts kept documents and never names them (big, found in the walk), the two
old addresses work, the quarterly report gives one blocking count and warns before an early release.

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
- **Y. A report can be released with nothing written.** In the local test the report went out with
  all 15 sections "Not written yet". Empty sections are listed as worth fixing and do not block.
  Say if an empty Executive Summary should block the release.
- **Z. What a donor is told about a kept document.** Before round 4 a share link and a donor's
  account listed each file by its name ("Attendance sheet: F-0005, 2026-11-24.pdf"). A name typed
  by staff can hold a farmer's name, so the donor now reads "1 PDF document". This holds for links
  already sent. If a donor must be able to ask for one document by a reference, that reference
  would be a new thing. Say if you want it.

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
- **Round 5. 25 Nov 04:17. IN PROGRESS.** Queue, big item 1 (the donor evidence pack), then the
  parts of chain 1 not walked.
