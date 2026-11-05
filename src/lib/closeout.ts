import { DONE, valueOf, type Procurement, type Voucher } from "@/lib/procurement";
import type { Bill } from "@/lib/bills";
import { invoiceUsd } from "@/lib/payments";

/**
 * Monthly closeout: each month's expense vouchers, checked filed and posted, then signed off by
 * Finance. Vouchers come from procurements and from bills paid directly (rent, utilities,
 * insurance); both are checked the same way.
 */

export type MonthClose = { by: string; name: string; at: string; count: number; totalUsd: number };
export type Closeouts = Record<string, MonthClose>;

/** One voucher, whatever it came from. */
export type VoucherItem = { id: string; kind: "procurement" | "bill"; title: string; payee: string | null; amountUsd: number; voucher: Voucher | null; filed: boolean; stage: string };

/** A procurement's vouchers: one per paid instalment, and the one under way. */
export const fromProcurement = (p: Procurement, stage: string): VoucherItem[] => [
  ...(p.payments ?? []).map((r) => ({
    id: `${p.id}-P${r.n}`,
    kind: "procurement" as const,
    title: p.title,
    payee: r.supplier || (p.supplier?.name ?? null),
    amountUsd: invoiceUsd(r.invoice) ?? 0,
    voucher: r.voucher ?? null,
    filed: !!r.voucher,
    stage: "Paid",
  })),
  ...(p.voucher || !p.payments?.length
    ? [
        {
          id: p.payments?.length || (p.schedule?.length ?? 0) > 1 ? `${p.id}-P${(p.payments?.length ?? 0) + 1}` : p.id,
          kind: "procurement" as const,
          title: p.title,
          payee: p.supplier?.name ?? null,
          amountUsd: invoiceUsd(p.invoice) ?? valueOf(p),
          voucher: p.voucher ?? null,
          // A procurement voucher counts once Finance has finished the voucher step.
          filed: !!p.voucher && (p.step === "paid" || p.step === "close" || p.step === DONE),
          stage,
        },
      ]
    : []),
];

export const fromBill = (b: Bill): VoucherItem => ({
  id: b.id,
  kind: "bill",
  title: b.description,
  payee: b.payee,
  amountUsd: b.usd,
  voucher: b.voucher ? { number: b.voucher.number, month: b.voucher.month, sharepointUrl: b.voucher.sharepointUrl, netsuiteRef: b.voucher.netsuiteRef } : null,
  filed: b.status === "filed",
  stage: b.status === "filed" ? "Filed" : b.status === "approved" ? "Approved, voucher not prepared" : b.status === "returned" ? "Sent back" : "Waiting for approval",
});

export function monthsOf(items: VoucherItem[]) {
  const months = new Map<string, VoucherItem[]>();
  for (const v of items) if (v.voucher?.month) months.set(v.voucher.month, [...(months.get(v.voucher.month) ?? []), v]);
  return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** What still stops a month from closing. */
export function blockers(list: VoucherItem[]) {
  const out: string[] = [];
  for (const v of list) {
    if (!v.filed) out.push(`${v.id}: voucher not finished`);
    else if (!v.voucher!.sharepointUrl) out.push(`${v.id}: not filed in SharePoint`);
    else if (!v.voucher!.netsuiteRef.trim()) out.push(`${v.id}: not posted in NetSuite`);
  }
  return out;
}

export const total = (list: VoucherItem[]) => Math.round(list.reduce((s, v) => s + v.amountUsd, 0) * 100) / 100;
