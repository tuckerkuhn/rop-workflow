# The grant ledger: core (23 Nov 2026)

The first slice of an audit-grade ledger (spec: `09-ledger-slice-prompt.md`). This part is the core:
tables, the rules the database enforces, the accounting rules, posting and the reads. Screens, the
reconciliation step in Month close, the expenditure import CLI and the nightly check come next and
build on the functions below.

**Not yet applied to the live database.** Migration `drizzle/0027_ledger.sql` runs only in the
in-memory test database. It is additive: new tables, indexes, functions and triggers; no existing
table, column or row changes. The owner applies it.

## What is built

| Piece | Where |
|---|---|
| Tables `ledger_accounts`, `journal_entries`, `journal_lines`, `fiscal_periods`, `bank_accounts`, `bank_statement_lines`, `reconciliations` | `src/db/schema.ts`, `drizzle/0027_ledger.sql` |
| Accounting rules (payment, donor money received, reversal; cents and rounding) | `src/lib/ledger/rules.ts` (pure, no database) |
| Default chart of 28 accounts, budget line kind to expense account | `src/lib/ledger/chart.ts` |
| Posting, periods, reads | `src/server/ledger.ts` |
| The organization rule for posting one's own payments | `ledgerSelfPostMaxUsd` in `src/lib/policy.ts` (Settings, Finance) |
| Tests | `src/lib/__tests__/ledger-rules.test.ts`, `src/server/__tests__/ledger.db.test.ts` |

### Rules the database enforces (not only the code)

1. A line has a debit or a credit, never both, never negative, never zero (CHECK).
2. A posted entry balances in the functional currency and has at least two lines. A deferred
   constraint trigger checks it when the transaction commits.
3. An entry is always written as a draft, its lines added, then posted (one transaction when posted at
   once). Posting changes only status, posted_by and posted_at; the database stamps posted_at. A
   draft is posted or deleted, never edited. A posted entry and its lines are never updated or deleted,
   by any route, script or direct SQL. Corrections are reversals pointing to the original
   (`reverses_id`, at most one reversal per entry).
4. Nothing posts into a locked month. A locked month stays locked.
5. The person who recorded a payment (or a reversal) cannot post it when it is over the organization's
   limit. Checked in code with a plain answer, then again by the database at commit.
6. Also: every line's account belongs to the entry's organization; an account's type and restriction
   cannot change once it has lines; a reconciliation completes only at a zero difference and never
   changes after; the books cannot be truncated once anything is posted, locked or reconciled (an empty
   ledger can, so the demo reset still works); `idempotency_key` is unique.

### Where the approval limit and functional currency live

- The rule is `ledgerSelfPostMaxUsd` in the organization's rules (lib/policy, changeable in Settings
  like any other rule). Default **500**, marked "to verify".
- The database cannot read code, so `server/ledger` copies the rule into `organization_state`, key
  `ledger`: `{ functionalCurrency, selfPostLimit }`, inside every posting transaction. The trigger reads
  it. No document: the limit is 0 and every payment needs a second person.
- Functional currency is in the same document. **Default USD**; there is no setting screen yet.

## For the next agents (screens, CLI, nightly check)

All amounts are decimal strings ("1234.50"). Person ids are the app's ids ("omar").

