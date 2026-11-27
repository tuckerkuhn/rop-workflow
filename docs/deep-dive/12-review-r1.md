# Review round 1: progress and decisions (started 27 Nov 2026)

Source: `ROP_Workflow_Review_Round_1.xlsx` (30 issues, 28 decisions, 13 missing features),
reviewed 26 Nov 2026 for Daniel Sandoval and Tucker Kuhn. Branch:
`build/review-r1-critical-2026-11-27`. Nothing here is pushed until Tucker says "save".

**Anyone picking this up (a person, another model, a later session): start at "Next", below.**

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

## Decisions taken at the review's recommendation (overrule any of them)

Each is built as a rule with a default, so changing it is a setting, not a rewrite.

| Decision | What was built | Where |
|---|---|---|
| D-13, nobody approves what they proposed | The asker of an off-calendar purchase cannot approve it in either seat, even as an administrator. Their own line goes to another lead of that line, else their line manager. | `lib/procurement-plan.ts` |
| D-24, timesheet rules | Submitted from the month's last working day; no worked hours on a day still to come; over 8 hours a day or 40 a week needs a note, shown to the supervisor. **Not a hard block**, against the review's first option: a block teaches people to write 8 when they worked 12. Limits per office in `HOUR_LIMITS`. | `lib/timesheet.ts` |
| D-05, screening of a third-party receiver | Money handed to someone other than the payee needs the payee's written authorization on file and a screening date within 183 days. Which lists are checked is not yet enforced: still open. | `lib/ledger/payment-guard.ts` |
| D-03, posting your own payment | Unchanged. Not set means every payment needs a second person; the demo organization allows up to USD 500. | `lib/policy.ts` |
| Solo mode and reconciliation | A one-finance-person team may complete its own bank reconciliation by confirming each time; the entry is marked self-approved like every other solo sign-off. | `server/reconciliation.ts` |

## Done

| Issue | What changed | Commit |
|---|---|---|
| ISS-01 (critical) | "Write it myself" for the request for quotation, solicitation, sole source justification and package cover memo. The record's facts are filled in; what only a person knows is a blank in [square brackets]; it counts as read only when every blank is filled. | `7539271` |
| ISS-09 (high), part 1 | The health page records and shows why a query failed, not only which one. **The connection fault itself is not fixed**: see "Open". | `e096fbf` |
| ISS-02 (critical) | Record a payment refuses a payment that names a purchase, asks why on a line with purchases not yet closed, and requires authorization plus a screening date for a third-party receiver. | `9d3243d` |
| ISS-03 (high) | See D-13. | `19a2ba5` |
| ISS-04 (high) | Whoever recorded or posted an entry on a bank account in a month does not complete that month's reconciliation. | `1e7f02e` |
| ISS-05, ISS-06 (high) | See D-24. | this commit's parent |

## Open

- **ISS-09, the fault itself.** "Draft with AI" still fails. The health screenshot shows the
  failure is a database read that dies before the AI is called (the "AI run started" row is
  never written). Best guess, unconfirmed: the session pooler's 15-connection limit
  (`src/db/index.ts`), held by suspended server instances. **Next step needs the live site:**
  deploy this branch, click Draft with AI once, read Settings, Health for the reason now recorded.
  Do not change the pooling blind.
- **Checks not run here:** the whole database test suite (160 files) is too slow in the sandbox
  this work was done in. Run `npm test` on the Mac before this goes live. Run so far: all 85
  rule test files, plus the database tests for each area touched.
- **Not looked at in a browser:** every screen change above was typechecked and linted, not seen.

## Next (in order)

1. ISS-07: one "money left on the line" figure everywhere (ask form, calendar, requisition, approver).
2. ISS-08: licence, ID and bank details checked before the award, not at payment.
3. The mediums and lows: ISS-10 to ISS-30. ISS-15, ISS-22 and the Kobo part of ISS-16 are settled by removing Kobo.
4. Kobo out and the five in-app forms, with batch 1 of the missing features.
5. Batches 2 to 5.
