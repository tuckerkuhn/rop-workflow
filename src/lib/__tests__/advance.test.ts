import { describe, expect, it } from "vitest";
import { ageOf, owedOf, settlementProblem, type Advance } from "@/lib/advance";

/** MF-02: an advance's age, its deadline, and what is still owed. */
const adv = (over: Partial<Advance> = {}): Advance => ({ n: 1, person: "p", at: "", request: { amount: 300, currency: "USD", purpose: "Trip", source: "A-2027", neededBy: "2026-11-01" }, status: "paid", paid: { on: "2026-11-01", method: "bank", reference: "x", by: "f" }, recovered: 0, ...over });

describe("advance age and settlement", () => {
  it("is overdue past its deadline: 15 days on UN projects, 30 otherwise", () => {
    expect(ageOf(adv(), "2026-11-16", 15)).toEqual({ days: 15, due: "2026-11-16", overdue: false });
    expect(ageOf(adv(), "2026-11-17", 15)!.overdue).toBe(true);
    expect(ageOf(adv(), "2026-11-17")!.overdue).toBe(false);
    expect(ageOf(adv({ status: "settling" }), "2026-12-30", 15)!.overdue).toBe(false);
  });
  it("what was not spent and not returned is owed", () => {
    const s = { advance: 1, lines: [{ date: "2026-11-02", description: "Fuel", amount: 250, receipts: [] as never[], noReceipt: "No receipt at the pump" }], returned: 20 };
    expect(owedOf(adv({ status: "settled", settlement: { ...s, at: "" } }))).toBe(30);
    expect(settlementProblem(adv(), { ...s, lines: [{ ...s.lines[0], noReceipt: undefined }] })).toMatch(/attach the receipt/);
  });
});
