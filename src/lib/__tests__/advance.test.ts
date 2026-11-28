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

describe("review round 2 (R2-09, R2-14)", async () => {
  const { foldAdvances } = await import("@/lib/advance");
  const hr = { rules: { holders: { finance: ["yusuf", "omid"], hr: ["sima"] } }, people: { yusuf: { id: "yusuf", current: { supervisor: "karim" } } }, relations: [] } as never;
  let n = 0;
  const e = (actor: string, kind: string, data: object, subject: string | null = null) => ({ n: ++n, at: "2026-11-28T09:00:00Z", actor, kind, subject, data, hash: "", prevHash: "" });
  const ask = { amount: 500, currency: "USD", purpose: "Field trip to Balkh", source: "A-2027", neededBy: "2026-12-01" };
  it("Finance does not pay their own advance, and a second one waits for the first to be settled", () => {
    n = 0;
    const { advances, ignored } = foldAdvances(
      [
        e("yusuf", "adv-request", ask, "yusuf"),
        e("karim", "adv-approve", { advance: 1 }),
        e("yusuf", "adv-pay", { advance: 1, paidOn: "2026-11-28", method: "mobile", reference: "MW-123", payee: "yusuf" }),
        e("yusuf", "adv-request", ask, "yusuf"),
        e("omid", "adv-pay", { advance: 1, paidOn: "2026-11-28", method: "bank", reference: "TR-9", payee: "yusuf" }),
      ] as never,
      hr,
    );
    expect(ignored.map((i) => i.why)).toEqual(["another Finance person pays your own advance", "settle the open advance, and pay back what is owed, before asking for another"]);
    expect(advances).toHaveLength(1);
    expect(advances[0]).toMatchObject({ status: "paid", paid: { by: "omid" } });
  });
});
