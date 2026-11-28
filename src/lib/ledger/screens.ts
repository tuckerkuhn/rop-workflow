import { z } from "zod";
import { receiptSchema } from "@/lib/expense";

/**
 * What the ledger screens send: Record a payment, post or delete a draft, reverse an entry. Shared
 * by the screens and their API routes (api/projects/[code]/ledger/...).
 */

const amount = z.string().trim().regex(/^\d{1,14}(\.\d{1,2})?$/, "Enter the amount, with at most two decimals.");
const rate = z.string().trim().regex(/^\d{1,10}(\.\d{1,8})?$/, "Enter the exchange rate, a number with at most 8 decimals.");
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date.");
const uuid = z.string().uuid();
/** Made once per form in the browser, so a double click or a retried request never posts twice. */
const key = z.string().trim().min(8).max(120);

export const paymentSchema = z.object({
  idempotencyKey: key,
  payee: z.string().trim().min(2, "Say who was paid.").max(200),
  what: z.string().trim().min(3, "Say what the payment was for.").max(300),
  budgetLineId: uuid,
  donorId: uuid.nullable().optional(),
  amount,
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Choose the currency."),
  fxRate: rate,
  paidFrom: uuid,
  date: iso,
  receipt: receiptSchema,
  /** Why this is not one of the purchases still open on its budget line (lib/ledger/payment-guard). */
  notAPurchase: z.string().trim().max(300).nullable().optional(),
  /** The money was handed to someone other than the payee: who, the payee's written authorization, and when the receiver was screened. */
  thirdParty: z
    .object({ receivedBy: z.string().trim().min(2, "Say who received the money.").max(200), authorization: receiptSchema, screenedOn: iso })
    .nullable()
    .optional(),
});
export type PaymentForm = z.infer<typeof paymentSchema>;

export const draftActionSchema = z.object({ action: z.enum(["post", "delete"]) });

export const reverseSchema = z.object({
  idempotencyKey: key,
  reason: z.string().trim().min(3, "Say why the entry is being reversed.").max(300),
  date: iso.optional(),
});

/** What a save did: posted to the books, or kept as a draft for someone else to post (with their names). */
export type SaveOutcome = { outcome: "posted" | "draft"; entryId: string; replayed: boolean; whoCanPost: string[]; /** MF-06: what to watch on the account it was paid from (cash, or not in the register). */ warnings?: string[] };

/** A fresh key for one form. */
export function newKey(prefix: string): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${r}`;
}
