import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { holdsType } from "@/lib/authority";
import { ACCOUNTS_KEY, confirmProblem, detailsProblem, type AccountDetails, type AccountsState } from "@/lib/payment-accounts";
import { HttpError } from "@/server/guard";
import { moneyAccounts } from "@/server/ledger-setup";

/** The payment accounts register (lib/payment-accounts, MF-06): one document per organization. */

/** Finance, the CFO and administrators keep the register; a change needs two of them. */
export const mayKeepAccounts = (u: AppUser) => u.kind === "employee" && (!!u.admin || u.procurement.includes("finance") || holdsType(u.id, "finance") || holdsType(u.id, "cfo"));

export async function loadAccounts(orgId: string): Promise<AccountsState> {
  const [row] = await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, ACCOUNTS_KEY))).limit(1);
  const d = (row?.data as Partial<AccountsState> | undefined) ?? {};
  return { accounts: d.accounts ?? {}, pending: d.pending ?? [], history: d.history ?? [] };
}

async function save(orgId: string, data: AccountsState) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: ACCOUNTS_KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

const orgName = async (orgId: string) => (await db.select({ name: s.organizations.name }).from(s.organizations).where(eq(s.organizations.id, orgId)).limit(1))[0]?.name ?? "";

/** Proposes adding or changing an account's entry; it takes effect when someone else confirms. */
export async function proposeAccount(orgId: string, d: AccountDetails, reason: string, by: AppUser) {
  if (!mayKeepAccounts(by)) throw new HttpError(403, "Only Finance, the CFO or an administrator keeps the payment accounts register.");
  if (!(await moneyAccounts(orgId)).some((m) => m.bankAccountId === d.account)) throw new HttpError(400, "That is not one of the organization's bank or cash accounts.");
  const problem = detailsProblem(d, await orgName(orgId));
  if (problem) throw new HttpError(400, problem);
  // R2-26: a signatory is someone on the staff, chosen from the list.
  const staff = new Set((await (await import("@/server/auth")).people()).filter((p) => p.kind === "employee").map((p) => p.id));
  const stranger = d.signatories.find((x) => !staff.has(x));
  if (stranger) throw new HttpError(400, `Choose each signatory from the staff list ("${stranger}" is not on it).`);
  const cur = await loadAccounts(orgId);
  if (cur.pending.some((c) => c.details.account === d.account)) throw new HttpError(409, "A change to this account is already waiting for a second person.");
  const change = { id: randomUUID(), details: d, by: by.id, byName: by.name, at: new Date().toISOString(), reason };
  await save(orgId, { ...cur, pending: [...cur.pending, change] });
  await db.insert(s.auditLog).values({ projectId: null, entity: "payment_account", entityId: change.id, action: "payment_account_proposed", detail: { by: by.id, account: d.account, owner: d.owner, type: d.type, reason } });
  return change;
}

/** A second, different person confirms (the change takes effect) or turns it down. */
export async function decideAccount(orgId: string, changeId: string, confirm: boolean, by: AppUser) {
  if (!mayKeepAccounts(by)) throw new HttpError(403, "Only Finance, the CFO or an administrator keeps the payment accounts register.");
  const cur = await loadAccounts(orgId);
  const c = cur.pending.find((x) => x.id === changeId);
  if (!c) throw new HttpError(404, "That change is no longer waiting.");
  const why = confirmProblem(c, by.id);
  if (why) throw new HttpError(403, why);
  const at = new Date().toISOString();
  const next: AccountsState = confirm
    ? { accounts: { ...cur.accounts, [c.details.account]: { ...c.details, proposedBy: c.by, confirmedBy: by.id, confirmedAt: at } }, pending: cur.pending.filter((x) => x.id !== c.id), history: [...cur.history, { ...c, confirmedBy: by.id, confirmedAt: at }] }
    : { ...cur, pending: cur.pending.filter((x) => x.id !== c.id) };
  await save(orgId, next);
  await db.insert(s.auditLog).values({ projectId: null, entity: "payment_account", entityId: c.id, action: confirm ? "payment_account_confirmed" : "payment_account_turned_down", detail: { by: by.id, account: c.details.account, proposedBy: c.by } });
  return next;
}
