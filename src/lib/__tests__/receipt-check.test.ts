import { describe, expect, it } from "vitest";
import { receiptIncomplete, receiptMismatches } from "@/lib/receipt-check";

/** ISS-14: the distribution receipt is read against the record one line at a time. */
const record = { date: "2026-11-20", farmerId: "F-1001", items: [{ key: "seed", item: "Wheat seed", unit: "kg", qty: 25 }, { key: "npk", item: "NPK", unit: "kg", qty: 25 }] };

describe("reading the distribution receipt", () => {
  it("the review's case: a receipt dated in 2027 on a hand-out in November is flagged", () => {
    expect(receiptMismatches({ date: "2027-02-27", farmer: true, qty: { seed: 25, npk: 25 } }, record)).toEqual(["The receipt is dated 2027-02-27; the hand-out is recorded on 2026-11-20."]);
  });

  it("flags another farmer and a different quantity, and passes a receipt that matches", () => {
    expect(receiptMismatches({ date: "2026-11-20", farmer: false, qty: { seed: 20, npk: 25 } }, record)).toEqual(["The receipt does not name F-1001.", "Wheat seed: the receipt says 20 kg; the record says 25 kg."]);
    expect(receiptMismatches({ date: "2026-11-20", farmer: true, qty: { seed: 25, npk: 25 } }, record)).toEqual([]);
  });

  it("says what is still to read", () => {
    expect(receiptIncomplete(null, record.items)).toMatch(/date written/);
    expect(receiptIncomplete({ date: "2026-11-20" }, record.items)).toMatch(/names this farmer/);
    expect(receiptIncomplete({ date: "2026-11-20", farmer: true, qty: { seed: 25 } }, record.items)).toMatch(/for NPK/);
  });
});
