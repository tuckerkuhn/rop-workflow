# Cursor prompt: deep dive. The AI key, Kobo out, the missing features and what is left of review round 1

Written 2026-11-27 against `main` at `acf5cec`, plus branch `build/review-r1-next-2026-11-27`
(5 commits not yet on main: ISS-12, ISS-19, ISS-28, the progress file and this prompt).
For Cursor with **Opus 5.5**. Paste this whole file into Cursor, or tell Cursor:
"Follow docs/CURSOR-PROMPT-2026-11-27.md".

---

You are working in the `rop-workflow` repo (Next.js, TypeScript, Supabase, Drizzle, Zod, Claude API).
Tucker's instruction for this deep dive: **do not stop moving.** Not fast: steady. Work down the
parts below in order, commit each fix as it lands and keep going. Stop only for the things listed
under "Only Tucker".

## Read first, in this order

1. `CLAUDE.md` (what "save" means).
2. `docs/deep-dive/12-review-r1.md`: what review round 1 found, what is fixed, every decision
   Tucker took (all 28) and where each lands. **This is the state. Start at its "Next".**
3. `docs/deep-dive/OPEN-ITEMS.md`, the last sections (database connections before the demo).
4. `docs/deep-dive/ROUNDS.md`, "Rules that do not change". They still hold **except two**, which
   Tucker withdrew on 27 Nov:
   - "All field data comes in through KoboToolbox": withdrawn. Kobo comes out completely (Part 2).
   - "Do not add pages, sections or features": withdrawn for the 13 missing features (Part 3) and
     the in-app field forms. Everywhere else, still tighten what exists.

## How to work

1. **Start from** `build/review-r1-next-2026-11-27`. One branch per part, `build/<what>-<date>`,
   cut from the one before. Commit per fix, with the issue or feature number in the message.
2. **Every fix has a test before it is committed.** Rules in `src/lib/__tests__` (pure), flows in
   `src/server/__tests__` (in-memory Postgres). Before each commit: `npm run typecheck`,
   `npm run lint`, `npm test`. The suite was 172 files, 1,364 tests, all passing at `d9a457e`.
   A failing test is fixed, never skipped or deleted.
3. **Look at every screen you change**, at 380px and at desktop width, signed in as the role that
   uses it. Run the dev server **only against a local throwaway database**
   (`docs/deep-dive/tools/setup-local.sh` shows what it needs). Never point a dev server at
   Supabase: the live site and everything else share 15 database connections and a dev server
   uses them up. Eleven screens changed on 27 Nov were typechecked and tested but never seen:
   look at them first (the list is under "Open" in `12-review-r1.md`).
4. **Extend, don't duplicate.** One function for one rule, read by every screen that shows it
   (see `src/lib/line-money.ts` for the pattern).
5. **Decisions are already taken.** Each is in `12-review-r1.md` with where it lands. Build each
   as a rule with a default in Settings, never hard-coded for Roots of Peace: the app will be
   renamed and used by other organizations. If you meet a choice that is not in that file, take
   the option that is easiest to undo, write it under "Needs Tucker" in `12-review-r1.md` and
   keep going.
6. **Keep `12-review-r1.md` true.** After each part: what was done with its commit, what is open,
   what is next, what needs Tucker. Another session picks up from that file alone.
7. House rules that hold: English only (no translation work until Tucker says); plain words on
   every screen; ask a person only for what the app does not already know; each fact entered
   once; nobody approves what they recorded or asked for; AI proposes and a named person
   confirms; every change writes to the audit log; fictional data only in seeds and tests;
   templates and settings, not one-off code for one project; phone first.

## Never

- Push or merge to `main` unless Tucker says "save". Main goes live and runs migrations on the
  live database. Pushing a working branch is fine.
- Put a secret in the repo, a commit message, a test or a log. **The repo is public.**
- Touch Supabase by hand, real email addresses or real people's data.
- Run anything that deletes data or drops a table. Write the migration, say what it removes
  under "Needs Tucker" and leave it for his save.

## Only Tucker

- The AI key itself (Part 0, step 2).
- "Save" (merge to main).
- The real-phone offline test (Part 2, step 6).
- Anything in "Never".

---

# Part 0: the AI key

**Seen on the live site, 27 Nov 22:27 UTC:** Draft with AI on PR-2026-001 answered "The AI key on
this server was not accepted. An administrator needs to replace ANTHROPIC_API_KEY." Every AI
feature on the live site is down. (The database fault that hid this is past: see ISS-09.)

