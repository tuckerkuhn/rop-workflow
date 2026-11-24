import { asc, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { realToday } from "@/lib/clock";
import type { Bva } from "@/lib/bva";
import { DEMO_FUNDING } from "@/server/demo-report";
import { accountByCode, expenseAccountFor, postDonorReceipt, postPayment, seedChart } from "@/server/ledger";
import { setUpBankAndCash } from "@/server/ledger-setup";
import { ledgerTablesExist, markBooksKept } from "@/server/ledger-spent";

/**
 * The demo project's books (A-2027), all fictional:
 *
 * 1. The main bank account (1010, USD) holds exactly what the sample bank statement shows for
 *    October 2026 (docs/deep-dive/sample-bank-statement.csv), so Month close reconciles October to a
 *    zero difference: the Demo Foundation's first tranche and four payments. Nothing else is posted
 *    to 1010 on or before 31 October 2026 (its opening balance is 0). The statement's 15.00 bank
 *    charge is NOT posted: the demo records it live.
 * 2. The rest of the demo's sample spending is posted from the field bank account (1020, which has no
 *    bank statement in the demo), so each budget line's spending in the ledger, month by month, is
 *    the spending the demo imports from its sample workbook (`demoBooksSpending`): every page reads
 *    the same figures from the ledger as from the import, and Budget vs actual is not empty.
 *
 * Only in a demo organization (the database's ledger_is_demo_org: the demo project and nothing but
 * fictional projects). Where the demo shares an organization with real projects, fictional payments
 * would land in that organization's real bank account and its reconciliation: nothing is written.
 *
 * Safe to run again: each entry has its own idempotency key.
 */

/** Who "recorded" and who "posted" the demo's entries (fictional demo people): each payment is over the self-post limit, so two people. */
export const DEMO_LEDGER_BY = "yusuf";
export const DEMO_LEDGER_POSTED_BY = "omid";

const DEMO_DONOR = "Demo Foundation (fictional)";

/** October 2026 on the main bank account, as the sample statement shows it (fixed dates: the statement is fixed). */
export const DEMO_STATEMENT_MONTH = "2026-10";
export const DEMO_STATEMENT_RECEIPT = { date: "2026-10-01", amount: "25000.00", donor: DEMO_DONOR, memo: "Demo Foundation (fictional) first tranche" } as const;
export const DEMO_STATEMENT_PAYMENTS = [
  { date: "2026-10-03", line: "2.1", amount: "4850.00", memo: "Seed, first lot: Kabul Seed Company (fictional), cheque 1001" },
  { date: "2026-10-08", line: "2.2", amount: "2300.00", memo: "Fertilizer, first lot: Pamir Fertilizer Traders (fictional)" },
  { date: "2026-10-15", line: "5.2", amount: "1200.00", memo: "Office rent, October" },
  { date: "2026-10-18", line: "4.1", amount: "640.00", memo: "Training venue and lunch (fictional)" },
] as const;

/** Money received into the field bank account, which pays the rest of the sample spending (fictional). */
const FIELD_RECEIPTS: Record<string, string> = { [DEMO_DONOR]: "60000.00", "Agri Futures Fund (fictional)": "15000.00" };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The demo's sample workbook (lib/demo-design demoSpending) with October raised where a statement
 * payment is more than the sample has for that line in October. The demo imports this, and its
 * ledger holds the same figures, line by line and month by month.
 */
export function demoBooksSpending(sample: Bva | null): Bva | null {
  if (!sample || !sample.months.includes(DEMO_STATEMENT_MONTH)) return sample;
  const fixed = (code: string) => DEMO_STATEMENT_PAYMENTS.filter((p) => p.line === code).reduce((t, p) => t + Number(p.amount), 0);
  const lines = sample.lines.map((l) => {
    const months: Record<string, number> = { ...l.months, [DEMO_STATEMENT_MONTH]: Math.max(l.months[DEMO_STATEMENT_MONTH] ?? 0, fixed(l.code)) };
    return { ...l, months, actual: round2(Object.values(months).reduce((a, b) => a + b, 0)) };
  });
  const sum = (f: (l: (typeof lines)[number]) => number) => round2(lines.reduce((t, l) => t + f(l), 0));
  const totals = { budget: sum((l) => l.budget), actual: sum((l) => l.actual), months: Object.fromEntries(sample.months.map((m) => [m, sum((l) => l.months[m] ?? 0)])) };
  return { ...sample, lines, totals: { costs: totals, overhead: null, grand: totals } };
}

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

/** Whether the organization holds the demo project and only fictional projects besides (migration 0027). */
export async function isDemoOrganization(orgId: string): Promise<boolean> {
  const [r] = rowsOf<{ ok: boolean }>(await db.execute(sql`SELECT ledger_is_demo_org(${orgId}::uuid) AS ok`));
  return !!r?.ok;
}

/**
 * Removes the demo project's ledger rows so the demo can start again, through the database's one
 * audited exception (ledger_reset_demo in drizzle/0027_ledger.sql): posted entries are otherwise
 * never deleted. Does nothing while the ledger tables are not in the database.
 */
export async function resetDemoLedger(code: string, by: string): Promise<Record<string, unknown> | null> {
  if (!(await ledgerTablesExist())) return null;
  const [r] = rowsOf<{ result: Record<string, unknown> }>(await db.execute(sql`SELECT ledger_reset_demo(${code}, ${by}) AS result`));
  return r?.result ?? null;
}

/** Writes the demo's books (see the top of this file). `spending`: what the demo imported (demoBooksSpending). */
export async function seedDemoLedger(projectId: string, organizationId: string, spending: Bva | null, today = realToday()): Promise<{ receipts: number; payments: number; skipped?: string }> {
  const none = (skipped: string) => ({ receipts: 0, payments: 0, skipped });
  if (!(await ledgerTablesExist())) return none("The ledger tables are not in this database yet.");
  if (!(await isDemoOrganization(organizationId))) return none("The demo project shares its organization with real projects: no fictional entries in its books.");

  await seedChart(organizationId);
  await setUpBankAndCash(organizationId, DEMO_LEDGER_BY);
  const bank = await accountByCode(organizationId, "1010");
  const field = await accountByCode(organizationId, "1020");
  if (!bank || !field) return none("No accounts 1010 and 1020 in the chart.");
  const [bankRow] = await db.select().from(s.bankAccounts).where(eq(s.bankAccounts.ledgerAccountId, bank.id)).limit(1);
  // The sample statement and spending are in US dollars; another currency would need a rate.
  if (bankRow && bankRow.currency !== "USD") return none(`The main bank account holds ${bankRow.currency}; the demo statement is in USD.`);

  const donors = await db.select({ id: s.donors.id, name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, projectId)).orderBy(asc(s.donors.createdAt));
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId));
  const donorId = (name: string) => donors.find((d) => d.name === name)?.id ?? null;
  const donorOfLine = (code: string) => donorId(Object.entries(DEMO_FUNDING).find(([, f]) => f.lines.includes(code) || f.share.includes(code))?.[0] ?? "");
  const who = (key: string) => ({ organizationId, recordedBy: DEMO_LEDGER_BY, postedBy: DEMO_LEDGER_POSTED_BY, idempotencyKey: `demo-ledger:${projectId}:${key}` });
  const pay = async (key: string, from: string, date: string, memo: string, code: string, amount: string) => {
    const line = lines.find((x) => x.code === code);
    const expense = line && (await expenseAccountFor(organizationId, line.kind));
    if (!line || !expense) return false;
    await postPayment(who(key), { date, memo, paidFrom: from, currency: "USD", fxRate: "1", projectId, expenses: [{ accountId: expense.id, amount, donorId: donorOfLine(code), projectId, budgetLineId: line.id }] });
    return true;
  };

  let receipts = 0;
  let payments = 0;
  // 1. October on the main bank account, as the statement shows it.
  const demoDonor = donorId(DEMO_STATEMENT_RECEIPT.donor);
  if (demoDonor && DEMO_STATEMENT_RECEIPT.date <= today) {
    await postDonorReceipt(who("statement:receipt"), { date: DEMO_STATEMENT_RECEIPT.date, memo: DEMO_STATEMENT_RECEIPT.memo, depositedTo: bank.id, donorId: demoDonor, projectId, currency: "USD", fxRate: "1", amount: DEMO_STATEMENT_RECEIPT.amount });
    receipts++;
  }
  for (const p of DEMO_STATEMENT_PAYMENTS) if (p.date <= today && (await pay(`statement:${p.date}:${p.line}`, bank.id, p.date, p.memo, p.line, p.amount))) payments++;

  // 2. The rest of the sample spending, from the field bank account.
  if (spending?.months.length) {
    const firstDay = `${spending.months[0]}-01`;
    for (const [name, amount] of Object.entries(FIELD_RECEIPTS)) {
      const id = donorId(name);
      if (!id) continue;
      await postDonorReceipt(who(`field:receipt:${id}`), { date: firstDay, memo: `${name}: transfer for field spending`, depositedTo: field.id, donorId: id, projectId, currency: "USD", fxRate: "1", amount });
      receipts++;
    }
    for (const l of spending.lines) {
      for (const [month, value] of Object.entries(l.months)) {
        const fixed = month === DEMO_STATEMENT_MONTH ? DEMO_STATEMENT_PAYMENTS.filter((p) => p.line === l.code && p.date <= today).reduce((t, p) => t + Number(p.amount), 0) : 0;
        const rest = round2(value - fixed);
        if (!(rest > 0)) continue;
        const label = new Date(`${month}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
        const description = lines.find((x) => x.code === l.code)?.description ?? l.description;
        if (await pay(`field:${l.code}:${month}`, field.id, `${month}-15`, `${description}, ${label} (fictional)`, l.code, rest.toFixed(2))) payments++;
      }
    }
  }
  // The demo's pages read its spending from these books (ledger-spent BOOKS_KEY).
  await markBooksKept(projectId, "demo books");
  return { receipts, payments };
}
