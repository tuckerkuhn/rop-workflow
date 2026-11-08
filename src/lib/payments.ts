/**
 * Paying a contract: in one payment or in instalments, each with its own goods received note,
 * invoice, payment approval form, withholding tax, expense voucher and proof of payment.
 *
 * The steps from receipt to payment repeat once per instalment. While an instalment is under way
 * its working data sits on the procurement (grn, invoice, voucher, paid), exactly as for a single
 * payment; when it is paid, that data moves into `payments` and the next instalment starts clean.
 *
 * Withholding follows Article 72 of the Afghan Income Tax Law 2009 (Guide 21, Withholding Tax on
 * Contractor Services): 2% of the gross payment for a contractor with a valid business licence,
 * 7% without one; nothing below AFN 500,000 unless the year's payments pass it; withheld tax
 * remitted by the 10th of the following (solar) month. UNDP's 2022 spot check found tax
 * under-withheld from a supplier whose licence had expired before payment, so the licence is
 * checked on the payment date, not the contract date.
 */

import type { Procurement, Signature, Voucher } from "@/lib/procurement";

export type Currency = "USD" | "AFN";
export type Instalment = { label: string; pct: number };

/** The invoice for the instalment under way, in the invoice's own currency. */
export type Invoice = {
  amount: number;
  qty: number;
  number?: string;
  date?: string;
  /** Missing on records made before currencies: US dollars. */
  currency?: Currency;
  /** Afghani per US dollar: the UN operational rate for the month. */
  rate?: number;
};

/** Proof that the instalment was paid, and the withheld tax remitted. */
export type Paid = { date: string; ref: string; taxRef?: string; taxDate?: string };

export type Withholding = { pct: number; amount: number; why: string };

/** One paid instalment, kept as it stood when paid. */
export type PaymentRecord = {
  n: number;
  label: string;
  pct: number;
  grn?: { qty: number; place: string; progressPct?: number };
  invoice: Invoice;
  supplier: string;
  /** Its record in the supplier register, when linked. */
  supplierId?: string;
  licenceExpiry?: string;
  tax: Withholding;
  net: number;
  voucher?: Voucher;
  paid: Paid;
  /** The mark added to the invoice file so it cannot be paid again. */
  mark: string;
  taxDue: string;
  signatures: Record<string, Signature[]>;
  checks: Record<string, boolean>;
  drafts?: Procurement["drafts"];
  ai?: Record<string, string[]>;
};

/** Afghan law's rates; the organization's settings can change them when the law changes. */
const TAX_DEFAULTS = { taxLicensedPct: 2, taxUnlicensedPct: 7, taxThresholdAfn: 500_000 };
let taxRules = { ...TAX_DEFAULTS };
/** Set with the rest of the rules in force (lib/procurement.ts). */
export function setPaymentRules(values: Record<string, unknown>) {
  const n = (k: keyof typeof TAX_DEFAULTS) => (typeof values[k] === "number" ? (values[k] as number) : TAX_DEFAULTS[k]);
  taxRules = { taxLicensedPct: n("taxLicensedPct"), taxUnlicensedPct: n("taxUnlicensedPct"), taxThresholdAfn: n("taxThresholdAfn") };
}
export const TAX_SOURCE = "Income Tax Law 2009 Art. 72 (Guide 21)";

/** The steps that repeat for each instalment, in order. */
export const PAY_LOOP = ["receive", "package", "payForm", "payReady", "verifyPay", "approvePay", "voucher", "paid"] as const;
/** Documents made once per instalment. */
export const PAY_DOCS = ["Goods received note", "Procurement package", "Payment approval form", "Checklist pass 2", "Expense voucher"];

/** The chosen quotation in dollars, for purchases with no contract step (micro and direct buys). */
const chosenBidUsd = (p: Procurement) => {
  const b = p.bids?.find((x) => x.id === p.selectedBid);
  if (!b) return null;
  return b.currency === "AFN" ? (b.rate && b.rate > 0 ? b.amount / b.rate : null) : b.amount;
};
/** What was agreed, in dollars: the contract as signed, else the chosen quotation, else the request's estimate. */
const orderUsd = (p: Procurement) => (contractCurrency(p) === "USD" && p.contractUsd && p.contractUsd > 0 ? p.contractUsd : (chosenBidUsd(p) ?? p.qty * p.unitPrice));
/** Whether the agreed value is known, so invoices are matched to it rather than the estimate. */
export const contractValueKnown = (p: Procurement) =>
  contractCurrency(p) === "AFN" ? !!(p.contractAfn && p.contractAfn > 0) : !!(p.contractUsd && p.contractUsd > 0) || chosenBidUsd(p) !== null || p.route === "direct";
