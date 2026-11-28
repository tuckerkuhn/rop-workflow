import { z } from "zod";

/**
 * The payment accounts register (review round 1, MF-06; Q3 audit finding 2). Every bank, mobile
 * money or cash account the organization pays from is recorded with its owner and type. An account
 * is only ever in the organization's own name, never a person's. Adding one or changing one takes
 * two people: one proposes, a different person confirms, and only then does it take effect. Cash is
 * flagged wherever it funds a payment, because cash leaves the thinnest trail.
 *
 * Kept in organization_state ("payment-accounts"), beside the ledger's bank accounts it describes.
 */

export const ACCOUNTS_KEY = "payment-accounts";
export const ACCOUNT_TYPES = { bank: "Bank account", mobile: "Mobile money", cash: "Cash box" } as const;
export type AccountType = keyof typeof ACCOUNT_TYPES;

export const accountDetails = z.object({
  /** The ledger's bank or cash account this describes (bank_accounts.id). */
  account: z.string().uuid(),
  /** The legal owner as the bank has it: must be the organization. */
  owner: z.string().trim().min(2).max(200),
  type: z.enum(["bank", "mobile", "cash"]),
  institution: z.string().trim().max(200).optional(),
  /** The last four digits only: the full number is never kept here. */
  last4: z.string().regex(/^\d{4}$/, "The last four digits of the account number.").optional(),
  /** Who may sign for it (person ids). */
  signatories: z.array(z.string().min(1).max(60)).max(10),
  note: z.string().trim().max(500).optional(),
});
export type AccountDetails = z.infer<typeof accountDetails>;

export type Change = { id: string; details: AccountDetails; by: string; byName: string; at: string; reason: string };
export type Registered = AccountDetails & { proposedBy: string; confirmedBy: string; confirmedAt: string };
export type AccountsState = { accounts: Record<string, Registered>; pending: Change[]; history: (Change & { confirmedBy: string; confirmedAt: string })[] };
export const EMPTY_ACCOUNTS: AccountsState = { accounts: {}, pending: [], history: [] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Why these details cannot be proposed, or null. The owner must be the organization itself. */
export function detailsProblem(d: AccountDetails, orgName: string): string | null {
  if (norm(d.owner) !== norm(orgName)) return `An account the organization pays from is in its own name ("${orgName}"), never a person's or another body's.`;
  if (d.type !== "cash" && !d.institution) return "Name the bank or mobile money provider.";
  if (!d.signatories.length) return "Name at least one person who may sign for it.";
  return null;
}

/** Why this person may not confirm this change, or null: the second person is never the first. */
export const confirmProblem = (c: Change, me: string) => (c.by === me ? "A second person confirms: you proposed this change." : null);

/** What to watch on an account: cash, or not in the register at all. */
export function accountFlags(reg: Registered | undefined): string[] {
  if (!reg) return ["Not in the payment accounts register yet: its owner and type are not recorded."];
  return reg.type === "cash" ? ["Cash: payments from it leave the thinnest trail. Keep a receipt for each one."] : [];
}
