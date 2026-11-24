/**
 * Posts the existing rows of `expenditures` to the grant ledger, one payment entry each (source
 * "expenditure", idempotency key `expenditure:<id>`). Never runs on its own: someone runs it.
 *
 *   npm run ledger:post-expenditures                                  dry run: what would post, totals before and after
 *   npm run ledger:post-expenditures -- --project A-2027              one project only
 *   npm run ledger:post-expenditures -- --apply --by daniel           write the entries, posted by that person
 *   npm run ledger:post-expenditures -- --apply --by daniel --paid-from 1000
 *
 * A DRY RUN unless --apply is given. Running it again posts nothing twice. The old rows do not say
 * which account paid: they are posted as paid from 1010 (main bank account) unless --paid-from names
 * another (a DEFAULT for the accountant to confirm, docs/deep-dive/09-finance.md). Rows in another
 * currency than the organization's own, or dated in a locked month, are listed and skipped.
 */
import { postExistingExpenditures, type PostingRun } from "@/server/expenditure-store";
import { ledgerTablesExist } from "@/server/ledger-spent";

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function printRun(run: PostingRun, log: (line: string) => void = console.log) {
  log(run.apply ? "APPLIED: entries written to the ledger." : "DRY RUN: nothing written. Add --apply --by <person id> to post.");
  log(`Paid from account ${run.paidFrom} (default for rows that do not say).`);
  const count = (st: string) => run.rows.filter((r) => r.status === st).length;
  log(`Expenditures: ${run.rows.length}; ${run.apply ? "posted now" : "to post"} ${count("post")}; already in the ledger ${count("posted")}; skipped ${count("skip")}.`);
  for (const r of run.rows.filter((x) => x.status === "skip")) log(`  skipped ${r.project} ${r.budgetLine} ${r.spentOn} ${r.currency} ${r.amount}: ${r.why}`);
  log("");
  log("Totals by project (before: budget_lines.spent and expenditures; ledger before and after):");
  for (const p of run.projects) {
    const exps = Object.entries(p.expenditures).map(([c, v]) => `${c} ${v}`).join(", ") || "none";
    log(`  ${p.project}: budget_lines.spent ${p.budgetLinesSpent}; expenditures ${exps}; ledger ${p.currency} ${p.ledgerBefore} -> ${p.ledgerAfter}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  if (!(await ledgerTablesExist())) throw new Error("The ledger tables are not in this database yet (migration drizzle/0027_ledger.sql).");
  const run = await postExistingExpenditures({ apply, by: arg("--by"), project: arg("--project"), paidFromCode: arg("--paid-from") });
  printRun(run);
}

if (!process.env.VITEST)
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
