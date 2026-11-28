import { z } from "zod";
import type { DistItem } from "@/lib/package";

/**
 * Review round 1, ISS-14: the distribution receipt (the farmer's signed note) is read against the
 * record before approval, one thing at a time: the date written on it, the farmer it names, and each
 * quantity. The review found a receipt dated 2027-02-27 on a hand-out recorded 20 Nov, and the
 * screen said "Nothing flagged": a photo on file was taken as proof without being read.
 *
 * The person approving types what the receipt shows; any difference from the record is a mismatch,
 * and a distribution with a mismatch is sent back to be put right, not approved.
 */

export const receiptCheckSchema = z.object({
  /** The date written on the receipt. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date written on the receipt."),
  /** Whether the receipt names this farmer (their ID, or their name for someone who may see names). */
  farmer: z.boolean(),
  /** Each item's quantity as written on the receipt, by item key. */
  qty: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), z.number().min(0).max(1e7)),
});
export type ReceiptCheck = z.infer<typeof receiptCheckSchema>;

/** A check as kept on the record: what was read, by whom, and what did not match. */
export type ReceiptChecked = ReceiptCheck & { by: string; byName: string; at: string; mismatches: string[] };

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** What the receipt shows that the record does not, in words. Empty when everything matches. */
export function receiptMismatches(c: ReceiptCheck, record: { date: string; farmerId: string; items: DistItem[] }): string[] {
  const out: string[] = [];
  if (c.date !== record.date) out.push(`The receipt is dated ${c.date}; the hand-out is recorded on ${record.date}.`);
  if (!c.farmer) out.push(`The receipt does not name ${record.farmerId}.`);
  for (const i of record.items) {
    const read = c.qty[i.key];
    if (read === undefined) out.push(`${i.item}: the quantity on the receipt was not entered.`);
    else if (!same(read, i.qty)) out.push(`${i.item}: the receipt says ${read} ${i.unit}; the record says ${i.qty} ${i.unit}.`);
  }
  return out;
}

/** Why the receipt check is not finished, or null: every item read and the farmer answered. */
export function receiptIncomplete(c: Partial<ReceiptCheck> | null | undefined, items: DistItem[]): string | null {
  if (!c?.date) return "Enter the date written on the distribution receipt.";
  if (c.farmer === undefined) return "Say whether the distribution receipt names this farmer.";
  const missing = items.filter((i) => c.qty?.[i.key] === undefined);
  if (missing.length) return `Enter the quantity the distribution receipt shows for ${missing.map((i) => i.item).join(", ")}.`;
  return null;
}