```ts
// src/lib/ledger/rules.ts (pure)
payment(input: PaymentInput): EntryDraft
donorReceipt(input: DonorReceiptInput): EntryDraft
reversal(original: { id; projectId; lines }, at: { date; memo }): EntryDraft
totals(lines): { functionalDebit; functionalCredit; balanced }
toCents / fromCents / convertCents / allocateCents / periodOf
BALANCING_RULE  // one sentence for the "What this writes" panel
LedgerRuleError

// src/server/ledger.ts
post(input: PostInput): Promise<PostResult>              // generic; idempotent on idempotencyKey
postPayment(who: Who, input): Promise<PostResult>          // who = { organizationId, recordedBy, postedBy?, asDraft?, idempotencyKey, sourceType?, sourceId? }
postDonorReceipt(who: Who, input): Promise<PostResult>     // revenue account defaults to 4000
reverse(who & { entryId, date, memo }): Promise<PostResult>
postDraft(entryId, by): Promise<PostResult>                // second person posts a draft
deleteDraft(entryId, by): Promise<void>
lockPeriod(orgId, period, by) / isLocked(orgId, period) / periodEnd(period)
seedChart(orgId) / accounts(orgId) / accountByCode(orgId, code) / expenseAccountFor(orgId, kind)
ledgerSettings(orgId): { functionalCurrency; selfPostLimit }
entry(id) / entriesBySource(sourceType, sourceId)
trialBalance(orgId, asOf?)        // rows per account, totals, balanced
budgetVsActual(projectId)         // rows per budget line and donor, byDonor, total
budgetLineEntries({ budgetLineId, projectId?, donorId? })   // drill-down
accountBalance(ledgerAccountId, asOf) / bankBookBalance(bankAccountId, period)
LedgerError (code: invalid | locked | needs_second_person | not_found | not_draft | not_posted | already_reversed | refused)
```

- A refusal with code `needs_second_person` means: offer "Save as a draft for someone else to post"
  (call again with `asDraft: true`; the second person calls `postDraft`).
- `PostResult.replayed` is true when the idempotency key was seen before; nothing new was written.
  Use a key per user action (for the expenditure CLI: `expenditure:<id>`).
- Audit actions written: `ledger_posted`, `ledger_drafted`, `ledger_reversed`, `ledger_draft_deleted`,
  `ledger_period_locked` (one row per entry or lock, in the same transaction). Entries without a project
  are logged with no project.
- An organization needs `seedChart(orgId)` once before anything posts. Bank accounts are rows in
  `bank_accounts` pointing to an asset account (default 1010, 1020, 1000); a payment from one must be
  in its currency.
- Expenditure import: sourceType `expenditure`, sourceId the expenditure id, expense account from
  `expenseAccountFor(orgId, budgetLine.kind)`, paid from an account the finance person chooses (the old
  rows do not say). `budget_lines.spent` stays until every page reads the ledger.
- Statement lines: `import_key` (unique per bank account) stops a line being imported twice;
  `matched_line_id` is unique, so a ledger line matches one statement line. Amounts are signed:
  positive money in.
- Reconciliation: `difference` must equal statement minus book; `completed_at` only at zero. Book
  balance: `bankBookBalance(bankAccountId, period)`.
- `budgetVsActual`: `budget` is in the budget line's own currency, `actual` in the functional currency.
  A screen showing both must say so, or convert.
- Admin export (`src/app/api/admin/export/route.ts`) does not include the ledger tables yet.

### Bank reconciliation (built 24 Nov 2026)

Month close (`/work/closeout`, section `#bank`). Server `src/server/reconciliation.ts`; CSV reading
`src/lib/ledger/statement-csv.ts`; routes `api/projects/[code]/reconciliation` (GET the month, POST
balance, match, unmatch, match_suggested, complete, lock) and `.../reconciliation/import`. Bank
accounts belong to the organization; the routes reach them through the project the person opened,
which settles the organization and who may read. Finance (procurement role finance, project role
finance-import or the HR Finance role) and administrators act; other staff on the project read the
three figures and whether it is done, not the lines; donors are refused.

- Import key: sha256 of date, description (spaces folded, lower case), amount and the running
  occurrence of that triple in the file. Lines dated outside the chosen month are left out.
- Suggestions: same amount and sign, at most 4 days apart, closest first, each line once.
- Statement lines and matches freeze once the month is reconciled (code); the reconciliation row
  itself never changes (database).
- Audit actions: `ledger_statement_imported`, `ledger_line_matched`, `ledger_line_unmatched`,
  `ledger_reconciled` (on the project the person acted from) and `ledger_period_locked` (no project).
- A month is reconciled and locked only after it ends (server date).
- Nightly check: `reconciliationsStillMatch(orgId)` lists completed reconciliations whose book balance
  at month end, read now, differs from the one recorded.
- Demo file: `docs/deep-dive/sample-bank-statement.csv` (October 2026, main USD bank, opening 0).

### Record a payment and Budget vs actual (built 24 Nov 2026)

