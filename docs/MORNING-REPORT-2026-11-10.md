# Morning report, 10 Nov 2026

Everything is on `surge/2026-11-09`. `main` was not touched and still equals the tag `pre-surge-2026-11-09`. The last run of lint, typecheck, 237 tests and build on the surge branch passed. **Nothing was run against a database or an outside service**, so every screen change is unseen: read, type-checked and tested at the rule level only. Detail is in `docs/SURGE-LOG.md`; the audit is `docs/AUDIT-2026-11-09.md`.

## Second session, 02:44 to 03:50

Done after you asked for the fixes and improvements in chat. All on `surge/2026-11-09`, pushed, each on its own branch; the last full run passed with 249 tests. All of it is unseen on a screen.

- **Quarter.** The report page says which quarter it shows and links to the one Home calls the next report.
- **Roles.** An open report lists, once, what your roles do not let you do on it.
- **Phone.** The report's target table and the Budget table stack below 1024px.
- **Overspent lines.** The reason can be typed on Budget, beside the line. It is the same saved text the report prints.
- **Target details.** New page `/progress/targets` (linked from the results framework) sets a target's baseline, breakdown, proof documents, budget line, workplan step and place in the quarterly table. No script needed.
- **Totals.** The report and Budget each say why their totals differ.
- **Pre-flight.** It already was the one readiness page. Its rows now open the report at the part to fix.

Short of what I listed:

- **Retyping.** Only the duration is filled from the project (its dates). Agreement number, director, locations and partner are stored nowhere else, so they are still typed. They are carried from quarter to quarter.
- **Bill book lock.** Not done: it needs a database to try.
- **Report page language.** Still English only, apart from the new lines.

Look at first: `/progress/targets` on `SFTP-2026`; then the Budget page on a phone with an overspent line.

New questions:

11. Should the Report tab open on the quarter under way, or the last one that ended (as now)?
12. May target details change after the plan is signed off?

## What is now true that was not yesterday

1. 237 tests guard the rules behind donor figures, and CI runs them.
2. Every project route checks the organization, every change that lacked an audit row has one, and all AI calls go through one module that records each run.
3. Each figure that had two rules has one (overspent, report deadline, our workplan rows, supplier screening); donor name, goal and procurement thresholds each have one reader.
4. A report download never assumes pre-flight is clear, and screens say when a load failed instead of saying "nothing to do".
5. Home lists what waits on you as Approve, Fix and Due; Progress is one row per target; every AI flag says what it looked at.

## Look at first (five minutes each, on `SFTP-2026`)

1. **Home.** The "Waiting on you" list, and "Open the report" on the next-report panel.
2. **Quarterly report.** Run the claim check, then "Fix the text" and "The text is right" on a finding; the line that says why "Mark final" is off.
3. **Progress.** Tap a target's row: the proof panel should open.

Also check the live audit log for missing `bill_approved` rows since B2 merged: the row was written with the bill number where the database needs an id, so from the code it was refused after the approval saved. Fixed here; I could not confirm it against the database.

## Failed, unfinished or not as specified

- **C4 plain words and C5 sample project: not started**, on purpose (see the log). C4's before-and-after list is not written.
- **C7** covers six fields on Results and Stories. Photos and HR have no "?" (both are not to be touched).
- **C2:** the short Home for KoboCollect-only field staff shows the project's latest submissions, not the person's own. The app does not keep who sent a submission.
- **C6:** the procurement step check has no per-finding buttons.
- **B4** was never run: running it calls KoboToolbox.
- **The path walk was done by reading code**, not on a phone.
- **The usage limit stopped the session** from about 23:45 to 00:41.
- One merge (`ff928d6`) briefly carried a type error; fixed in the next commit.
- The log's last entries for Phase 6 were merged without a separate full run after the merge; the branch itself was green and the final run below covers it.

## Migrations waiting

None. No schema change was made.

## Decisions made for you overnight (each reversible)

They are listed, one line each, under Decisions at the end of `docs/SURGE-LOG.md`. The ones most worth a look:

- Overspent means more than 0.5% above approved, everywhere (the report used budget + 1).
- Story drafts and four other AI jobs no longer send names in free text; procurement drafts now carry ROP's voice rules.
- Reports print the donor entered in setup or Settings, and use the framework's worded goal when there is one.
- A budget re-upload no longer changes "spent" once Finance's spending is imported.
- Hand-recorded results can only be accepted on the Results page.
- A third scheduled job was added to `vercel.json`. If the plan refuses it: delete the entry and set `KOBO_RECONCILE_IN_DIGEST=1`.

## Questions only you can answer

1. **Data protection.** Translation sends Dari and Pashto notes to the AI as written, and photo coaching sends the photo. `docs/DATA-PROTECTION.md` says neither happens. Change the code or the document?
2. **Photo consent.** Consent for "Donor reports" alone still keeps a recognisable photo out of the donor report. Intended?
3. **"On track"** has two meanings: against the workplan (reports, Home, the new Progress rows) and against time gone in the year (the cards donors see). Keep one?
4. **Report date.** Home falls back to "the 10th of the month after the quarter". Is that a written rule?
5. **Afghani rate.** It is a fixed 70 in three places while Finance's workbook states its own. Where should the month's rate be entered?
6. **Kobo usernames.** May the app store each person's KoboToolbox username, so field staff see their own submissions?
7. **"?" help.** May it be added to Photos and HR?
8. **Translations.** The Spanish, Dari and Pashto I wrote (`src/lib/i18n/surge.ts`, `ai-why.ts`, `field-help.ts`) need a native reader.
9. **Decisions with no written ROP rule:** 21 of them, numbered at the end of section 5 of the audit. The sharpest: who may resolve a policy exception; whether purchases stop during a donor conflict; whether a share link may go out before release; the payment approval ladder above $25,000.
10. **Left alone because they are not to be touched:** opportunities and payroll export write no audit row; HR screens lose a typed note on a failed "send back"; the lens review replaces earlier decisions when run again.

## Daniel's top five sticking points

From reading the path from sign-in to a released quarterly report. One was fixed tonight; the rest are open.

1. **He needs three role types to finish alone.** Accepting results needs MEL, releasing needs programme management, importing spending needs Finance, and accepting his own result needs solo mode switched on by an administrator. Missing any one, he was refused part-way. **Second session: the report now lists what he lacks at the top.** He still needs the roles.
2. **The plan must be signed off first, and Home sent him in a circle.** Pre-flight blocks the report while the project is in Design. Home's "Sign off the plan and budget" row linked to Home itself, where a saved project has no sign-off control. **Fixed: it now goes to Progress, where the control is.**
3. **The report page is English only.** Its target table and the Budget table scrolled sideways on a phone. **Fixed in the second session: both stack.** The language is still open.
4. **He retypes what the app knows.** Project title, duration, agreement number, director, locations and partner are typed on the report; overspent lines were flagged on Budget but explained on the report. **Second session: the reason can be typed on Budget, and the duration comes from the project's dates.** The other five fields are still typed.
5. **The Report tab opens last quarter, Home talks about this quarter.** **Fixed in the second session: the page now says which quarter it shows and links to the other.** Which one it should open on is question 11.

## How to accept the night

```bash
git checkout main
git merge --no-ff surge/2026-11-09
git push            # CI runs lint, typecheck, tests and build; there are no migrations to apply
```

To take only part of it, each item is its own branch, merged in the order the log lists.

## How to throw it away

Do nothing: `main` is unchanged. The surge branches can stay or be removed later. If something from the night ever reaches `main` by mistake, `pre-surge-2026-11-09` is the commit to go back to.