1. **Find out which fault it is before anything is replaced.** `src/server/ai.ts` `plainAiError`
   gives the same sentence for two different faults: the key is wrong or revoked (401), or the key
   is fine but may not use the model or the beta header (403). The model is `DRAFT_MODEL`
   (`claude-opus-5-5`) and the request sends `betas: ["server-side-fallback-2026-07-01"]`.
   - Record the real status and the API's own message on the `ai_run_failed` audit row and show it
     on Settings, Health, as `src/lib/error-cause.ts` does for database faults. Never record the
     key or any part of it.
   - Give the two faults two sentences: "replace the key" and "this key may not use this model:
     ask whoever manages the Anthropic account, or change the model in Settings".
   - Test both paths.
2. **Tucker replaces the key.** Give him these steps and wait for him to say it is done. Do not
   ask him to paste the key into the chat, and do not write it anywhere yourself:
   - Create a new key in the Anthropic Console (the old one is treated as lost).
   - In Vercel: the `rop-workflow` project, Settings, Environment Variables, `ANTHROPIC_API_KEY`
     for Production (and Preview), then redeploy.
   - For local use it goes in `.env.local` only, which is not committed.
3. **Check it.** On the live site sign in as Hamid Wardak (demo mode, no password), open a
   purchase at "Prepare the request for quotation" and click Draft with AI. A draft arrives in
   about a minute and Settings, Health shows one more AI run and no new error. PR-2026-001 now
   holds a hand-written draft from the 27 Nov test: its button reads "Draft with AI instead".

# Part 1: what is left of review round 1

Nine issues are open. Two are fixed here; the rest are settled inside Parts 2 and 3.

- **ISS-18, farmer selection.** No selection rule is saved for A-2027, yet farmers are trained
  and receive inputs. Flag training and distribution until a rule is saved, on the screens where
  they start. The structured rule itself is MF-12 (Part 3).
- **ISS-20, one report calendar.** The donor home and project Settings say Demo Foundation's next
  report is the monthly report for January, due 8 Feb 2027; Progress says the quarterly report
  for Oct to Dec 2026, due 30 Jan 2027. One source for all three screens.
- **ISS-12, one gap.** When the requester is away and named nobody, only an administrator may
  name who receives the goods (`checkReceiver` in `src/server/procurement-guard.ts`) and there is
  no screen for the administrator to do it. Add it.

# Part 2: Kobo out

**Decided by Tucker, 27 Nov: KoboToolbox is removed completely. The only app a user touches is
this one. Every integration is on the back end.**

What is there now: 171 files mention Kobo, 32 are named for it. Three tables
(`kobo_connections`, `kobo_forms`, `kobo_mappings`), Kobo columns on `evidence`, the nightly job
`/api/kobo/reconcile` in `vercel.json`, `KOBO_TOKEN_KEY`, the `kobo/` folder, the setup steps
(`src/components/setup/kobo-*.tsx`), the Health page section, the `kobo-suggest` text files and
"+ New, Register a farmer", which opens kf.kobotoolbox.org.

What makes this smaller than it looks: **the app already writes all four field forms as data**
(`src/lib/distribution-form.ts`, `src/lib/field-forms.ts`): the questions, the names the server
reads and the checks made on the phone. Build a screen that shows those definitions and a save
path into the records the Kobo sync fills today (`src/server/kobo.ts` `toSubmission`,
`src/server/review.ts`, `src/server/distribution.ts`). Do not write the forms again.

Order. Kobo cannot be deleted first: field data would have no way in.

1. **Five in-app forms**, online first: distribution, readiness check, training attendance, farm
   visit, and register a farmer (the one with no form yet). One renderer for all five. The
   person recording is the person signed in. The place is the phone's own GPS, the date defaults
   to today, a mistake the server would refuse is refused on the form.
2. **What the forms can do that Kobo could not, because they see the app's records.** Build these
   with them:
   - MF-07 household roster: members with sex and age on registration.
   - MF-08 duplicate check at registration and import: name variants, the same phone, the same ID.
   - MF-12 eligibility rules as fields (land size, contribution, location, crop), set per
     intervention with a women's contribution rate allowed (D-21, D-22), checked for each farmer.
   - MF-09 training details: the curriculum and its version, pre and post test scores.
   - ISS-14: the receipt photo's date, farmer and quantities are confirmed against the record one
     by one, and a mismatch is flagged. The review's receipt read 2027-02-27 on a 20 Nov hand-out
     and the screen said "Nothing flagged".
   - ISS-15: each check names its real source: "Recorded in the app by <name>".
   - ISS-27: the farmer's signed receipt is called a **distribution receipt** everywhere. "Goods
     received note" is the supplier's delivery, nothing else.
