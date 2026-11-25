import { describe, expect, it } from "vitest";
import { paymentBooksProblem, paymentEntry, recordedRate, standing, type PostingState } from "@/lib/books-posting";
import { billBooksProblem, billEntry, type Bill } from "@/lib/bills";
import type { PaymentRecord } from "@/lib/payments";
import type { Procurement } from "@/lib/procurement";

/** The entry Finance is shown for a bill or a purchase payment comes from that document alone. */
const purchase = { id: "PR-2027-900", title: "Hand tools (fictional)", budgetLine: "2.3", timeline: [] } as unknown as Procurement;
const paid = (invoice: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ n: 2, supplier: "FarmTools Co. (fictional)", invoice: { amount: 70000, qty: 1, number: "FT-9", ...invoice }, paid: { date: "2026-11-20", ref: "TT-1" }, ...extra }) as unknown as PaymentRecord;
const posting = (n: number, reversal: PostingState["reversal"] = null): PostingState => ({ n, entryId: `e${n}`, expenditureId: `x${n}`, date: "2026-11-20", paidFrom: "1010", paidFromName: "Main bank account", budgetLine: "2.3", amount: "10.00", currency: "USD", by: "omid", name: "Omid Rahmani", at: "2026-11-20", reversal });

describe("a purchase payment's entry", () => {
  it("is the invoice in full on the purchase's line, dated the day it was paid", () => {
    expect(paymentEntry(purchase, paid({ amount: 7800 }), "A-2027", "Crop protection equipment")).toEqual({ payee: "FarmTools Co. (fictional)", what: "Hand tools (fictional), payment 2 of PR-2027-900 (invoice FT-9)", project: "A-2027", budgetLine: "2.3", budgetLineName: "Crop protection equipment", date: "2026-11-20", amount: 7800, currency: "USD", usd: 7800 });
  });
  it("an afghani invoice uses the rate recorded on it", () => {
    const e = paymentEntry(purchase, paid({ currency: "AFN", rate: 70 }), "A-2027", "");
    expect(e).toMatchObject({ amount: 70000, currency: "AFN", usd: 1000 });
    expect(recordedRate(e.amount, e.usd)).toBe("0.01428571");
    expect(paymentBooksProblem(purchase, paid({ currency: "AFN", rate: 70 }))).toBeNull();
    expect(paymentBooksProblem(purchase, paid({ currency: "AFN", rate: undefined }))).toMatch(/no rate recorded/);
  });
  it("the calendar's budget line wins over the request's", () => {
    expect(paymentEntry({ ...purchase, plan: { budgetCode: "3.1" } } as unknown as Procurement, paid({}), "A-2027", "").budgetLine).toBe("3.1");
  });
  it("does not go to the books without proof of payment, an amount or a line", () => {
    expect(paymentBooksProblem(purchase, paid({}, { paid: { date: "2026-11-20", ref: " " } }))).toMatch(/once its payment is recorded/);
    expect(paymentBooksProblem(purchase, paid({ amount: 0 }))).toMatch(/no invoice amount/);
    expect(paymentBooksProblem({ ...purchase, budgetLine: "" } as Procurement, paid({}))).toMatch(/no budget line/);
  });
});

describe("a bill's entry", () => {
  const bill = { id: "BL-009", payee: "Kabul Net (fictional)", invoiceNumber: "KN-9", invoiceDate: "2026-11-02", description: "Office internet", amount: 4200, currency: "AFN", usd: 60, source: "A-2027", budgetLine: "5.2", status: "filed", voucher: { at: "2026-11-21" } } as unknown as Bill;
  it("is dated the day its voucher was filed and keeps the dollars recorded on the bill", () => {
    expect(billEntry(bill, "Office and communications")).toEqual({ payee: "Kabul Net (fictional)", what: "Office internet (invoice KN-9)", project: "A-2027", budgetLine: "5.2", budgetLineName: "Office and communications", date: "2026-11-21", amount: 4200, currency: "AFN", usd: 60 });
  });
  it("goes to the books only once filed and on a project's line", () => {
    expect(billBooksProblem(bill, "non-contract")).toBeNull();
    expect(billBooksProblem({ ...bill, status: "approved" }, "non-contract")).toMatch(/once its voucher is filed/);
    expect(billBooksProblem({ ...bill, source: "non-contract", budgetLine: null }, "non-contract")).toMatch(/no project budget line/);
  });
});

describe("the entry that stands", () => {
  it("is the last posting unless its reversal is posted", () => {
    expect(standing([])).toBeNull();
    expect(standing([posting(1)])?.n).toBe(1);
    expect(standing([posting(1, { entryId: "r", posted: false, by: "Omid", date: "2026-11-21", reason: "x" })])?.n).toBe(1);
    expect(standing([posting(1, { entryId: "r", posted: true, by: "Omid", date: "2026-11-21", reason: "x" })])).toBeNull();
    expect(standing([posting(1, { entryId: "r", posted: true, by: "Omid", date: "2026-11-21", reason: "x" }), posting(2)])?.n).toBe(2);
  });
});
