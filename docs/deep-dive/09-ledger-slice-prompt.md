# Prompt: the ledger slice (demo 10 January 2027)

Read CLAUDE.md, docs/deep-dive/08-page-review.md and src/db/schema.ts before writing anything.

## Goal
Build the first real slice of an audit-grade grant ledger inside the app. For the demo, one path must work end to end with real data, not sample text:
1. A person records a payment in plain words.
2. The app writes a balanced journal entry behind it and shows it on request.
3. Budget vs actual by donor and budget line updates from the ledger.
4. The finance person imports a bank statement, reconciles the month to a zero difference and locks the month.

People never have to see a debit or a credit. Accountants can.

## In scope
- Chart of accounts, journal entries and lines, fiscal periods with a lock, bank accounts, bank statement lines, reconciliations.
- Three actions: **record a payment** (expense paid from a bank or cash account), **record donor money received** (restricted by donor) and **reverse an entry**.
- Budget vs actual read from the ledger.
- Bank reconciliation as a step of Month close.

## Out of scope (do not build)
Payables workflow beyond what Bills already does, staff advances, currency revaluation, shared cost allocation, payroll journals, equipment register, financial statements, consolidation. Leave a TODO list of these in docs/deep-dive/09-finance.md.

## Data model (new Drizzle tables plus one migration)
- `ledger_accounts`: organization, code, name, type (asset, liability, net_assets, revenue, expense), restricted (bool), active.
- `journal_entries`: organization, project (nullable), entry_date, period (first of month), memo, source_type, source_id, status (draft, posted), recorded_by, posted_by, posted_at, reverses_id, idempotency_key (unique).
- `journal_lines`: entry, account, debit, credit, currency, fx_rate, functional_debit, functional_credit, donor, project, budget_line.
- `fiscal_periods`: organization, period, locked_at, locked_by.
- `bank_accounts`: organization, ledger_account, name, currency.
- `bank_statement_lines`: bank_account, date, description, amount, imported_by, matched_line (nullable).
- `reconciliations`: bank_account, period, statement_balance, book_balance, difference, completed_by, completed_at.

Money is `numeric`, never float. Amounts `numeric(16,2)`, rates `numeric(18,8)`. Functional currency comes from the organization (USD by default).

## Rules the database enforces (in the migration SQL, not only in code)
1. A line has a debit or a credit, never both, never negative.
2. A posted entry balances: functional debits equal functional credits. Use a deferred constraint trigger so lines can be inserted in one transaction.
3. A posted entry and its lines can never be updated or deleted. Corrections are reversals that point to the original.
4. Nothing posts into a locked period.
5. The person who recorded a payment cannot post it when the amount is over the organization's approval limit (read the limit from organization rules; add the setting if it is missing).

## Code layout
- `src/lib/ledger/rules.ts`: pure functions that turn an action into lines (`payment`, `donorReceipt`, `reversal`). No database access.
- `src/server/ledger.ts`: `post()` runs in one transaction, checks idempotency, writes an `audit_log` row per entry (actions `ledger_*`).
- Write the vitest tests for rules.ts and for each database rule **before** building any screen. Include: unbalanced entry rejected, edit of a posted line rejected, post into a locked month rejected, reversal nets to zero, self-approval over the limit rejected, idempotency key replay returns the first entry.
- Seed a default chart of about 25 accounts per organization. Map budget line `kind` (program, personnel, operations) to expense accounts.

## Existing data
- New entries in `expenditures` post through the ledger; the expenditure becomes the source document.
- `budget_lines.spent` must be read from the ledger. Keep the column until every page reads the ledger, then stop writing to it.
- Add a CLI (pattern of `src/db/park-cli.ts`) that posts existing expenditures as entries. Dry run by default; prints totals by project before and after.

## Screens (Ledger design language: ruled numbered rows, figures in a column, one gold-washed row)
- **Record a payment**: who was paid, what for, budget line, amount, currency and rate, paid from which account, receipt upload. A collapsed panel "What this writes" shows the journal lines.
- **Budget vs actual**: by donor and budget line, from the ledger, drill to the entries.
- **Bank reconciliation** inside Month close: import a CSV statement, match lines, show the difference, complete only at zero, then lock the month.
- Each screen carries one "Why this matters" line that says why the donor or auditor asks. Example: "Auditors reconcile every bank account every month. A difference nobody explained is the most common finding for a first grant."
- Keep sidebar changes minimal: Record a payment under Deliver beside Bills; reconciliation lives in Month close.

## Nightly check
A route plus Vercel cron that confirms the trial balance balances per organization and every completed reconciliation still matches. Failures show on the leadership Week ahead.

## Writing rules for every word in the app
No em dashes. Never a comma right before "and". Plain words, no sector jargon. Name the organization's accounting system only through `acct()`.

## Working rules
- No new npm packages without asking.
- Small commits, each one passing: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- Do not change unrelated pages.
- Do not guess on accounting judgement (account types, what counts as restricted, approval limits). Put each open question in a "Questions for the accountant" list in docs/deep-dive/09-finance.md and use a clearly marked default.
- When done, add a dated section to docs/deep-dive/08-page-review.md and write the demo script (the four steps above, with the clicks) in 09-finance.md.

## Done when
The four goal steps work on the demo project with real entries, all tests pass and a posted entry cannot be changed by any route, script or direct SQL update.