const round2 = (n: number) => Math.round(n * 100) / 100;

export const scheduleOf = (p: Procurement): Instalment[] => (p.schedule?.length ? p.schedule : [{ label: "Full payment", pct: 100 }]);
export const scheduleTotal = (p: Procurement) => scheduleOf(p).reduce((s, i) => s + i.pct, 0);
export const paidSoFar = (p: Procurement) => p.payments ?? [];
/** The instalment under way, 1-based. */
export const instalmentNo = (p: Procurement) => paidSoFar(p).length + 1;
export const currentInstalment = (p: Procurement): Instalment & { n: number; of: number } => {
  const s = scheduleOf(p);
  const n = Math.min(instalmentNo(p), s.length);
  return { ...s[n - 1], n, of: s.length };
};
/** Share of the contract due by the end of the instalment under way, in percent. */
export const cumulativePct = (p: Procurement) =>
  scheduleOf(p)
    .slice(0, instalmentNo(p))
    .reduce((s, i) => s + i.pct, 0);
export const moreToPay = (p: Procurement) => instalmentNo(p) < scheduleOf(p).length;
export const contractCurrency = (p: Procurement): Currency => p.contractCurrency ?? "USD";

/** The invoice in US dollars, or null when an afghani invoice has no exchange rate. */
export function invoiceUsd(inv: Invoice | undefined): number | null {
  if (!inv) return null;
  if ((inv.currency ?? "USD") === "USD") return inv.amount;
  return inv.rate && inv.rate > 0 ? round2(inv.amount / inv.rate) : null;
}

/** What this instalment should invoice, in US dollars. */
export const expectedUsd = (p: Procurement) => round2((orderUsd(p) * currentInstalment(p).pct) / 100);

/** Quantity received in earlier instalments. */
export const receivedBefore = (p: Procurement) => paidSoFar(p).reduce((s, r) => s + (r.grn?.qty ?? 0), 0);

/**
 * Whether the work received so far covers what this instalment pays for. Works are measured by
 * the verified progress percentage; goods by cumulative quantity.
 */
export function receiptCovers(p: Procurement): { ok: boolean; detail: string } | null {
  if (!p.grn) return null;
  const due = cumulativePct(p);
  if (p.grn.progressPct !== undefined) return { ok: p.grn.progressPct >= due, detail: `Work verified ${p.grn.progressPct}% complete · this payment brings the total paid to ${due}%` };
  const total = receivedBefore(p) + p.grn.qty;
  const need = Math.ceil((p.qty * due) / 100 - 1e-9);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const ok = total >= need && total <= p.qty;
  return { ok, detail: `Received ${fmt(total)} of ${fmt(p.qty)} ${p.unit} so far${scheduleOf(p).length > 1 ? ` · ${fmt(need)} needed for ${due}% paid` : ""}` };
}

/** An afghani contract's value in afghani, when recorded. */
export const contractAfnOf = (p: Procurement) => (contractCurrency(p) === "AFN" && p.contractAfn && p.contractAfn > 0 ? p.contractAfn : null);
/** What this instalment should invoice in afghani, for an afghani contract with its value recorded. */
export const expectedAfn = (p: Procurement) => {
  const v = contractAfnOf(p);
  return v === null ? null : Math.round((v * currentInstalment(p).pct) / 100);
};

/**
 * Invoice amount matches the instalment due. An afghani contract is compared in afghani, to the
 * nearest afghani; otherwise in dollars, within half a percent for exchange rounding.
 */
