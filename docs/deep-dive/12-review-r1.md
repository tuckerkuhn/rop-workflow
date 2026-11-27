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
| What "left on a budget line" means | One figure: budget, less spending posted, less the unpaid part of purchases under way, less asks made outside the calendar and not started. A planned calendar item is **not** taken off: it is the line's own remainder and becomes a commitment when its request starts. A request past the figure is refused unless a funder-approved revision is recorded. | `lib/line-money.ts` |
| A supplier with no licence | Stops at screening. Going ahead without one is an exception with its reason on the record, not a block with no way through. | `lib/procurement.ts` (check `screen.dd`) |
| Purchase numbers | One sequence per year across the whole organization (`PR-2026-004`), not per project. The project code is not in the number. | `server/procurement-store.ts` |

## Done (16 of 30 issues fixed; ISS-09 and ISS-17 partly; 12 not started)

| Issue | What changed | Commit |
|---|---|---|
| ISS-01 (critical) | "Write it myself" for the request for quotation, solicitation, sole source justification and package cover memo. The record's facts are filled in; what only a person knows is a blank in [square brackets]; it counts as read only when every blank is filled. | `7539271` |
| ISS-02 (critical) | Record a payment refuses a payment that names a purchase, asks why on a line with purchases not yet closed, and requires authorization plus a screening date for a third-party receiver. | `9d3243d` |
| ISS-03 (high) | See D-13. | `19a2ba5` |
| ISS-04 (high) | Whoever recorded or posted an entry on a bank account in a month does not complete that month's reconciliation. | `1e7f02e` |
| ISS-05, ISS-06 (high) | See D-24. | `8d5d9c1` |
| ISS-07 (high) | One figure for what is left on a budget line, in the same words on the ask form, the calendar item, the requisition check, the printed requisition and a new check on the approver's step. | `efdf543` |
| ISS-08 (high) | A missing or expired licence fails the screening check; the licence is recorded at screening on a project with no supplier register. | `bf1d361` |
| ISS-09 (high), part 1 | The health page records and shows why a query failed, not only which one. **The fault itself is not fixed**: see "Open". | `e096fbf` |
| ISS-10, ISS-26 | The requisition says when a purchase was not on the calendar and why. No "median undefined days". | `c0548d9` |
| ISS-11 | Purchase numbers are one of a kind across the organization: the screen asks the server for the next one and the save refuses a clash. | `37f65b9` |
| ISS-13 | One screening date for a purchase's supplier wherever it is shown. | `da5306f` |
| ISS-16 | A hand-out draws only on stock received by its own day. A receipt dated after today (a sample project on its own calendar) counts as before. | `a97e264`, `9dc0314` |
| ISS-17, part | A possible split is said on the ask form and kept on the calendar item for its two approvers. A second person for the approver's "separate needs" override is **not** built. | `34fd597` |
| ISS-21 | A request from the calendar is not asked for its activity or lead time again: both are worked out and shown. | `f78e16d` |
| ISS-29, ISS-30 | Places follow the project's country (Afghanistan, Guatemala, typed otherwise). One sign-in label. | `f78e16d` |

## Open

- **ISS-09, the fault itself.** "Draft with AI" still fails. The health screenshot shows the
  failure is a database read that dies before the AI is called (the "AI run started" row is
  never written). Best guess, unconfirmed: the session pooler's 15-connection limit
  (`src/db/index.ts`), held by suspended server instances. **Next step needs the live site:**
  deploy this branch, click Draft with AI once, read Settings, Health for the reason now recorded.
  Do not change the pooling blind.
- **Not looked at in a browser.** Every screen change here was typechecked, linted and covered by
  rule tests, not seen. Screens touched: procurement draft panel, Record a payment, procurement
  calendar (ask form and item), bank reconciliation, timesheet, supplier field at screening,
  Settings Health, results (place), sign-in.
- **ISS-17:** the approver alone can still record "separate needs" on the requisition.
- **D-05:** which sanctions lists are checked (OFAC and UN 1267 both, by the review) is not enforced anywhere yet.

## Checks run

- Typecheck and lint: clean on every commit.
- The whole test suite, run on a Linux copy with its own install: 90 rule test files (869 tests)
  and 75 database test files (470 tests), all passing at `9dc0314`. The wider database run caught
  one fault in the ISS-16 change, fixed in `9dc0314`.

## Not done yet, and why

| Issue | Why it waits |
|---|---|
| ISS-12 (who signs the goods received note, delivery date and note number) | Next in line. Decision D-27 taken as: the requester or a named delegate in the same department. |
| ISS-14 (the receipt photo's date, farmer and quantities compared with the record) | Belongs with the in-app distribution form, where the receipt is captured. |
| ISS-15, ISS-22, ISS-27 | Settled by taking Kobo out: the labels, the outside dependency, and renaming the farmer's signed receipt "distribution receipt" all change in that rewrite. |
| ISS-18 (selection rule before training), ISS-19 (MEL holder in the authority table), ISS-20 (one report calendar), ISS-28 (label targets as year or life of project) | Not started. Each is a small, separate fix. |
| ISS-23, ISS-24, ISS-25 (SharePoint, backups, "posted in NetSuite") | The wording already follows the organization's settings; the demo organization is set to SharePoint and NetSuite. The real change is month close using the app's own books when no outside system is named: with the money batch. |

## Next (in order)

1. ISS-12, then ISS-18, ISS-19, ISS-20, ISS-28.
2. Kobo out and the five in-app forms, with batch 1 of the missing features (and ISS-14, ISS-15, ISS-22, ISS-27).
3. Batches 2 to 5. Local currency (MF-11) first in the money batch, with ISS-23 to ISS-25.
4. ISS-09 once the live site has recorded the reason.
