import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { trialBalance } from "@/server/ledger";
import { reconciliationsStillMatch } from "@/server/reconciliation";
import { ledgerTablesExist } from "@/server/ledger-spent";

/**
 * The nightly check of the books (GET /api/cron/ledger-check, vercel.json): for each organization,
 * the trial balance balances, and every completed bank reconciliation still matches the books.
 * The latest result is kept as organization_state "ledger-check" so the leadership Week ahead can
 * say when something is wrong (`latestLedgerCheck`).
 */

export const LEDGER_CHECK_KEY = "ledger-check";

export type LedgerCheck = { at: string; ok: boolean; problems: string[] };

/** Problems with completed reconciliations of the organization: each one that no longer matches the books (server/reconciliation). */
async function reconciliationProblems(orgId: string): Promise<string[]> {
  const off = await reconciliationsStillMatch(orgId);
  return off.map(
    (r) =>
      `${r.bankAccount}, ${monthName(r.period)}: reconciled at ${money(r.bookBalanceThen, r.currency)} in the books, now ${money(r.bookBalanceNow, r.currency)} (statement ${money(r.statementBalance, r.currency)}${r.locked ? ", month locked" : ""}).`,
  );
}

const monthName = (period: string) => new Date(`${period.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const money = (v: string, currency: string) => `${currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Checks one organization's books now. Never throws: a failed read is itself a problem. */
export async function checkOrganization(orgId: string): Promise<LedgerCheck> {
  const problems: string[] = [];
  try {
    const tb = await trialBalance(orgId);
    if (!tb.balanced) problems.push(`The books do not balance: debits ${money(tb.totalDebit, tb.currency)}, credits ${money(tb.totalCredit, tb.currency)}.`);
  } catch (e) {
    problems.push(`The trial balance could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    problems.push(...(await reconciliationProblems(orgId)));
  } catch (e) {
    problems.push(`The bank reconciliations could not be checked: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { at: new Date().toISOString(), ok: problems.length === 0, problems };
}

async function save(orgId: string, check: LedgerCheck) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: LEDGER_CHECK_KEY, data: check })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data: check, updatedAt: new Date() } });
}

/** Checks every organization and keeps each one's result. */
export async function runLedgerCheck(): Promise<{ organizations: number; failed: number; skipped?: string; results: { organizationId: string; ok: boolean; problems: string[] }[] }> {
  if (!(await ledgerTablesExist())) return { organizations: 0, failed: 0, skipped: "The ledger tables are not in this database yet.", results: [] };
  const orgs = await db.select({ id: s.organizations.id }).from(s.organizations);
  const results = [];
  for (const o of orgs) {
    const check = await checkOrganization(o.id);
    await save(o.id, check);
    results.push({ organizationId: o.id, ok: check.ok, problems: check.problems });
  }
  return { organizations: orgs.length, failed: results.filter((r) => !r.ok).length, results };
}

/** The latest nightly check of an organization's books, or null when it has never run. */
export async function latestLedgerCheck(orgId: string): Promise<LedgerCheck | null> {
  const [row] = await db
    .select({ data: s.organizationState.data })
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, LEDGER_CHECK_KEY)))
    .limit(1);
  return (row?.data as LedgerCheck | undefined) ?? null;
}
