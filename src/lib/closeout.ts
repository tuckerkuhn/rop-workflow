import { DONE, valueOf, type Procurement } from "@/lib/procurement";

/** Monthly closeout: each month's expense vouchers, checked filed and posted, then signed off by Finance. */

export type MonthClose = { by: string; name: string; at: string; count: number; totalUsd: number };
export type Closeouts = Record<string, MonthClose>;

/** A voucher counts once Finance has finished the voucher step. */
export const filed = (p: Procurement) => !!p.voucher && (p.step === "close" || p.step === DONE);

export function monthsOf(procs: Procurement[]) {
  const months = new Map<string, Procurement[]>();
  for (const p of procs) if (p.voucher?.month) months.set(p.voucher.month, [...(months.get(p.voucher.month) ?? []), p]);
  return [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** What still stops a month from closing. */
export function blockers(list: Procurement[]) {
  const out: string[] = [];
  for (const p of list) {
    if (!filed(p)) out.push(`${p.id}: voucher not finished`);
    else if (!p.voucher!.sharepointUrl) out.push(`${p.id}: not filed in SharePoint`);
    else if (!p.voucher!.netsuiteRef.trim()) out.push(`${p.id}: not posted in NetSuite`);
  }
  return out;
}

export const amountOf = (p: Procurement) => p.invoice?.amount ?? valueOf(p);
