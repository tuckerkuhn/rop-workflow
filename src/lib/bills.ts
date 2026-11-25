import { z } from "zod";
import { selfSchema } from "@/lib/solo";
import { receiptSchema, type Receipt } from "@/lib/expense";

/**
 * Bills paid directly, outside procurement: rent under a lease, utilities, internet and phones,
 * insurance premiums, professional services under an agreement. Someone records the bill with
 * the document attached; programme management approves it (never the person who recorded it);
 * Finance prepares the voucher, files it in SharePoint and posts it in NetSuite; it then counts
 * in the monthly closeout. A one-off purchase of goods or services is not a bill: it goes
 * through procurement.
 */

/** GL codes from ROP's chart of accounts (Finance and Accounting Procedure Manual 2020, §19). */
export const BILL_CATEGORIES = {
  rent: { label: "Rent", gl: "6030" },
  utilities: { label: "Utilities (power, water)", gl: "6050" },
  generator: { label: "Generator fuel", gl: "6060" },
  maintenance: { label: "Facility maintenance", gl: "6070" },
  vehicleRental: { label: "Vehicle rental", gl: "6100" },
  landline: { label: "Land lines", gl: "6120" },
  mobile: { label: "Mobile phones", gl: "6130" },
  internet: { label: "Internet", gl: "6150" },
  insurance: { label: "Insurance", gl: "6170" },
  medical: { label: "Staff medical insurance", gl: "5120" },
  professional: { label: "Professional services (audit, legal) under an agreement", gl: "6260" },
  bankFees: { label: "Bank fees", gl: "6240" },
  other: { label: "Other", gl: "6360" },
} as const;
export type BillCategory = keyof typeof BILL_CATEGORIES;
export const BILL_CATEGORY_KEYS = Object.keys(BILL_CATEGORIES) as BillCategory[];

export type BillStatus = "waiting" | "approved" | "returned" | "filed";
export type Sign = { by: string; name: string; at: string };

export type Bill = {
  id: string;
  payee: string;
  invoiceNumber: string;
  invoiceDate: string;
  description: string;
  category: BillCategory;
  amount: number;
  currency: "USD" | "AFN";
  /** For the closeout total. */
  usd: number;
  /** Funding source (a project code, or non-contract). */
  source: string;
  budgetLine: string | null;
  /** The lease, contract or agreement the bill is under, if any. */
  contractRef: string | null;
  file: Receipt;
  /** The sent-back bill this one corrects, when it was recorded again from it. */
  replaces?: string;
  raised: Sign;
  status: BillStatus;
  approval?: Sign & { selfApproved?: boolean; soloNote?: string };
  returned?: Sign & { note: string };
  voucher?: { number: string; month: string; sharepointUrl: string; netsuiteRef: string } & Sign;
  timeline: { date: string; who: string; what: string }[];
};

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const raiseSchema = z.object({
  action: z.literal("raise"),
  payee: z.string().trim().min(2).max(160),
  invoiceNumber: z.string().trim().min(1).max(60),
  invoiceDate: iso,
  description: z.string().trim().min(3).max(300),
  category: z.enum(BILL_CATEGORY_KEYS as [BillCategory, ...BillCategory[]]),
  amount: z.number().positive().max(1e9),
  currency: z.enum(["USD", "AFN"]),
  source: z.string().regex(/^[A-Za-z0-9-]{2,40}$/),
  budgetLine: z.string().trim().max(40).nullable(),
  contractRef: z.string().trim().max(120).nullable(),
  file: receiptSchema,
  /** Recorded again in place of a bill that was sent back. */
  replaces: z.string().max(20).optional(),
});
export const billActionSchema = z.discriminatedUnion("action", [
  raiseSchema,
  /** `self`: solo mode, the person who recorded it approves it, confirming that (server/solo.ts). */
  z.object({ action: z.literal("approve"), id: z.string(), self: selfSchema.optional() }),
  z.object({ action: z.literal("return"), id: z.string(), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("voucher"), id: z.string(), number: z.string().trim().min(1).max(40), month: z.string().regex(/^\d{4}-\d{2}$/), sharepointUrl: z.string().trim().max(500), netsuiteRef: z.string().trim().max(80) }),
]);
export type BillAction = z.infer<typeof billActionSchema>;

/** What an approver should look at twice. */
export function billFlags(b: Bill, all: Bill[], microMaxUsd: number): string[] {
  const out: string[] = [];
  if (!b.contractRef && b.usd > microMaxUsd) out.push(`Over $${microMaxUsd.toLocaleString("en-US")} with no lease, contract or agreement named: a purchase this size may need to go through procurement.`);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // A bill sent back is not paid, so it is not a second payment of anything.
  const dup = b.status === "returned" ? undefined : all.find((x) => x.id !== b.id && x.status !== "returned" && norm(x.payee) === norm(b.payee) && norm(x.invoiceNumber) === norm(b.invoiceNumber));
  if (dup) out.push(`The same payee and invoice number as ${dup.id}: possibly paid twice.`);
  // A bill sent back was not paid: the same document recorded again, corrected, is not a second payment.
  const sameFile = all.find((x) => x.id !== b.id && x.status !== "returned" && b.status !== "returned" && x.file.hash === b.file.hash);
  if (sameFile) out.push(`The same document as ${sameFile.id}.`);
  return out;
}

/**
 * The bill that took the place of one sent back, or null when it still waits to be corrected.
 * A bill sent back is never changed: the person who records bills corrects it and records it
 * again, from the same document. The later bill for that document, or for that payee and
 * invoice number, is the one that replaced it.
 */
export function redoneAs(b: Bill, all: Bill[]): string | null {
  if (b.status !== "returned") return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const at = all.findIndex((x) => x.id === b.id);
  // Recorded again from it: the link is kept on the new bill.
  const linked = all.find((x) => x.replaces === b.id);
  if (linked) return linked.id;
  // Bills recorded before the link was kept: the same document, or the same payee and invoice number.
  const later = all.find((x, i) => i > at && x.id !== b.id && x.replaces === undefined && x.status !== "returned" && (x.file.hash === b.file.hash || (norm(x.payee) === norm(b.payee) && norm(x.invoiceNumber) === norm(b.invoiceNumber))));
  return later?.id ?? null;
}

/** Bills sent back that the people who record bills still have to correct and record again. */
export const toCorrect = (all: Bill[]) => all.filter((b) => b.status === "returned" && !redoneAs(b, all));

/**
 * Why a bill cannot be saved with this budget line, or null when it can. A bill charged to a
 * project is charged to one of that project's budget lines, chosen from the list: that is what
 * lets spending be compared with the budget line by line. A bill with no project (general and
 * admin) has no line, and a project whose budget is not loaded yet has none to choose from.
 */
export function billLineProblem(source: string, budgetLine: string | null, lines: Record<string, { code: string }[]>, nonContract: string): string | null {
  if (source === nonContract) return budgetLine ? "A general and admin bill has no project budget line. Clear the line, or choose the project it belongs to." : null;
  const known = lines[source] ?? [];
  if (!known.length) return budgetLine ? "That project has no budget loaded yet, so there is no line to charge. Load the budget first, or leave the line empty." : null;
  if (!budgetLine) return "Choose the budget line this bill is charged to.";
  return known.some((l) => l.code === budgetLine) ? null : `Line ${budgetLine} is not in that project's budget. Choose one from the list.`;
}
