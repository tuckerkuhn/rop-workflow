import { afterEach, describe, expect, it } from "vitest";
import { distributionState, seedProcurements, setProcurementRules, setProcurementSet, signatureLines, stepById, vendbillOf, type Procurement, type Voucher } from "@/lib/procurement";
import { PAY_LOOP, voucherBook, voucherGaps, withholding } from "@/lib/payments";
import { documentFor } from "@/lib/procurement-docs";
import { GL_EXPENSE, LOCATIONS, codeLabel } from "@/lib/voucher-codes";
import { codingFor } from "@/lib/voucher-setup";

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

  it("starts from the coding set in project setup, with the GL account and department left to Finance", () => {
    const setup = { contract: "ACRP-01003467", bankGl: "1020 Citibank", taxGl: "2300", location: "10080", lines: { "2.1": { budgetCode: "PRG-1.2.2.D", location: "10010" } } };
    expect(codingFor(setup, "2.1")).toEqual({ contract: "ACRP-01003467", bankGl: "1020 Citibank", taxGl: "2300", budgetCode: "PRG-1.2.2.D", location: "10010" });
    expect(codingFor(setup, "4.1")).toMatchObject({ budgetCode: "4.1", location: "10080" });
    expect(codingFor(null, "4.1")).toMatchObject({ budgetCode: "4.1", location: "", contract: "" });
    expect(codingFor(setup, "2.1")).not.toHaveProperty("gl");
  });

  it("needs no recipient sample for goods handed out and approved in Field activities", () => {
    const p = { ...seedProcurements()[0], qty: 5, grn: { qty: 5, place: "Store", date: "2026-11-18" } } as unknown as Procurement;
    const list = { date: "2026-11-18", place: "Village B", recipients: 1, women: 1, qty: 1, evidence: "ROP Workflow distribution records, approved by Nadia Rahimi", by: "nadia", byName: "Nadia Rahimi" };
    const field = { ...p, payments: [], distribution: { forParticipants: true, lists: [list], inStock: 4, checks: [] } };
    expect(distributionState(field)?.ok).toBe(true);
    const typed = { ...field, distribution: { ...field.distribution, lists: [{ ...list, evidence: "https://x.sharepoint.com/list" }] } };
    expect(distributionState(typed)).toMatchObject({ ok: false });
    expect(distributionState(typed)?.detail).toContain("1 recipient on 1 list");
  });

  it("carries the paper form's three signatures: prepared and entered, reviewed, approved", () => {
    expect(stepById.voucher.signs?.as).toBe("Prepared and entered by (finance)");
    expect(stepById.voucherReview.signs?.as).toBe("Reviewed by (finance)");
    expect(stepById.voucherApprove.signs?.as).toBe("Approved by (finance)");
    expect(stepById.voucherApprove.produces).toContain("Expense voucher");
    expect(PAY_LOOP.indexOf("voucherApprove")).toBe(PAY_LOOP.indexOf("voucherReview") + 1);
  });

  it("keeps an older voucher's single reviewed-and-approved line, not two empty ones", () => {
    const p = { ...withInvoice(25300.07), signatures: { "Expense voucher": [{ as: "Prepared and entered by (finance)", name: "Yusuf Mohammadi", role: "finance" as const, date: "2026-11-01" }, { as: "Reviewed and approved by (finance)", name: "Omid Rahmani", role: "finance" as const, date: "2026-11-02" }] } } as Procurement;
    expect(signatureLines(p, "Expense voucher").map((l) => [l.as, l.signed?.name ?? null])).toEqual([
      ["Prepared and entered by (finance)", "Yusuf Mohammadi"],
      ["Reviewed and approved by (finance)", "Omid Rahmani"],
    ]);
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