- **Record a payment** (`/work/payments`, sidebar Work, beside Bills). Component
  `src/components/ledger/payments-page.tsx`; reads and roles `src/server/ledger-view.ts`; bank and
  cash set-up `src/server/ledger-setup.ts`; form schema `src/lib/ledger/screens.ts`.
- **Budget vs actual from the books**: a section at the foot of Budget (`/progress/budget`),
  `src/components/ledger/ledger-budget.tsx`. The workbook figures above it are unchanged. Budgets are
  in the line's currency, spending in the functional currency; where they differ the page says so
  and shows no "left" figure (no conversion).
- Routes under `api/projects/[code]/ledger/`: `payments` (GET form and lists, POST record),
  `drafts/[id]` (POST post or delete), `entries/[id]` (GET what it wrote), `entries/[id]/reverse`
  (POST), `budget-vs-actual` (GET; `?line=&donor=` for the entries behind a figure), `setup` (POST
  bank and cash accounts), `receipt/[hash]` (GET the receipt of a payment on this project).
- Who: recording a payment and reversing mirror Bills (HR role finance or bills, procurement role
  finance) plus project role finance-import. Posting a draft: Finance (HR role finance, procurement
  role finance, project role finance-import), never the recorder over the limit. Set-up: Finance or
  an administrator. Reads: staff on the project. Donors are refused.
- How a payment is written: memo `"<who was paid>: <what for>"`, the expense line's memo is "what
  for", source type `payment`, source id the receipt's file hash, expense account from the budget
  line's kind. Over the limit the route saves it as a draft and names who can post it. Idempotency
  key `payment:<person>:<key made once per form>`.
- The chart is seeded the first time a project's ledger page or Budget section loads. Without the
  ledger tables the routes answer 503 "The books are not switched on for this database yet".
- Tests: `src/server/__tests__/ledger-screens.db.test.ts`.

**Demo clicks.** As Yusuf (Finance officer): Projects, Work, Record a payment. If asked, "Set up the
bank and cash accounts". Attach any receipt, who was paid, what for, a budget line, amount 120,
"Record the payment". Open the row under "In the books" to see "What this wrote", or open "What
this writes" on the form before saving. Then Progress, Budget: the section "Budget vs actual from
the books" shows the line; open it, then "What this wrote" on the entry. Over the limit (500): save
as Yusuf, sign in as Omid (Accounting Manager), Record a payment, "Drafts to post", Post.

### Existing data, the CLI, the nightly check and the demo books (built 24 Nov 2026)

**What posts automatically.**

- A new row in `expenditures` posts through the ledger: `recordExpenditure` in
  `src/server/expenditure-store.ts` writes the expenditure, its posted payment entry (source
  `expenditure`, idempotency key `expenditure:<id>`, expense account from the budget line's kind, paid
  from 1010 unless said otherwise) and the addition to `budget_lines.spent` in ONE transaction
  (`also` in `server/ledger` `post`). When the ledger refuses (locked month, over the self-post limit
  without a second person, unknown account) the expenditure is not saved either, with the ledger's
  words. Nothing is queued.
- Today nothing in the app writes `expenditures`: Bills keeps its own record (project_state "bills",
  voucher posted in the accounting system) and Finance's workbook import writes `budget_lines.spent`
  directly as spending to date. Neither posts to the ledger. A bill payment that creates an expenditure
  must call `recordExpenditure`; no payables workflow was built.
- The demo project's books are written by the demo seed and reset (below).

**Where spent is read.** `src/server/ledger-spent.ts` `ledgerSpent(projectId)`: posted expense lines on
the project's budget lines, per line and month, in each budget line's own currency (the line's amount
when the currencies match; the functional amount when the budget is in the functional currency;
otherwise USD at the app's rate, `USD_PER`). Read by the budget (`plan-store loadBudget`, so the budget
API, procurement plan, activities and grants), the Budget page and Home (`budget-view-store`, the
overspend flags), the monthly review (its lines and the "already spent" check on a budget change) and
the quarterly and period reports (`qpr-store spendFor`, overspend explanations, pre-flight).
FALLBACK: a project with no posted spending in the ledger yet reads `budget_lines.spent` and the
import as before, so an existing project never shows zero. Same while migration 0027 is not applied,
or when a line's currency cannot be converted. `budget_lines.spent` is still written.