export function invoiceMatches(p: Procurement): { ok: boolean; detail: string } | null {
  if (!p.invoice) return null;
  if (!contractValueKnown(p)) return { ok: false, detail: "The contract value as signed is not recorded: add it with the payment schedule, so the invoice is matched to the contract and not the estimate" };
  // Quantity: never more than received for this instalment (goods; works are matched on progress).
  if (p.grn && p.grn.progressPct === undefined && p.invoice.qty > p.grn.qty)
    return { ok: false, detail: `Invoice for ${p.invoice.qty.toLocaleString("en-US")} ${p.unit}, but ${p.grn.qty.toLocaleString("en-US")} received for this payment` };
  const usd = invoiceUsd(p.invoice);
  const cur = p.invoice.currency ?? "USD";
  const shown = `${cur} ${p.invoice.amount.toLocaleString("en-US")}`;
  const i = currentInstalment(p);
  const part = i.of > 1 ? `instalment ${i.n} of ${i.of} (${i.pct}%) ` : "";
  const afn = expectedAfn(p);
  if (afn !== null && cur === "AFN") return { ok: Math.abs(p.invoice.amount - afn) <= 1, detail: `${shown} · ${part}due AFN ${afn.toLocaleString("en-US")}` };
  if (afn !== null) return { ok: false, detail: `${shown}: the contract is in afghani, so the invoice should be too (due AFN ${afn.toLocaleString("en-US")})` };
  if (usd === null) return { ok: false, detail: `${shown}: add the exchange rate to compare it with the order` };
  const want = expectedUsd(p);
  const ok = Math.abs(usd - want) <= Math.max(0.01, want * 0.005);
  return { ok, detail: `${shown} = $${usd.toLocaleString("en-US")} · ${part}due $${want.toLocaleString("en-US")} under the contract` };
}

/** Whether the licence is valid on the payment date. Missing counts as no licence. */
export const licenceValid = (expiry: string | undefined, on: string) => !!expiry && expiry >= on;

/** Tax to withhold from this instalment's invoice, in the invoice's currency. */
export function withholding(p: Procurement, on: string): Withholding | null {
  const inv = p.invoice;
  if (!inv) return null;
  const rate = inv.rate && inv.rate > 0 ? inv.rate : null;
  // The contract's value in afghani decides the threshold; it needs the month's rate.
  const contractAfn = contractAfnOf(p) ?? (rate ? orderUsd(p) * rate : null);
  if (contractAfn !== null && contractAfn < taxRules.taxThresholdAfn)
    return { pct: 0, amount: 0, why: `Contract under AFN ${taxRules.taxThresholdAfn.toLocaleString("en-US")}: no withholding unless this supplier's payments this year pass it (${TAX_SOURCE}).` };
  const expiry = p.supplier?.licenceExpiry;
  const valid = licenceValid(expiry, on);
  const pct = valid ? taxRules.taxLicensedPct : taxRules.taxUnlicensedPct;
  const why = valid
    ? `Business licence valid until ${expiry}: ${pct}% (${TAX_SOURCE}).`
    : expiry
      ? `Business licence expired ${expiry}, before the payment date ${on}: ${pct}% (${TAX_SOURCE}).`
      : `No business licence recorded: ${pct}% (${TAX_SOURCE}).`;
  return { pct, amount: Math.round((inv.amount * pct) / 100), why: contractAfn === null ? `${why} Add the exchange rate to check the AFN ${taxRules.taxThresholdAfn.toLocaleString("en-US")} threshold.` : why };
}

/** Solar Hijri day of month and month number, from the browser's Persian calendar. */
function solar(d: Date) {
  const parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { day: "numeric", month: "numeric", timeZone: "UTC" }).formatToParts(d);
  return { day: Number(parts.find((x) => x.type === "day")?.value), month: Number(parts.find((x) => x.type === "month")?.value) };
}

/** Withheld tax is due by the 10th of the solar month after the payment. */
export function taxDueDate(paidOn: string): string {
  const d = new Date(`${paidOn}T00:00:00Z`);
  const start = solar(d).month;
  for (let i = 1; i < 70; i++) {
    const x = new Date(d.getTime() + i * 86400000);
    const s = solar(x);
    if (s.month !== start && s.day === 10) return x.toISOString().slice(0, 10);
  }
  return paidOn;
}

