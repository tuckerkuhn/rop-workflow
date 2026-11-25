import { z } from "zod";
import type { PaymentRecord } from "@/lib/payments";
import type { Procurement } from "@/lib/procurement";

/**
 * A bill or a purchase in the books. Finance is shown an entry filled in from the bill or the
 * purchase and posts it with one press. Nothing is typed twice and nothing posts by itself.
 * The record kept on the bill or the purchase points to the entry, and the entry's source
 * points back, so each is found from the other.
 */

/** One posting of a bill or a purchase payment, kept on that bill or payment. */
export type Posting = {
  /** 1 for the first posting, 2 for the corrected one after a reversal, and so on. */
  n: number;
  entryId: string;
  expenditureId: string;
  /** The date in the books. */
  date: string;
  /** The bank or cash account it was paid from: chart code and name. */
  paidFrom: string;
  paidFromName: string;
  /** The budget line it was charged to. */
  budgetLine: string;
  /** As posted, in the currency it was posted in. */
  amount: string;
  currency: string;
  by: string;
  name: string;
  at: string;
};

/** What the ledger says of a posting today. A reversal is read from the books, never kept twice. */
export type PostingState = Posting & {
  /** The reversing entry, when there is one: posted, or waiting as a draft for a second person. */
  reversal: { entryId: string; posted: boolean; by: string; date: string; reason: string } | null;
};

/** The posting that stands in the books: the last one, when it was not reversed. */
export function standing(postings: PostingState[]): PostingState | null {
  const last = postings[postings.length - 1];
  return last && !last.reversal?.posted ? last : null;
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date.");
/** What Finance sends with the one press: the date paid and the account it was paid from. */
export const postFields = {
  date: iso,
  paidFrom: z.string().trim().regex(/^\d{3,6}$/, "Choose the bank or cash account the money was paid from."),
  /** Only for a corrected entry after a reversal: another budget line than the one on the bill or purchase. */
  budgetLine: z.string().trim().max(40).optional(),
};

/** The entry Finance is shown before posting, filled in from the bill or the purchase. */
export type FilledEntry = {
  payee: string;
  what: string;
  /** The project whose budget line it is charged to. */
  project: string;
  budgetLine: string;
  budgetLineName: string;
  date: string;
  amount: number;
  currency: string;
  /** In US dollars at the rate recorded on the bill or the payment. */
  usd: number;
};

/** One unit of `currency` in dollars, at the rate recorded on the document: at most 8 decimals, as the ledger takes it. */
export function recordedRate(amount: number, usd: number): string {
  if (!(amount > 0) || !(usd > 0)) return "1";
  return (usd / amount).toFixed(8);
}

/* ---------------- A purchase payment ---------------- */

/** The budget line a purchase is charged to: the calendar's line when it was started from the calendar. */
export const purchaseLine = (p: Pick<Procurement, "plan" | "budgetLine">) => p.plan?.budgetCode ?? p.budgetLine ?? "";

/**
 * Why a paid instalment does not go to the books, or null when it can. A purchase counts as spent
 * when it is recorded as paid: the payment record holds the date and the bank reference.
 */
export function paymentBooksProblem(p: Procurement, r: PaymentRecord): string | null {
  if (!r.paid?.date || !r.paid.ref?.trim()) return "A purchase goes to the books once its payment is recorded.";
  if (!(r.invoice.amount > 0)) return "This payment has no invoice amount, so there is nothing to post.";
  if (!purchaseLine(p)) return "This purchase is charged to no budget line, so it does not go to the project's books.";
  if ((r.invoice.currency ?? "USD") !== "USD" && !(Number(r.invoice.rate) > 0)) return "The invoice is in afghani and has no rate recorded, so it cannot be written to the books.";
  return null;
}

/**
 * The entry Finance is shown for a paid instalment, every part of it from the purchase: the
 * supplier, the budget line, the day it was paid and the invoice amount before tax is withheld
 * (what the budget line is charged). An afghani invoice uses the rate recorded on it.
 */
export function paymentEntry(p: Procurement, r: PaymentRecord, project: string, lineName: string): FilledEntry {
  const currency = r.invoice.currency ?? "USD";
  const usd = currency === "USD" ? r.invoice.amount : Number(r.invoice.rate) > 0 ? Math.round((r.invoice.amount / Number(r.invoice.rate)) * 100) / 100 : 0;
  return { payee: r.supplier, what: `${p.title}, payment ${r.n} of ${p.id}${r.invoice.number ? ` (invoice ${r.invoice.number})` : ""}`, project, budgetLine: purchaseLine(p), budgetLineName: lineName, date: r.paid.date, amount: r.invoice.amount, currency, usd };
}