Watch: a project switches to the ledger as soon as ONE expense is posted on its budget lines. A real
project whose spending came only from the workbook would then drop to what the ledger holds. Before
recording payments on a real project, its spending to date must be in the ledger (question 18).

**The CLI** (never runs on its own; dry run unless `--apply`):

```
npm run ledger:post-expenditures                                  # dry run, every project
npm run ledger:post-expenditures -- --project A-2027              # one project
npm run ledger:post-expenditures -- --apply --by omid             # post, posted by that person
npm run ledger:post-expenditures -- --apply --by omid --paid-from 1000
```

Entries are recorded by `ledger-post-cli` and posted by `--by`, so the self-post limit does not
stop the migration. Running it again posts nothing twice. Rows in another currency than the
organization's own, and rows dated in a locked month, are listed and skipped. Dry run on test data:

```
DRY RUN: nothing written. Add --apply --by <person id> to post.
Paid from account 1010 (default for rows that do not say).
Expenditures: 4; to post 3; already in the ledger 0; skipped 1.
  skipped MIG-1 B 2026-08-31 AFN 7000.00: in AFN: the row has no rate to USD and no AFN bank account is assumed

Totals by project (before: budget_lines.spent and expenditures; ledger before and after):
  MIG-1: budget_lines.spent 4250.50; expenditures USD 4250.50, AFN 7000.00; ledger USD 0.00 -> 4250.50
```

**The nightly check.** `GET /api/cron/ledger-check` (vercel.json, 03:15 UTC; CRON_SECRET like the other
nightly jobs; listed with them in the middleware so the site password does not block it). For each
organization: the trial balance balances, and every completed reconciliation still matches the books
(`reconciliationsStillMatch`, server/reconciliation). The latest result is kept as organization_state
`ledger-check` `{ at, ok, problems[] }`; `latestLedgerCheck(orgId)` in `src/server/ledger-check.ts`
reads it for the leadership Week ahead.

**The demo's books and the demo reset.** `src/server/demo-ledger.ts`, run by `seedDatabase` and
`resetDemo("A-2027")`. Only in a demo organization (the demo project and nothing but sandbox or sample
projects); where A-2027 shares an organization with real projects nothing fictional is posted. Chart,
bank and cash accounts 1010 and 1000 (USD). On 1010 exactly what `sample-bank-statement.csv` shows for
October 2026 (Demo Foundation 25,000.00 on 1 Oct; 4,850.00, 2,300.00, 1,200.00 and 640.00), nothing
else on or before 31 October, and not the 15.00 bank charge (recorded live). The rest of the sample
spending is paid from 1020 (field bank, no statement in the demo), so the ledger holds what the demo
imports, line by line and month by month. Recorded by yusuf, posted by omid.

Posted entries are never deleted, so the reset uses the database's one exception:
`ledger_reset_demo(code, by)` (drizzle/0027_ledger.sql, SECURITY DEFINER, closed to the public API). It
refuses any project but A-2027, sets a transaction-local marker the triggers check together with the
project's code, deletes, and writes an audit_log row `ledger_demo_reset`. In a demo organization it
clears the organization's entries, locked months, reconciliations, statement lines and bank accounts;
in a shared organization only A-2027's own entries, and it refuses when one of them is in a locked
month or matched to a statement line. UPDATE of a posted entry or line is refused even inside it.
`seedDatabase` calls it before its TRUNCATE; any other posted books still stop the wipe.

## Questions for the accountant

Each has a default in use now, marked DEFAULT.

