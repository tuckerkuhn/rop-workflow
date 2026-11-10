# Morning report, 10 Nov 2026

The night stopped early, at about 23:45, because the usage limit was reached. Phases 0 to 4 and C6 are done and merged into `surge/2026-11-09`. `main` was never touched. Details for every item are in `docs/SURGE-LOG.md`; the audit is `docs/AUDIT-2026-11-09.md`.

## What is now true that was not yesterday
- 219 tests guard the logic behind donor figures, and CI runs them.
- Every project route checks the organization; every change that lacked an audit row has one; approving a bill no longer errors and loses its audit row.
- All AI calls go through one module (`src/server/ai.ts`) with a named job, cleared facts, an audit row and plain failures.
- Overspent, the report deadline, our workplan rows and supplier screening each have one rule; donor name, goal and thresholds each have one reader.
- A report download never assumes pre-flight is clear; failed loads say so; every AI flag says what it looked at.

## Look at first
1. Quarterly report page on `SFTP-2026`: claim-check findings with "Fix the text" / "The text is right", and the line that says why "Mark final" is off.
2. Work and Closeout with the network off: they now say the load failed.
3. The live audit log: look for missing `bill_approved` rows since B2 merged.

## Failed or left unmerged
- **C1 Home: Approve, Fix, Due** is half built on `feature/home-three-buckets` (one WIP commit, does not typecheck, not merged). Left: add the `home.b.*` text in four languages, wire `WaitingOnYou` into `role-home.tsx`, test.
- **Not started:** C3, C2, B4, and all of Phase 6 (C7, C5, C4, B5).
- **Phase 7's walk of Daniel's path was not done.** No top-five list; the audit's Screens and Decisions tables are the nearest thing.
- One merge (`ff928d6`) briefly had a type error; fixed in the next commit.

## Migrations waiting
None. No schema change was made.

## Decisions made overnight
Listed at the end of `docs/SURGE-LOG.md`, each one line and reversible.

## Questions only Tucker can answer
- Translation sends Dari and Pashto notes to the AI as written, and photo coaching sends the photo; `docs/DATA-PROTECTION.md` says neither happens. Change the code or the document?
- Consent for "Donor reports" alone still holds a recognisable photo out of the donor report. Intended?
- Home's "10th of the month" report date is not in the policy file. Is it a rule?
- The 21 decisions with no written ROP rule, at the end of section 5 of the audit.
- The Spanish, Dari and Pashto text I added (`src/lib/i18n/surge.ts`, `ai-why.ts`) needs a native reader.

## How to accept or throw away
Accept: `git checkout main && git merge --no-ff surge/2026-11-09 && git push` (CI then runs; there are no migrations).
Throw away: leave `main` as it is; it still equals the tag `pre-surge-2026-11-09`.
