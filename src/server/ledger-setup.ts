import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { accountByCode, ledgerSettings, seedChart } from "@/server/ledger";

/**
 * Getting an organization's books ready for the ledger screens: the chart of accounts (made the
 * first time a project's ledger page loads) and the bank and cash accounts payments are made from
 * (made by Finance or an administrator with one click).
 */

/** Seeds the default chart when the organization has none yet. Safe to call on every page load. */
export async function ensureChart(orgId: string): Promise<void> {
  const [one] = await db.select({ id: s.ledgerAccounts.id }).from(s.ledgerAccounts).where(eq(s.ledgerAccounts.organizationId, orgId)).limit(1);
  if (!one) await seedChart(orgId);
}

export type MoneyAccount = { bankAccountId: string; ledgerAccountId: string; code: string; name: string; currency: string };

/** The organization's open bank and cash accounts, by account code. */
export async function moneyAccounts(orgId: string): Promise<MoneyAccount[]> {
  const rows = await db
    .select({ bankAccountId: s.bankAccounts.id, ledgerAccountId: s.ledgerAccounts.id, code: s.ledgerAccounts.code, name: s.bankAccounts.name, currency: s.bankAccounts.currency })
    .from(s.bankAccounts)
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.bankAccounts.ledgerAccountId))
    .where(and(eq(s.bankAccounts.organizationId, orgId), eq(s.bankAccounts.active, true), eq(s.ledgerAccounts.active, true)))
    .orderBy(asc(s.ledgerAccounts.code));
  return rows;
}

/** The two accounts the one-click set-up makes: the main bank account and cash on hand, both in the organization's own currency. */
const STARTER = [
  { code: "1010", name: "Main bank account" },
  { code: "1000", name: "Cash on hand" },
] as const;

/**
 * Makes the bank and cash accounts payments are paid from (accounts 1010 and 1000 in the chart),
 * in the functional currency. Running it again adds nothing. One audit row when something was made.
 */
export async function setUpBankAndCash(orgId: string, by: string): Promise<{ created: number }> {
  await ensureChart(orgId);
  const { functionalCurrency } = await ledgerSettings(orgId);
  const targets: { ledgerAccountId: string; name: string }[] = [];
  for (const t of STARTER) {
    const a = await accountByCode(orgId, t.code);
    if (a) targets.push({ ledgerAccountId: a.id, name: t.name });
  }
  if (!targets.length) return { created: 0 };
  return db.transaction(async (tx) => {
    const made = await tx
      .insert(s.bankAccounts)
      .values(targets.map((t) => ({ organizationId: orgId, ledgerAccountId: t.ledgerAccountId, name: t.name, currency: functionalCurrency })))
      .onConflictDoNothing()
      .returning({ id: s.bankAccounts.id });
    if (made.length)
      await tx.insert(s.auditLog).values({ projectId: null, entity: "bank_account", entityId: made[0].id, action: "ledger_bank_accounts_set_up", detail: { by, organizationId: orgId, created: made.length, currency: functionalCurrency } });
    return { created: made.length };
  });
}