1. **Approval limit for posting one's own payment.** DEFAULT: 500 in the functional currency (the micro
   purchase limit). Is there a written figure? Should it differ by donor (the rule can be set per donor;
   the database check uses the organization's)?
2. **Does the limit apply to reversals too?** DEFAULT: yes, payments and reversals over the limit need a
   second person. Donor money received does not (question 6).
3. **Solo mode.** A small team may sign alone elsewhere in the app. DEFAULT: solo mode does not lift
   this limit. Right?
4. **Functional currency.** DEFAULT: USD for every organization. Is that right for a country office
   keeping books in AFN or GTQ?
5. **Which rate.** DEFAULT: the rate the person types for each payment (the bank's rate on the day).
   Should it be a monthly rate set by finance instead?
6. **Who may post donor money received.** DEFAULT: the person who records it, at any amount.
7. **What counts as restricted.** DEFAULT: donor grants (4000) and net assets with donor restrictions
   (3100) are restricted; gifts in kind (4200) and everything else are not.
8. **Release from restriction.** DEFAULT: no release entry is written when restricted money is spent;
   what is left of a donor's money is read as donor receipts less donor-marked spending. Should each
   payment (or each month) write a release entry?
9. **Grant money received before it is earned.** DEFAULT: receipts go straight to revenue (4000). Should
   advances under conditional or cost-reimbursable grants go to 2300 (money received but not yet earned)
   and move to revenue as it is spent?
10. **Account types and the chart.** DEFAULT: the 28 accounts in `src/lib/ledger/chart.ts`. Do the codes
    and names suit? Should program, personnel and operations map to 5000, 6000 and 7000?
11. **Rounding.** DEFAULT: the bank or cash side is converted once (half a cent rounds up) and the cents
    left are shared across the other lines by largest remainder. Acceptable, or should differences go to
    7400 Exchange differences?
12. **Reopening a locked month.** DEFAULT: never; corrections are dated in an open month. Is there a
    case for reopening with two signatures?
13. **Drafts left in a month being locked.** DEFAULT: the lock goes ahead and reports how many drafts
    are left; they can no longer post in that month. Should a lock be refused while drafts are open?
14. **Statement lines in a currency other than the bank's.** DEFAULT: not allowed; a bank account has one
    currency.
15. **Timing differences at month end.** The database completes a reconciliation only when the
    statement's closing balance equals the book balance (`difference = statement - book`, zero). A
    cheque written on the 31st and cashed on the 2nd keeps the month from completing. DEFAULT: the
    person dates the entry on the day the bank paid it. Should the reconciliation instead allow
    listed outstanding items (adjusted book balance), which needs a schema change?
16. **Locking with other bank accounts not reconciled.** The lock is for the whole organization.
    DEFAULT: Month close locks once the bank account in view is reconciled and names the other
    accounts not yet reconciled for that month. Should the lock wait for every bank account?

17. **Which account paid the old expenditures.** The `expenditures` rows do not say. DEFAULT: account
    1010 (main bank account), marked in `DEFAULT_PAID_FROM_CODE`; the CLI takes `--paid-from`. Right,
    or should some go to 1000 cash or 1020 the field bank?
18. **Spending to date on real projects.** Their spending is in the accounting system and comes in as
    the workbook's totals per line, not as transactions. DEFAULT: they stay on `budget_lines.spent`
    (no ledger entries). To move one to the ledger, should finance post one opening entry per budget
    line for spending to date (against which account?), or post the transactions from the accounting
    system?
19. **Old expenditures in another currency.** The rows carry no rate. DEFAULT: skipped by the CLI and
    listed. What rate, and which bank account in that currency?
20. **Workbook import once a project is on the ledger.** DEFAULT: the import still saves (reports keep
    its phases, missing months and overhead) but each line's spending comes from the ledger. Which is
    the book of record when they differ?
21. **Who posts migrated rows.** DEFAULT: recorded by the CLI, posted by the person named with `--by`.
    Should a second person check the dry run first?

## Out of scope (TODO, not built)

- Payables workflow beyond what Bills already does
- Staff advances (account 1200 exists; no workflow)
- Currency revaluation at month end
- Shared cost allocation across projects and donors
- Payroll journals
- Equipment register (account 1500 exists; no depreciation)
- Financial statements
- Consolidation across organizations or country offices
- Screens: Record a payment, Budget vs actual, Bank reconciliation in Month close
- A setting screen for the functional currency
- No longer writing `budget_lines.spent` (every reader now reads the ledger first; the column is kept
  as the fallback for projects not migrated)
- Posting real projects' spending to date (question 18)