3. **The rules that carry over.** Nobody approves data they collected (reporting lines decide
   when there is one MEL officer). The named MEL approver checks field data before it flows to
   the other workflows. Every distribution needs the recipient's signed receipt and a photo of
   it. Anyone visiting farmers may add photos; a visitor's photo is a picture of the work, not proof.
4. **Photos out of the database.** Proof files sit in Postgres, which caps at 500 MB (about
   1,000 photos). Move them to file storage with a fingerprint of each file kept in the database,
   so a change to a file still shows. No new paid service.
5. **Offline.** Forms open and save with no signal, keep each record and its photos on the phone
   until the server confirms it, show how many are waiting to send, and never send one twice
   (one id per record, made on the phone). Photos are shrunk before they are kept.
6. **The test before Kobo goes** (Tucker, on a real cheap Android): 50 distributions with photos
   in airplane mode, a restart, a sync on weak signal, nothing lost and nothing doubled. Write
   the test as a checklist he can follow. Until it passes, say on the form that it needs signal.
7. **Delete Kobo.** Screens, setup steps, sync, the nightly job, the env key, the `kobo/` folder,
   the words. The migration that drops the tables and columns is written and left for Tucker's
   save (see "Never"). ISS-22 closes here.

# Part 3: the missing features

All 13 go in, in this order. Four are in Part 2 (MF-07, 08, 09, 12) with MF-13.

**Screening and approvals**
- MF-01 backup approvers: a holder sets an away period and a delegate; work routes to the
  delegate; the record says "approved by X on behalf of Y"; with no delegate, an item waiting
  past a set number of days escalates. The board approves the authority table as the written
  delegation (D-13).
- MF-03 staff screening: the finalist is screened before the offer, the result is filed, the
  re-check is yearly (D-23). Both lists by default: OFAC SDN and UN 1267 (D-05, built).
- MF-04 farmer screening above $50: before the first distribution over $50, held until done.
  **A possible match goes to a person to review. It never blocks by itself:** common names will
  match a list constantly.

**Money.** Local currency first: every finance screen built before it is reworked after it.
- MF-11 local currency: accounts and payments in AFN and GTQ with the month's rate. The afghani
  rate is fixed at 70 today and there is no quetzal rate (`OPEN-ITEMS.md`).
- MF-02 advances: request and approve; paid only to the named holder; its age shown; settled
  with receipts inside the deadline (D-04: 15 days for UN-funded projects, the travel policy for
  Guatemala, 30 days otherwise); what is unspent recovered. Q3 audit finding 1.
- MF-06 payment accounts register: accounts only in the organization's name; owner and type
  recorded; two people to add or change one; cash funding flagged. Q3 audit finding 2.
- ISS-23, ISS-24, ISS-25: month close uses the app's own books when the organization names no
  outside accounting system; file-store links are optional; an automatic export is scheduled
  and the backup plan confirmed.

**MEL**
- MF-10 verification sample: a random 2 to 5% of sites each month, assigned to someone other
  than the collector, the rate tracked. Bulk acceptance only for records with no flags, after a
  sample has been opened (D-26).

**Hiring, last and light**
- MF-05 recruitment: a vacancy open at least 14 days; a candidate list with relationship
  statements; a shortlist of 3 to 5; panel scores from 3 to 4 staff at or above the post's level,
  HR does not score; CVs always graded; references after interviews, finalists only; a selection
  memo with the reason for any deviation; approval by grade; handover to onboarding (D-16 to D-18).

# Part 4: before the 10 January demo

- **Database connections** (`OPEN-ITEMS.md`). One connection per live instance is a holding
  measure. Try Supabase's transaction pooler on a preview under load (it lost replies on 24 Nov),
  or raise the pool size. Settings, Health now records the database's own reason for each failure.
- **A full pass as Daniel's review did it**, role by role, on the seven scenarios in
  `ROP_Workflow_Review_Round_1.xlsx`, after Parts 1 to 3. What it finds goes into a round 2 list
  in the same shape as round 1.

---

## When you stop for the day

At the top of `docs/deep-dive/12-review-r1.md`: what landed with its commits, what is half done
and in what state, the tests' count, what you saw on screen and what you did not, and what needs
Tucker, each as one line he can answer.