/** The mark written on the invoice file once paid, so the same invoice is never paid twice. */
export const paidMark = (p: Procurement, paid: Paid) =>
  `PAID ${paid.date} · ${p.plan?.project ?? p.funding} · ${p.plan?.budgetCode ?? p.budgetLine} · ${p.id}-P${instalmentNo(p)} · ref ${paid.ref}`;

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Other payments of the same invoice from the same supplier, in any procurement of the project
 * (the spot check's duplicate-payment risk). Bills paid directly are checked separately.
 */
export function duplicateInvoices(p: Procurement, all: Procurement[]): string[] {
  const no = normal(p.invoice?.number ?? "");
  const who = normal(p.supplier?.name ?? "");
  const id = p.supplier?.id;
  if (!no || (!who && !id)) return [];
  // The same supplier: the same register record, or failing that the same name.
  const same = (otherId: string | undefined, name: string) => (id && otherId ? id === otherId : normal(name) === who);
  const out: string[] = [];
  for (const q of all)
    for (const r of q.payments ?? []) if (normal(r.invoice.number ?? "") === no && same(r.supplierId, r.supplier)) out.push(`${q.id}-P${r.n}`);
  for (const q of all) if (q.id !== p.id && normal(q.invoice?.number ?? "") === no && same(q.supplier?.id, q.supplier?.name ?? "")) out.push(`${q.id} (in progress)`);
  return out;
}

const startsWithStep = (k: string) => PAY_LOOP.some((s) => k.startsWith(`${s}.`) || k.startsWith(`fix.${s}.`) || k === `review.${s}`);

/**
 * Closes the instalment just paid: its working data moves into `payments`, and the next
 * instalment's steps start clean. Called as the "paid" step completes.
 */
export function closeInstalment(p: Procurement): Procurement {
  const i = currentInstalment(p);
  const on = p.paid?.date ?? "";
  const tax = withholding(p, on) ?? { pct: 0, amount: 0, why: "No invoice recorded." };
  const paid = p.paid ?? { date: on, ref: "" };
  const keep = <T,>(o: Record<string, T> | undefined, pick: (k: string) => boolean) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => pick(k)));
  const rec: PaymentRecord = {
    n: i.n,
    label: i.label,
    pct: i.pct,
    grn: p.grn,
    invoice: p.invoice ?? { amount: 0, qty: 0 },
    supplier: p.supplier?.name ?? "",
    ...(p.supplier?.id ? { supplierId: p.supplier.id } : {}),
    licenceExpiry: p.supplier?.licenceExpiry,
    tax,
    net: (p.invoice?.amount ?? 0) - tax.amount,
    voucher: p.voucher,
    paid,
    mark: paidMark(p, paid),
    taxDue: taxDueDate(paid.date),
    signatures: keep(p.signatures, (d) => PAY_DOCS.includes(d)),
    checks: keep(p.checks, startsWithStep),
    drafts: keep(p.drafts, (d) => PAY_DOCS.includes(d)),
    ai: keep(p.ai, (s) => (PAY_LOOP as readonly string[]).includes(s)),
  };
  return {
    ...p,
    payments: [...paidSoFar(p), rec],
    grn: undefined,
    invoice: undefined,
    voucher: undefined,
    paid: undefined,
    signatures: keep(p.signatures, (d) => !PAY_DOCS.includes(d)),
    checks: keep(p.checks, (k) => !startsWithStep(k)),
    drafts: keep(p.drafts, (d) => !PAY_DOCS.includes(d)),
    ai: keep(p.ai, (s) => !(PAY_LOOP as readonly string[]).includes(s)),
  };
}

/** The procurement as it stood for a paid instalment, so its documents can be shown again. */
export function asPaid(p: Procurement, r: PaymentRecord): Procurement {
  return {
    ...p,
    grn: r.grn,
    invoice: r.invoice,
    voucher: r.voucher,
    paid: r.paid,
    signatures: { ...p.signatures, ...r.signatures },
    checks: { ...p.checks, ...r.checks },
    drafts: { ...p.drafts, ...r.drafts },
    payments: paidSoFar(p).filter((x) => x.n < r.n),
  };
}

/** Paid instalments whose withheld tax has not been recorded as remitted. */
export const taxOutstanding = (p: Procurement) => paidSoFar(p).filter((r) => r.tax.amount > 0 && !r.paid.taxRef);
