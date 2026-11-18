import { afterEach, describe, expect, it } from "vitest";
import { lastVoucher, seedProcurements, setProcurementRules, setProcurementSet, stepById, vendbillOf, type Procurement, type Voucher } from "@/lib/procurement";
import { voucherBook, voucherGaps, withholding } from "@/lib/payments";
import { documentFor } from "@/lib/procurement-docs";
import { GL_EXPENSE, LOCATIONS, codeLabel } from "@/lib/voucher-codes";

afterEach(() => {
  setProcurementRules(null);
  setProcurementSet([]);
});

const coded: Voucher = { number: "ACRP-01003467", month: "2027-03", date: "2027-03-10", sharepointUrl: "", netsuiteRef: "", gl: "8300", dept: "52", contract: "ACRP-01003467", budgetCode: "PRG-1.2.2.D", location: "10080", bankGl: "1020 Citibank", taxGl: "2300", rate: 65.706 };
const withInvoice = (amount: number, over: Partial<Procurement> = {}): Procurement => {
  const p = seedProcurements()[0];
  return { ...p, supplier: { ...(p.supplier ?? { name: "Sandbox Hardware Co" }), name: "Sandbox Hardware Co" }, invoice: { number: "INV-1", date: "2027-03-05", amount, qty: p.qty, currency: "USD" }, voucher: coded, ...over } as Procurement;
};

describe("expense voucher", () => {
  it("debits the expense gross and credits the bank net plus the withheld tax, and balances", () => {
    const p = withInvoice(25300.07);
    const b = voucherBook(p, "2027-03-10");
    const tax = withholding(p, "2027-03-10")?.amount ?? 0;
    expect(b.lines[0]).toMatchObject({ side: "Dr", gl: "8300", dept: "52", location: "10080", usd: 25300.07 });
    expect(b.lines[0].afn).toBe(Math.round(25300.07 * 65.706));
    expect(b.lines.filter((l) => l.side === "Cr")).toHaveLength(tax > 0 ? 2 : 1);
    expect(b.balanced).toBe(true);
    expect(b.dr).toEqual(b.cr);
  });

  it("credits the withheld tax to its own account", () => {
    setProcurementRules({ taxThresholdAfn: 0 });
    const p = withInvoice(10000);
    const b = voucherBook(p, "2027-03-10");
    const tax = withholding(p, "2027-03-10")!.amount;
    expect(tax).toBeGreaterThan(0);
    expect(b.lines).toHaveLength(3);
    expect(b.lines[1].usd).toBe(10000 - tax);
    expect(b.lines[2]).toMatchObject({ side: "Cr", gl: "2300", usd: tax });
    expect(b.balanced).toBe(true);
  });

  it("is out of balance with nothing invoiced", () => {
    const p = withInvoice(0);
    expect(voucherBook(p, "2027-03-10").balanced).toBe(false);
  });

  it("lists what is still to code before it goes into NetSuite", () => {
    const p = withInvoice(1000, { voucher: { number: "", month: "2027-03", sharepointUrl: "", netsuiteRef: "" } });
    const gaps = voucherGaps(p);
    expect(gaps).toEqual(expect.arrayContaining(["the voucher date", "the expense account", "the department", "the contract", "the location", "the account it is paid from", "the monthly average rate"]));
    expect(voucherGaps(withInvoice(1000))).toEqual([]);
  });

  it("takes its number from NetSuite, never a made-up EV- number", () => {
    expect(vendbillOf({ ...coded, number: "EV-PR-2026-001" })).toBe("");
    expect(vendbillOf({ ...coded, number: "EV-PR-2026-001", netsuiteRef: "VB-10482" })).toBe("VB-10482");
    expect(vendbillOf(coded)).toBe("ACRP-01003467");
  });

  it("starts a new voucher from the project's last one on the same budget line", () => {
    const [a, b, c] = seedProcurements();
    const set = [
      { ...a, budgetLine: "2.1", voucher: { ...coded, gl: "8140", date: "2027-02-01" } },
      { ...b, budgetLine: "4.1", voucher: { ...coded, gl: "8500", date: "2027-03-01" } },
    ];
    expect(lastVoucher(set, { ...c, budgetLine: "2.1" })?.gl).toBe("8140");
    expect(lastVoucher(set, { ...c, budgetLine: "9.9" })?.gl).toBe("8500");
  });

  it("is prepared by one Finance person and reviewed by another, each signing", () => {
    expect(stepById.voucher.signs?.as).toBe("Prepared and entered by (finance)");
    expect(stepById.voucherReview.signs?.as).toBe("Reviewed and approved by (finance)");
    expect(stepById.voucherReview.produces).toContain("Expense voucher");
  });

  it("prints the accounting section with the code names", () => {
    const d = documentFor(withInvoice(25300.07), "Expense voucher", (n) => `$${n}`, (n) => `AFN ${n}`);
    expect(d.number).toBe("VENDBILL # ACRP-01003467");
    expect(d.ledger?.lines[0].gl).toBe("8300 Marketing General");
    expect(d.ledger?.lines[0].location).toBe("10080 Kabul");
    expect(d.ledger?.balanced).toBe(true);
    expect(d.ledger?.rate).toContain("65.706");
  });

  it("has no names damaged by the Excel autocorrect", () => {
    expect(GL_EXPENSE.concat(LOCATIONS).some((c) => /Apr/.test(c.name))).toBe(false);
    expect(codeLabel(LOCATIONS, "10012")).toBe("10012 Asmar");
  });
});
