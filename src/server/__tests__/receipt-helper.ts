import { decideDistribution, listDistributions } from "@/server/distribution";

/**
 * Approving a distribution needs the receipt read against the record (ISS-14). Tests about other
 * rules approve with a receipt that matches what was recorded.
 */
export async function matchingReceipt(code: string, id: string) {
  const d = (await listDistributions(code)).find((x) => x.id === id);
  return d ? { date: d.date, farmer: true, qty: Object.fromEntries(d.items.map((i) => [i.key, i.qty])) } : undefined;
}

export async function approveAs(code: string, id: string, by: { id: string; name: string }) {
  return decideDistribution(code, id, "approved", by, undefined, await matchingReceipt(code, id));
}
