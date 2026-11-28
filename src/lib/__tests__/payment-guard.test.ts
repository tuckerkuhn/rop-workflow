import { describe, expect, it } from "vitest";
import { lineCodeOf, namedPurchase, openOnLine, payeeSupplies, paymentGuard, saysThirdParty, type GuardForm, type OpenPurchase } from "@/lib/ledger/payment-guard";

/**
 * Review round 1, ISS-02: Record a payment is not a way around a purchase's checks. The review
 * posted USD 1,560 to "Ahmad Noori, on behalf of Green Valley Agro Ltd" for PR-2027-011 with no
 * warning; each rule here would have stopped it.
 */
const today = "2026-11-27";
const open: OpenPurchase[] = [
  { id: "PR-2027-011", title: "NPK fertilizer 17-17-17, second lot", lineCode: "2.2 Fertilizer", supplier: "Green Valley Agro Ltd", usd: 1560 },
  { id: "PR-2027-009", title: "Knapsack sprayers, 16 L", lineCode: "2.3", supplier: null, usd: 7800 },
];
const all = [...open, { id: "PR-2027-006" }];
const form = (over: Partial<GuardForm> = {}): GuardForm => ({ payee: "Kabul Bank", what: "Monthly account fee", lineCode: "5.1", date: today, ...over });

describe("what Record a payment refuses", () => {
  it("the review's own payment is refused three ways", () => {
    const reviewed = form({ payee: "TEST R1 - Ahmad Noori, on behalf of Green Valley Agro Ltd (fictional)", what: "TEST R1 - NPK 17-17-17 second lot, PR-2027-011 (procurement package not yet complete)", lineCode: "2.2" });
    expect(paymentGuard(reviewed, all, open, today)).toMatchObject({ status: 409 });
    expect(paymentGuard(reviewed, all, open, today)!.error).toContain("PR-2027-011 is a purchase of this organization");
    // With the number left out, the third party is caught.
    const unnamed = { ...reviewed, what: "NPK 17-17-17 second lot" };
    expect(paymentGuard(unnamed, all, open, today)).toMatchObject({ status: 400 });
    // With a plain payee, the open purchase on the line is.
    const plain = { ...unnamed, payee: "Green Valley Agro Ltd" };
    expect(paymentGuard(plain, all, open, today)!.error).toContain("PR-2027-011 NPK fertilizer 17-17-17, second lot ($1,560, Green Valley Agro Ltd)");
  });

  it("a payment that names any purchase of the project, open or closed, is refused", () => {
    expect(namedPurchase("seed, pr 2027 006 final", all)).toBe("PR-2027-006");
    expect(namedPurchase("PR-2027-0061", all)).toBeNull();
    expect(paymentGuard(form({ what: "Balance on pr-2027-006" }), all, open, today)).toMatchObject({ status: 409 });
  });

  it("a running cost on a line with no open purchase goes through", () => {
    expect(paymentGuard(form(), all, open, today)).toBeNull();
  });

  it("on a line with open purchases, a written reason is needed and then it goes through", () => {
    const f = form({ payee: "Village B hall", what: "Hall hire for the input fair", lineCode: "2.3 Crop protection equipment" });
    expect(openOnLine(f.lineCode, open).map((p) => p.id)).toEqual(["PR-2027-009"]);
    expect(paymentGuard(f, all, open, today)).toMatchObject({ status: 409 });
    expect(paymentGuard({ ...f, notAPurchase: "too short" }, all, open, today)).toMatchObject({ status: 409 });
    expect(paymentGuard({ ...f, notAPurchase: "Hall hire, not the sprayers: no purchase record exists for it." }, all, open, today)).toBeNull();
    expect(lineCodeOf("2.3 Crop protection equipment")).toBe("2.3");
  });

  it("money handed to someone else needs the authorization and a screening in date", () => {
    expect(saysThirdParty("Ahmad Noori c/o Green Valley")).toBe(true);
    expect(saysThirdParty("Green Valley Agro Ltd")).toBe(false);
    const f = form({ payee: "Hall owner, collected by his son" });
    expect(paymentGuard(f, all, open, today)).toMatchObject({ status: 400 });
    const tp = { receivedBy: "Ahmad Noori", authorization: { hash: "a".repeat(64) }, screenedOn: "2026-10-28" };
    expect(paymentGuard({ ...f, thirdParty: tp }, all, open, today)).toBeNull();
    expect(paymentGuard({ ...f, thirdParty: { ...tp, authorization: { hash: "" } } }, all, open, today)!.error).toContain("written authorization");
    expect(paymentGuard({ ...f, thirdParty: { ...tp, screenedOn: "2026-05-13" } }, all, open, today)!.error).toContain("screened 198 days before the payment");
    expect(paymentGuard({ ...f, thirdParty: { ...tp, screenedOn: "2026-12-01" } }, all, open, today)!.error).toContain("in the future");
    // Code review of ISS-02: measured to the day paid, and a screening after the payment did not cover it.
    expect(paymentGuard({ ...f, date: "2026-10-20", thirdParty: tp }, all, open, today)!.error).toContain("after the payment of 2026-10-20");
    expect(paymentGuard({ ...f, thirdParty: { ...tp, receivedBy: " " } }, all, open, today)!.error).toBe("Say who received the money.");
  });
});

describe("review round 2 (R2-06, R2-07, R2-11)", () => {
  it("a purchase number is found however it is written", () => {
    const list = [{ id: "PR-2027-011" }, { id: "PR-A2027-002" }];
    expect(namedPurchase("Balance for PR2027-011", list)).toBe("PR-2027-011");
    expect(namedPurchase("balance for pr 2027 11", list)).toBe("PR-2027-011");
    expect(namedPurchase("PR-A2027-2 second lot", list)).toBe("PR-A2027-002");
    expect(namedPurchase("PR-2027-0110 is another number", list)).toBeNull();
    expect(namedPurchase("Monthly fee 2027-011", list)).toBeNull();
  });
  it("the payee is recognised as the supplier of an open purchase on the line", () => {
    const onLine: OpenPurchase[] = [{ id: "PR-2027-015", title: "NPK", lineCode: "2.2", supplier: "Green Valley Agro", usd: 31200 }];
    expect(payeeSupplies("Green Valley Agro Ltd (fictional)", onLine).map((p) => p.id)).toEqual(["PR-2027-015"]);
    expect(payeeSupplies("Kabul Fuel Station", onLine)).toEqual([]);
  });
  it('"paid via" a person is a third-party payment; "via bank transfer" is not', () => {
    expect(saysThirdParty("Green Valley Agro NPK paid via Ahmad")).toBe(true);
    expect(saysThirdParty("Paid via bank transfer")).toBe(false);
    expect(saysThirdParty("sent via mobile wallet")).toBe(false);
  });
});
