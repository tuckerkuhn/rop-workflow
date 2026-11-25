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
1. Training attendance is one record per farmer per session. The right shape is one record per
   session with the farmers ticked. Changes the form (`kobo/build_field_forms.py`) and what happens
   when MEL accepts it (`src/server/review.ts`). Design it in the log first; build it only if it
   needs no migration and the old records keep working. (Chain 4.)
2. The app makes only the distribution form. Readiness, training and visit forms are hand-built
   files a small organization cannot get. Same approach as `src/lib/distribution-form.ts`. (Chain 4.)
3. Weekly update photos keep their date but not their place. The place must stay with people who
   may see participant names on every screen that reads weekly items, and survive an edit.

Medium, open:
1. Dates still show as 2026-11-24 on most screens outside the approval page and the review queue.
   Use `longDate` from `src/lib/weekly.ts` where a person reads a date in a sentence.
2. Some days are cut from a UTC timestamp and show tomorrow's date in the evening in Guatemala.
3. The storekeeper's Home has no row for a distribution sent back by the checker until the list reloads: check.
4. `Six commits` and other counts in `11-handoffs-review.md` drift. Keep that page's facts true.

Done: see `11-handoffs-review.md` and `10-field-ledger.md`.

## Needs Tucker

Decisions A to N are in `11-handoffs-review.md`. Rounds add theirs here, lettered from O.

- **The real phone test.** No round can do it. The form "SANDBOX ROP Input distribution" is deployed
  in his KoboToolbox account. The steps are at the end of `11-handoffs-review.md`.

## Log

Newest last. One entry per round: started, status, chain or item, fixed (with test or browser),
found and left, tests passing.

- **Round 0. 24 Nov 22:26 to 25 Nov 00:20. DONE.** The distribution chain, three passes in one
  session with Tucker. Proof reaches checker and approver, where and when read from phone and
  photo, the app makes the distribution form, visitors can add photos, three holes closed.
  1,138 tests pass. Detail in `11-handoffs-review.md`.
