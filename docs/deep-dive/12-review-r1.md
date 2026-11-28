# Review round 1: progress and decisions (started 27 Nov 2026)

## Where it stands (27 Nov, evening session, following `docs/CURSOR-PROMPT-2026-11-27.md`)

- **Landed** (branches `build/ai-fault-2026-11-27`, then `build/review-r1-part1-2026-11-27`, cut from
  `build/review-r1-next-2026-11-27`; not on main):
  - Part 0 step 1, `afcf133`: a wrong key (401) and a key that may not use the model (403) now get
    two sentences. The AI service's own status and message are kept on the `ai_run_failed` audit
    row (anything shaped like a key is taken out) and listed on Settings, Health under "Errors this week".
  - ISS-18, `7abd1c4`: Field activities flags, on the queue and on a farmer at Train or the
    hand-out, that no selection rule is saved. A flag, not a block.
  - ISS-20, `8ed37ec` and `f08b011`: one next report (`lib/progress` `nextReportDue`) for the
    donor's Home, Project settings and Progress, named by its months.
  - ISS-12 gap, `1a2159a`: an administrator names who receives the goods on the same panel when
    the requester is away (`lib/procurement` `mayNameReceiver`, read by the screen and the save).
  - Part 2 step 1, `046b4a7` (branch `build/field-forms-2026-11-27`, cut from part1): the five
    field forms filled in inside the app at `/field/forms/<kind>`, opened from "Fill in a form" on
    Field activities. One screen reads every form from the KoboCollect form definitions
    (`lib/app-forms`, rules in `lib/form-expr`, checked again on the server). A saved form is the
    same `evidence` record a KoboCollect submission was (source "manual", key `_rop_app_form`; no
    migration), so the review queue, Field activities and the distribution approval read it
    unchanged (`lib/form-record` `hasAnswers`). Register a farmer goes through `importFarmers`.
    Photos are made smaller on the phone and kept, with their fingerprint, inside the record for
    now: step 4 moves them to file storage.
  - Part 2 step 2, branch `build/field-rules-2026-11-28` (cut from field-forms), one commit each:
    - MF-07 `ed0db5b`: household roster (sex and age per person, no names) on the register form
      and the farmer list ("Female 34, Male 12"); the size is the roster's length; the profile
      counts women, men, girls and boys (`lib/household`).
    - MF-08 `c5251bc`: duplicate check at registration and list loading (`lib/duplicates`): the
      same ID is refused as before; the same phone, or a name spelt another way in the same
      village, asks "I checked: this is a different person". Warnings name farmer IDs only. Phone
      is asked only of people who may see names, and kept with the name.
    - MF-12 `da800c7` (D-21, D-22): eligibility rules as fields in Farmer selection (land size,
      villages, crops grown, contribution % with a women's %), saved as selection rules with
      their words written from the numbers (`lib/eligibility`). Each farmer's record is checked
      against them; a rule the record fails cannot be ticked. Crops grown is a new farmer field.
    - MF-09 `e48dbba`: curriculum and version set in Set up and carried on every training record;
      pre and post test scores per farmer on the in-app training form, kept on the farmer's record
      when MEL accepts (`lib/field-training`).
    - ISS-14 `8c2cb79`: before approving, the project manager types the receipt's date, whether
      it names the farmer, and each quantity; any difference is listed (also under "To look at")
      and blocks approval (`lib/receipt-check`). The check is kept on the record.
    - ISS-15 `304e626`: one wording for every source, "Recorded in the app by <name>" or "Sent
      from KoboCollect by <name>" (`lib/form-record` `sourceText`); the queue heading is "Field forms".
    - ISS-27 `e61b005`: the farmer's signed receipt is a "distribution receipt" everywhere;
      "goods received note" is left only for the supplier's delivery.
    - Packages `d561bf8` (Tucker's answer 2b): Set up may list packages farmers choose from (a
      name, who it is for, which items). Each farmer records one at registration or on the farmer
      list; planned amounts, stock checks and the distribution form follow it (an item outside the
      farmer's package is not asked). No package set up: unchanged, every farmer gets every item.
    - Rules per package `a607f13`: each checked eligibility rule is for all farmers or for one
      package, and binds only the farmers who chose it; the contribution is worked out on the
      farmer's own package.
    - Screen fixes `d2cb9a9`: one "(optional)" per label, a household member on one line at
      380px, receipt mismatches under "To look at".
  - Part 2 step 3, `27f0e1e` and `87ff071`: a field form filled in inside the app is field data,
    so the project's named approver checks it before it flows on, exactly as a KoboCollect form
    (`lib/kobo-approval` `fieldRec`); nobody approves what they collected, and with one approver it
    goes to the person they report to. Tested: an in-app distribution needs its signed receipt and
    photo. A visitor's photo was already marked as such and is never proof (unchanged, tested).
  - Part 2 step 4, `6c660b9` (branch `build/photo-storage-2026-11-28`): proof photos can be kept in
    Supabase Storage (its free plan includes file storage), with only the fingerprint in the
    record, checked again each time a photo is read (`server/file-store`). Off by default
    (`PROOF_FILE_STORE=inline`): nothing changes on the live site until it is switched on.
    `8dfcbf3`: `npm run photos:move` counts the photos still inside records and, with `--apply`,
    moves them, keeping each fingerprint; refused while file storage is off.
  - Part 2 step 5, `45903ba` (branch `build/offline-2026-11-28`): field forms open with no signal
    (from the copy kept on the phone when last opened with signal) and save into the phone's
    outbox, which already served weekly items; the bar at the top counts what waits; sent by
    itself when signal returns; one record however often it arrives. A server that is down is now
    retried instead of marked refused (`lib/outbox` `replyMeans`). Seen on the local copy: a
    farmer registered with no signal, kept, then sent once when signal came back.
  - Part 2 step 6, `aca8bea`: `docs/deep-dive/13-offline-phone-test.md`, the checklist for Tucker's
    phone. Until it passes the forms say to save with signal (`OFFLINE_PHONE_TEST_PASSED`).
  - Part 2 step 7, Kobo out (branch `build/kobo-out-2026-11-28`; merge only after the phone test
    passes): `c96ee24` and `2b1b4e9` the KoboToolbox routes, sync, webhook, nightly check, CLI,
    setup steps and `kobo/` builders removed, setup now ends "Who checks field data?"; `8cf77da`
    nothing reads the three Kobo tables (targets take results in the app; Home and Health lose
    their Kobo rows; a photo left in KoboToolbox says where it is); `5e23017` and `3c30e30` the
    screens and words (Progress sync, the queue's sync and farmer-list buttons, "+ New" now "Fill
    in a field form", the Kobo-only Home, the phone form download, `KOBO_TOKEN_KEY`); `317f385` the
    migration dropping the three tables and two unused columns, written in
    `docs/deep-dive/migrations-pending/` and NOT run. Old KoboCollect records stay readable.
    Seen on the local copy: Results and the review queue with no Kobo wording, "+ New" with
    "Fill in a field form".
  - Part 3, branch `build/part3-2026-11-28` (cut from kobo-out):
    - MF-01 `d808651` backup approvers: Settings, You, "Time away": the days and who acts. For those
      days the delegate holds the away person's approval roles, on the server and on screen
      (`lib/delegation`, applied once in the people list and the authority table), and what they
      approve says "X on behalf of Y" (distributions, field records). With nobody named, the line
      manager steps in after 3 days (an organization setting). Administrator rights are never
      passed on. Seen on the local copy as Nadia. Procurement signatures carry the delegate's own
      name for now (the authority table already lets them sign); "on behalf of" there is next.
    - MF-03 `90ff49d` staff screening (D-23, D-05): HR records each sanctions check (date, lists,
      result, printout link) in the HR record; a hire cannot be signed until the finalist has a
      clear screening from the last 12 months; a possible match waits for a person's review; HR's
      Home has a "Sanctions screening" tile listing staff not screened within the year.
    - MF-04 `46501e0` farmer screening above $50: a package worth more than the limit (a project
      setting, `screenAboveUsd`, $50 by default) is not approved until someone who may see the
      farmer's name records a clear check on the farmer's page; a possible match waits for review.
      The approval screen says what it waits for. Every demo package is about $207, so each demo
      farmer at "distribute" now needs a screening before approval.
    - MF-11 `11b966f` local currency: finance records each month's AFN and GTQ rate with its
      source (Organization settings, Exchange rates; `lib/fx`). Money shown in afghanis or
      quetzales, bills, the procurement plan's conversions and payments (the ledger's rate when
      none is typed) use the rate for their month; Guatemala projects get a USD/Q switch once a
      quetzal rate exists. Without a month's rate the afghani falls back to 70 and says so; the
      quetzal has none, so nothing converts until finance enters one. Not reworked yet: older
      finance screens that store USD only (budget lines, month close) still show dollars.
    - MF-02 `e138897` advances (Q3 audit finding 1, D-04): `/advances` (linked from Home's own
      list). Ask; the supervisor approves; Finance pays the holder only (paid to anyone else is
      refused); its age and settle-by date run from payment, the days from the project's rule
      (`advanceSettlementDays`: 15 on UN-funded projects, 30 otherwise); settled with receipts;
      Finance accepts or sends back; what was not spent is returned or recorded as recovered from
      pay. One open advance per person. All in the HR ledger (`lib/advance`). Seen on the local copy.
    - MF-06 `46260a1` payment accounts register (Q3 audit finding 2): Organization settings,
      Payment accounts. Each bank, mobile money or cash account: owner (only the organization's
      own name; a person's name is refused), type, provider, last four digits, signatories. Adding
      or changing one takes effect only when a second person confirms. Each payment says when it
      was paid from cash or from an account not in the register (a flag, not a block).
    - ISS-23/24/25 `42fd5d8`: month close asks for an outside posting reference only when the
      organization names an accounting system (else the app's own books are the books); a link
      to each filed voucher is optional unless the organization ticks "Month close needs a link"
      (Organization settings, Where files are kept); a weekly export runs every Sunday 04:00 UTC
      (`/api/cron/records-export`, kept in file storage when it is on, else Health says it was not
      kept), and Settings, Health asks an administrator to confirm the backup plan every 90 days.
    - MF-10 `30f24de` verification (D-26): "Accept all" on Results opens only after a random sample
      of the batch (10%, one to five) has been opened and ticked; for typed-in results the server
      checks it too. Each month MEL or the project manager draws a repeatable random 3% (a project
      setting, 2 to 5%) of farmers for a visit by someone who did not collect their records; the
      visit is recorded as matching or not, and the share visited shows month by month (Results).
      Field forms accepted at once are gated on the screen only: they are accepted one by one on
      the server.
    - MF-05 `6ea89b9` recruitment (D-16 to D-18), kept light: `/recruitment` (linked from HR's
      Home). A vacancy open at least 14 days with a panel of 3 or 4 at or above its grade (a new
      optional "Grade" on the HR record) and no HR on it; every application declares any relation
      to staff; every CV graded; 3 to 5 shortlisted after the closing date; the panel scores;
      references after the interviews, finalists only; a selection memo with the reason when the
      chosen person is not the top score; then the hire goes through the HR record's approval by
      grade and onboarding, as before. Each rule held by the ledger fold (`lib/recruitment`).
    - MF-13 (in-app forms for registration and distribution, from the review sheet) is Part 2 step 1.
    - Part 3 is complete. Left from MF-01: procurement signatures still carry the delegate's own
      name, without "on behalf of".
- **Tests:** 199 files, 1,419 tests, all passing (39 tests of removed Kobo features went with them). Typecheck and lint clean.
- **Seen on screen** (desktop, local throwaway database, never Supabase): the ISS-18 flag as Nadia
  (queue and record), ISS-20 on Project settings and the donor view, ISS-12 as Daniel. Part 2
  step 1: as Farida, a readiness check filled in (the "what needs fixing" question appears on No,
  missing answers are refused and named, a photo taken and previewed), saved, then accepted by
  Omar in the review queue, which moved the farmer to distribution. As Daniel, only "Register a
  farmer" shows. Not yet seen: the distribution, training, farm visit and register forms on screen
  (covered by tests), and a phone's real GPS.
  Part 2 step 2 (28 Nov): the register form at 380px (inside a 380px frame, since the window
  would not narrow) as Farida, with the household roster; the receipt check as Nadia at desktop
  width, with a receipt dated 2027-02-27 and a wrong seed amount both flagged and Approve held.
  Farmer selection's rule fields and the per-package buttons as Nadia (two fictional packages
  added to the local copy). Not seen yet: the package editor in Set up, the training scores and
  the duplicate warning on screen (each covered by tests). Farmers already loaded have no
  package: they are planned with every item until one is recorded.
  **Not seen:** 380px for the other screens, Settings Health's AI lines
  (no AI failure on the local copy), Progress's own next-report line, and the eleven screens listed under "Open".
- **How the screens were looked at:** a local PGlite Postgres served on 127.0.0.1:54329 (script in
  the session scratchpad: migrations applied, `src/db/seed.ts` run with only local variables) and
  `next dev -p 3100` started with DATABASE_URL and every outside key overridden. An old dev server
  started 12 Nov was still running against Supabase from `.env.local`; it was stopped.
- **Needs Tucker:**
  1. Done 28 Nov: the AI key replaced and checked on the live site (a draft arrived as Hamid).
  2. "Change the model in Settings" in the prompt: there is no model setting yet (`DRAFT_MODEL` is
     fixed). Add one as an organization setting? Easiest to undo: leave it fixed until a 403 shows.
  3. Part 2 step 7 asks for a migration that drops the Kobo tables; your standing rule is no
     migrations. The plan: stop reading and writing them, leave the tables, and ask before dropping.
  4. Answered 28 Nov: the project manager, plan approvers and extension agents register farmers (1a).
  5. Answered 28 Nov: an in-app distribution goes straight to the project manager, with no extra
     KoboCollect check (2a).
  6. Answered 28 Nov: a receipt that does not match the record blocks approval (1a).
  7. Answered 28 Nov: rules per package (2b). A project may offer several packages for farmers to
     choose from, for example by climate risk.
  8. Switch photos to file storage? Set `PROOF_FILE_STORE=supabase` in Vercel and redeploy; the
     bucket is made on first use. Until then photos stay in the database (about 1,000 fit).
  9. The phone test (`13-offline-phone-test.md`), on a real Android. Removing Kobo (step 7) is
     built on its own branch and should be merged only after it passes.
  10. Run the Kobo drop migration (`migrations-pending/0029_drop_kobo.sql`)? It breaks the no-migration
     rule, so it waits for your OK. Until then the empty tables do no harm.
  11. Targets that were counted from a KoboToolbox question (none on the demo project) now show "Not
     counted from any data yet" until switched to "results recorded in the app" in Set up.
  14. MF-04: the demo package (~$207) is above $50, so every demo distribution now waits for a
     farmer screening. Keep $50, or raise the limit for this project in Set up?
  15. MF-11: enter November's afghani and quetzal rates (Organization settings, Exchange rates),
     with the source you want used (for example the central bank's rate on the first working day).
  16. MF-02: D-04 says Guatemala follows its travel policy for settling advances. The app uses each
     project's rule (30 days unless set); enter Guatemala's number in its project rules.
  17. MF-06: a payment from an account not yet in the register is flagged, not refused. Make it a
     block once the accounts are entered?
  18. ISS-24: links to filed vouchers are now optional at month close by default (the review's
     direction). The demo organization names NetSuite, so its month close still asks for the
     NetSuite reference. Confirm the backup plan on Settings, Health once file storage is on.
  19. MF-05: staff grades are not in the HR record yet. Record each person's grade (HR record, Job)
     before a panel can sit; a panel member without one is refused.
  13. MF-01: D-13 says the board approves the authority table as the written delegation. That is
     a board step, not the app's: the app only lets a delegate act within the table.
  12. The Dari, Pashto and Spanish wording files still carry some old Kobo sentences that no screen
     shows; the new sentences are English only until translated.
- **Half done:** step 4: photos already in the database stay there until a move script runs (to
  write); a donor's share link does not yet show a photo kept in file storage. Kobo still works
  beside the in-app forms until step 7.
- **Next:** Part 2 step 3, the rules that carry over (nobody approves data they collected; the named
  MEL approver checks field data before it flows on; every distribution needs its signed receipt
  and photo; a visitor's photo is a picture of the work, not proof), then steps 4 to 7.

Source: `ROP_Workflow_Review_Round_1.xlsx` (30 issues, 28 decisions, 13 missing features),
reviewed 26 Nov 2026 for Daniel Sandoval and Tucker Kuhn. Branch:
`build/review-r1-critical-2026-11-27`. Nothing here is pushed until Tucker says "save".

**Anyone picking this up (a person, another model, a later session): start at "Next", below.**

## The 12-hour push (Tucker, 28 Nov, from about 17:40 UTC to 05:40 UTC on 29 Nov)

Tucker asked for one long session, then a review of the changes and decision points together.
Part 0 is closed: the new AI key works on the live site (a draft arrived on PR-2026-001 as Hamid,
AI runs 2 to 3, no new error).

**Order of work.** One branch per part, cut from the one before; commit per fix with its number;
a test before each commit; typecheck, lint and tests before each commit; screens looked at on the
local copy only (desktop, and 380px inside a 380px frame).
1. Part 2 step 3, the rest: a visitor's photo is a picture of the work, not proof (check and test);
   every distribution needs its receipt and photo (already enforced: add the test that proves it
   for in-app records).
2. Part 2 step 4: photos out of the database into file storage, with a fingerprint kept, no paid
   service. Built behind a setting with the database as the default, so nothing changes on the
   live site until Tucker switches it on.
3. Part 2 step 5: offline. Forms open and save with no signal, kept on the phone until the server
   confirms, a count of what waits, never sent twice.
4. Part 2 step 6: the phone checklist for Tucker (written, not run).
5. Part 2 step 7: Kobo out of the screens, the sync, the nightly job and the words. The migration
   that drops the tables is written and NOT run (needs Tucker's "save" and his OK on the rule).
6. Part 3 in the prompt's order: MF-01, 03, 04, 11, 02, 06, ISS-23/24/25, MF-10, MF-05.
7. Part 4: database connections (code side only), then the role-by-role pass for a round 2 list.

**Never, during the push.** Nothing pushed or merged to main. No change to the live site or
Supabase, no migration run, no outside account touched, nothing saved in the live app. Real names
and emails stay out. A question for Tucker gets the choice easiest to undo, built as a setting
with a default, and goes under "Needs Tucker" with the choice made.

**Where to read the result.** The top of this file, kept true as each piece lands, and one list
of decision points at the end of the push.

## Direction set by Tucker, 27 Nov

- **KoboToolbox comes out completely.** The only app a user touches is this one; every
  integration is on the back end. Field data is captured in in-app forms (register a farmer,
  readiness check, training attendance, farm visit, distribution). The four field forms already
  exist as data (`lib/distribution-form.ts`, `lib/field-forms.ts`): build a screen that renders
  them and a save path into the same records the Kobo sync fills, then delete Kobo (171 files
  mention it, 32 are named for it, 3 tables, the nightly check, the setup steps, 4 language files).
  Offline capture is tested on a real phone before field use: 50 distributions with photos in
  airplane mode, a restart, a sync on weak signal, nothing lost or doubled.
- **All 13 missing features go in**, in five batches: field (MF-13, 07, 08, 12, 09); screening
  and approvals (MF-01, 03, 04); money (MF-11 first, then MF-02, MF-06); MEL (MF-10); hiring
  (MF-05, last and light).
- **Proof photos move out of the database** into file storage, with a fingerprint of each file
  kept in the database so a change still shows. The database tier caps at 500 MB.
- **Pace:** steady and continuous. Every fix has a test before it is committed.
- **Build target:** built and reviewed once by 4 Dec; fixes only from then to the 10 Jan demo.

## Tucker's answers, 27 Nov (second session)

- Kobo out and all 13 missing features: confirmed.
- D-13, D-05 (third party), solo reconciliation, "left on a line", the licence exception: kept as built.
- D-24: kept as a warning, **plus a hard daily cap** when a donor or the personnel policy sets one
  (Settings, People, "No one may record more than this many worked hours in a day"). Built.
- D-03: USD 500 kept for the demo organization. A USD 0 default is for larger organizations: small
  offices often have no second person.
- Purchase numbers: **numbered per project**, with the project's code in the number
  (PR-A2027-004), so each is still one of a kind. Built.
- Loose ends: ISS-17 second person (the procurement manager confirms "separate needs") and both
  sanctions lists by default (OFAC SDN and UN 1267). Built.

## The other 22 decisions: Tucker, 27 Nov, "a for all" (the review's recommendation)

Recorded as decided; each is built with the batch named, or is a document change outside the app.

| Decision | Decided | Where it lands |
|---|---|---|
| D-01 Governing policy | Per country in Settings: AF 2025 for Afghanistan, 2022 elsewhere; Draft 1.0 rules marked proposed and off until approved | Settings, next fixes batch |
| D-02 Withholding article | Art. 72 stays, as a setting with its source; Kabul finance or a tax adviser confirms | Accountant question |
| D-04 Advance settlement | Per donor and country: 15 days UN, GT travel policy for Guatemala, 30 days otherwise | Money batch (MF-02) |
| D-06 Advertising period | 14 days a hard stop for large purchases; shorter only with the executive head's written exception, logged | Next fixes batch |
| D-07 Solicitation release | The Country Director; the CEO comes in at award for large purchases; in the authority table | Authority table |
| D-08 Contract signature | CEO above $25,000, Country Director up to $25,000 | Authority table |
| D-09 Payment approval | Programme management up to $25,000, the executive head above | Authority table |
| D-10 Second verification | Kept at $25,000; written into the Finance Manual | Policy document |
| D-11 Checklist | The app's step checks are the checklist; VSU approval dropped unless someone can say what it is | Policy document |
| D-12 Bid scoring | A setting; 100 points, 70 to pass by default | Next fixes batch |
| D-13 Delegation | The board approves the app's authority table as ROP's written delegation, with backups (MF-01) | Screening and approvals batch |
| D-14 Compliance review | In the policy, with the real holder named | Policy document; Tucker names the holder |
| D-15 Contract closeout | Vendor evaluation stays mandatory above $5,000; tell the team | Already built |
| D-16 to D-18 Hiring | Panel of 3 to 4 at or above the post's level, HR does not score; references after interviews, finalists only; CVs always graded | Hiring batch (MF-05) |
| D-19 Staff contracts | The CEO signs; the Hiring Procedure is updated | Policy document |
| D-20 Afghan salary basis | One table chosen before payroll goes live | Finance and HR |
| D-21, D-22 Eligibility | Per intervention, as structured rules; a women's contribution rate allowed | Field batch (MF-12) |
| D-23 Hiring screening | Finalist screened before the offer, result filed, yearly re-screen | Screening batch (MF-03) |
| D-25 Retention | The longest period that applies, per donor profile | Next fixes batch |
| D-26 Bulk acceptance | Only records with no flags, after a random sample is opened; monthly verification sample | MEL batch (MF-10) |
| D-27 GRN signature | The requester or a named delegate in the same department (taken earlier) | ISS-12 |
| D-28 Distribution form | The app's rule is the written standard | Policy document |

## Code review of this branch (27 Nov): nine problems, all fixed

| Finding | Fix | Commit |
|---|---|---|
| Two saves of the same new purchase number: the second overwrote the first | The save takes the new number first; the second is told it is taken | `cc19072`, `e454743` |
| "Left on a line" differed: a direct purchase was missed at the requisition | Counted the same everywhere | `9dfbbb6` |
| A sent-back ask held the line's money | A returned item holds nothing until sent again | `9dfbbb6` |
| Budget failed to load: the approver's money check passed | The save stops with a plain reason | `9dfbbb6` |
| Reconciliation solo mode came from whichever project the request used | Decided for the whole organization | `bac9ea9` |
| One person could sign both calendar approval seats | Two seats, two people | `ed7bfe4` |
| A backdated hand-out could over-draw a later day; a future GRN date switched the check off | Every later day is checked; a real project's GRN is never dated after today | `3038008` |
| Record a payment: screening age vs today; other projects' numbers; lost declaration on retry | Measured to the day paid; any number of the organization; written once on a retry | `f375aa2` |
| Timesheets used the UTC day; a week across two months was cut | The office's own day; last month's days of the week count | `fa8b947` |

## Decisions taken at the review's recommendation (overrule any of them)

Each is built as a rule with a default, so changing it is a setting, not a rewrite.

| Decision | What was built | Where |
|---|---|---|
| D-13, nobody approves what they proposed | The asker of an off-calendar purchase cannot approve it in either seat, even as an administrator. Their own line goes to another lead of that line, else their line manager. | `lib/procurement-plan.ts` |
| D-24, timesheet rules | Submitted from the month's last working day; no worked hours on a day still to come; over 8 hours a day or 40 a week needs a note, shown to the supervisor. **Not a hard block**, against the review's first option: a block teaches people to write 8 when they worked 12. Limits per office in `HOUR_LIMITS`. | `lib/timesheet.ts` |
| D-05, screening of a third-party receiver | Money handed to someone other than the payee needs the payee's written authorization on file and a screening date within 183 days. Which lists are checked is not yet enforced: still open. | `lib/ledger/payment-guard.ts` |
| D-03, posting your own payment | Unchanged. Not set means every payment needs a second person; the demo organization allows up to USD 500. | `lib/policy.ts` |
| Solo mode and reconciliation | A one-finance-person team may complete its own bank reconciliation by confirming each time; the entry is marked self-approved like every other solo sign-off. | `server/reconciliation.ts` |
| What "left on a budget line" means | One figure: budget, less spending posted, less the unpaid part of purchases under way, less asks made outside the calendar and not started. A planned calendar item is **not** taken off: it is the line's own remainder and becomes a commitment when its request starts. A request past the figure is refused unless a funder-approved revision is recorded. | `lib/line-money.ts` |
| A supplier with no licence | Stops at screening. Going ahead without one is an exception with its reason on the record, not a block with no way through. | `lib/procurement.ts` (check `screen.dd`) |
| Purchase numbers | Replaced 27 Nov: per project, with the project's code in the number (`PR-A2027-004`). | `server/procurement-store.ts` |

## Done (21 of 30 issues; the 9 left are listed under "Not done yet")

| Issue | What changed | Commit |
|---|---|---|
| ISS-01 (critical) | "Write it myself" for the request for quotation, solicitation, sole source justification and package cover memo. The record's facts are filled in; what only a person knows is a blank in [square brackets]; it counts as read only when every blank is filled. | `7539271` |
| ISS-02 (critical) | Record a payment refuses a payment that names a purchase, asks why on a line with purchases not yet closed, and requires authorization plus a screening date for a third-party receiver. | `9d3243d` |
| ISS-03 (high) | See D-13. | `19a2ba5` |
| ISS-04 (high) | Whoever recorded or posted an entry on a bank account in a month does not complete that month's reconciliation. | `1e7f02e` |
| ISS-05, ISS-06 (high) | See D-24. | `8d5d9c1` |
| ISS-07 (high) | One figure for what is left on a budget line, in the same words on the ask form, the calendar item, the requisition check, the printed requisition and a new check on the approver's step. | `efdf543` |
| ISS-08 (high) | A missing or expired licence fails the screening check; the licence is recorded at screening on a project with no supplier register. | `bf1d361` |
| ISS-09 (high) | The health page records and shows why a query failed. One database connection per live server instance, so the 15 shared connections are not used up (`36e10b0`, to revisit before the demo). **Not yet confirmed on the live site**: see "Open". | `e096fbf`, `36e10b0` |
| ISS-10, ISS-26 | The requisition says when a purchase was not on the calendar and why. No "median undefined days". | `c0548d9` |
| ISS-11 | Purchase numbers are one of a kind: per project with the project's code in them (`PR-A2027-004`), taken first at the save. | `37f65b9`, `cc19072` |
| ISS-13 | One screening date for a purchase's supplier wherever it is shown. | `da5306f` |
| ISS-16 | A hand-out draws only on stock received by its own day. A receipt dated after today (a sample project on its own calendar) counts as before. | `a97e264`, `9dc0314` |
| ISS-17 | A possible split is said on the ask form and kept on the calendar item for its two approvers; the approver's "separate needs" waits for the procurement manager to confirm it. | `34fd597`, `11db6e9` |
| ISS-12 | The goods received note is signed by the requester or the one person they name in their own department, never procurement or the storekeeper; it records the day the goods arrived, the supplier's delivery note and their condition, and prints the real requester and inspector. | `c4a0940` |
| ISS-19 | The authority table shows anyone with a role's right on their own record and what it lets them do; the sample organization names Omar under MEL. | `d9a457e` |
| ISS-18 | Field activities flags training and inputs while no selection rule is saved. | `7abd1c4` |
| ISS-20 | One next report for a donor on Home, Project settings and Progress. | `8ed37ec`, `f08b011` |
| ISS-28 | Results and proof says its target is the whole project's; Progress shows the year's. | this commit's parent |
| ISS-21 | A request from the calendar is not asked for its activity or lead time again: both are worked out and shown. | `f78e16d` |
| ISS-29, ISS-30 | Places follow the project's country (Afghanistan, Guatemala, typed otherwise). One sign-in label. | `f78e16d` |

## Open

- **ISS-09: confirm on the live site.** The connection change (`36e10b0`) is live. Click Draft with
  AI on a purchase at "Prepare the request for quotation", then read Settings, Health: either no
  new error, or the reason the database gave, which is now recorded.
- **Not looked at in a browser.** Every screen change here was typechecked, linted and covered by
  rule tests, not seen. Screens touched: procurement draft panel, Record a payment, procurement
  calendar (ask form and item), bank reconciliation, timesheet, supplier field at screening,
  goods received panel, Settings Health, People (authority table), results (place and target), sign-in.
- ~~ISS-12, small gap~~: done, `1a2159a`.

## Checks run

- Typecheck and lint: clean on every commit.
- The whole test suite, run on a Linux copy with its own install: 172 test files, 1,364 tests,
  all passing at `d9a457e`.

## Not done yet, and why

| Issue | Why it waits |
|---|---|
| ISS-14 (the receipt photo's date, farmer and quantities compared with the record) | Belongs with the in-app distribution form, where the receipt is captured. |
| ISS-15, ISS-22, ISS-27 | Settled by taking Kobo out: the labels, the outside dependency, and renaming the farmer's signed receipt "distribution receipt" all change in that rewrite. |
| ISS-23, ISS-24, ISS-25 (SharePoint, backups, "posted in NetSuite") | The wording already follows the organization's settings; the demo organization is set to SharePoint and NetSuite. The real change is month close using the app's own books when no outside system is named: with the money batch. |

## Next (in order)

1. ~~ISS-18, then ISS-20~~ (done, see the top).
2. Kobo out and the five in-app forms, with batch 1 of the missing features (and ISS-14, ISS-15, ISS-22, ISS-27).
3. Batches 2 to 5. Local currency (MF-11) first in the money batch, with ISS-23 to ISS-25.
