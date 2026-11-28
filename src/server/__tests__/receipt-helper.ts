import { userById } from "@/lib/demo";
import { FARMER_LISTS } from "@/lib/farmer-screening";
import { realToday } from "@/lib/clock";
import { decideDistribution, listDistributions } from "@/server/distribution";
import { screenFarmer } from "@/server/farmer-screening";

/**
 * Approving a distribution needs the receipt read against the record (ISS-14) and, for a package
 * above $50, the farmer's clear screening (MF-04). Tests about other rules approve with a receipt
 * that matches what was recorded, after recording a clear screening of the farmer.
 */
export async function matchingReceipt(code: string, id: string) {
  const d = (await listDistributions(code)).find((x) => x.id === id);
  if (d?.screeningHold) await screenFarmer(code, { farmer: d.farmerId, date: realToday(), lists: FARMER_LISTS, result: "clear" }, userById("nadia")!);
  return d ? { date: d.date, farmer: true, qty: Object.fromEntries(d.items.map((i) => [i.key, i.qty])) } : undefined;
}

export async function approveAs(code: string, id: string, by: { id: string; name: string }) {
  return decideDistribution(code, id, "approved", by, undefined, await matchingReceipt(code, id));
}
