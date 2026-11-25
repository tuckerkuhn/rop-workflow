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

## Chains to walk, in order

Each chain: list every field each role is asked for, where it could come from instead and where it
is used next. Then walk it as each role on a phone. The distribution chain is done (`10-field-ledger.md`).

1. **Results to report.** Field forms accepted, results accepted by MEL, Progress, monthly review,
   quarterly report, the donor's view. As `omar`, `nadia`, `marcus`, a donor. Can an auditor get from
   any number in the report to the record and the photo that prove it?
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
1. The app makes only the distribution form. Readiness, training and visit forms are hand-built
   files a small organization cannot get. Same approach as `src/lib/distribution-form.ts`. The
   training form's questions are settled since round 1 (`kobo/build_field_forms.py`). (Chain 4.)
2. Weekly update photos keep their date but not their place. The place must stay with people who
   may see participant names on every screen that reads weekly items, and survive an edit.

Medium, open:
1. Dates still show as 2026-11-24 on most screens outside the approval page and the review queue.
   Use `longDate` from `src/lib/weekly.ts` where a person reads a date in a sentence.
2. Some days are cut from a UTC timestamp and show tomorrow's date in the evening in Guatemala.
3. The storekeeper's Home has no row for a distribution sent back by the checker until the list reloads: check.
4. `Six commits` and other counts in `11-handoffs-review.md` drift. Keep that page's facts true.
5. In the review queue on a phone, Accept pressed just after "See the photo and where it was
   recorded" can do nothing: no request is sent and no message shows. Seen twice in round 1, each
   time on the first open of a new record's photo, and it worked on the next try. The likely cause is
   the row growing while the photo loads. Hold the photo's space before it loads, then check.

Done: see `11-handoffs-review.md` and `10-field-ledger.md`. Round 1: training attendance is one record
per session with its farmers ticked (was big item 1).

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
