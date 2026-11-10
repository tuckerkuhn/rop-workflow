# Surge log, 9 to 10 Nov 2026

One entry per item. Times are Guatemala time.

## 23:05 Phase 0. Make it safe

- `main` was clean apart from `.claude/` and the surge plan. Both committed on `surge/2026-11-09`, not on `main`.
- Tag `pre-surge-2026-11-09` set on `main` at `575641f` and pushed.
- Branch `surge/2026-11-09` created and pushed.
- Baseline on `575641f`: lint passes, typecheck passes, build passes. No tests exist.

## 23:10 Phase 1. A safety net (branch `surge/tests`)

- Added `vitest` (4.x; 5.x wants newer Node types than the repo has), `npm test`, and a test step in CI between typecheck and build.
- 183 tests in 13 files under `src/lib/__tests__/`, synthetic data only, on: results roll-up and women/men sums, progress and on-track, the quarterly table and its checks, breakdown tables, pre-flight deadlines, the name scrub, data checks, sign-off rules and solo mode, policy layering, photo consent, procurement thresholds, Finance's workbook reader, budget against spending, and B3's any-spreadsheet import.
- Tests cannot reach the database or the AI: both keys are blanked in `vitest.config.mts`.
- No bug that changes a donor figure was found. Two behaviours are pinned as they are and need Tucker's eye:
  - **Photo consent.** A recognisable person with consent for "Donor reports" only is still held back from the donor report (`lib/photos.ts` `shareLimit` needs "comms" or "social"). Safe side, but the consent form offers a choice that does nothing. Question in the morning report.
  - **Name scrub.** A capitalised word just before a name is swallowed with it ("Visited Zarmal's" becomes "a farmer's"). Safe side; left alone.

## Decisions

Each is reversible. Listed as they are made.
- Tests: vitest 4, not 5, so no existing dependency had to change.
