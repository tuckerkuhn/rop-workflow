import { afterEach, describe, expect, it } from "vitest";
import { seedProcurements, setProcurementSet, supplierPaidThisYear, type Procurement } from "@/lib/procurement";
import { solarYear, withholding, type PaymentRecord } from "@/lib/payments";

/**
 * The AFN 500,000 withholding threshold counts a supplier's payments over the tax year (solar
 * Hijri), not one contract: a small contract is withheld once the year's payments with it pass.
 */
const small = (amountUsd: number, id = "PR-T-1"): Procurement => {
  const p = seedProcurements()[0];
  return { ...p, id, qty: 1, unitPrice: amountUsd, estimatedCost: amountUsd, supplier: { name: "Kabul Tools Co", screenedOn: "2026-10-01", licenceExpiry: "2027-12-31" }, invoice: { number: "INV-9", date: "2026-11-20", amount: amountUsd, qty: 1, currency: "USD", rate: 70 }, payments: [] } as Procurement;
};
const paid = (afn: number, date: string, supplier = "Kabul Tools Co"): PaymentRecord =>
  ({ n: 1, label: "Payment", pct: 100, invoice: { amount: afn, qty: 1, currency: "AFN" }, supplier, tax: { pct: 0, amount: 0, why: "" }, net: afn, paid: { date, ref: "R1" }, mark: "", taxDue: date, signatures: {}, checks: {} }) as unknown as PaymentRecord;

afterEach(() => setProcurementSet([]));

describe("withholding over the tax year", () => {
  it("reads the Afghan tax year from a date", () => {
    expect(solarYear("2026-11-20")).toBe(1405);
    expect(solarYear("2026-03-19")).toBe(1404);
  });

  it("withholds nothing on a small contract while the year's payments stay under AFN 500,000", () => {
    const p = small(1000); // AFN 70,000
    setProcurementSet([p, { ...small(0, "PR-T-2"), payments: [paid(200_000, "2026-06-01")] }]);
    const w = withholding(p, "2026-11-20")!;
    expect(w.amount).toBe(0);
    expect(w.why).toMatch(/Paid to this supplier so far in tax year 1405: AFN 200,000 in 1 payment\./);
  });

  it("withholds the licensed rate once the year's payments with this one pass AFN 500,000", () => {
    const p = small(1000);
    setProcurementSet([p, { ...small(0, "PR-T-2"), payments: [paid(450_000, "2026-06-01")] }]);
    const w = withholding(p, "2026-11-20")!;
    expect(w.pct).toBe(2);
    expect(w.amount).toBe(20);
    expect(w.why).toMatch(/reach AFN 520,000 with this one, past AFN 500,000/);
  });

  it("counts only the same supplier and the same tax year", () => {
    const p = small(1000);
    setProcurementSet([p, { ...small(0, "PR-T-2"), payments: [paid(450_000, "2025-06-01"), paid(450_000, "2026-06-01", "Another Supplier")] }]);
    expect(supplierPaidThisYear(p, "2026-11-20")).toMatchObject({ afn: 0, payments: 0 });
    expect(withholding(p, "2026-11-20")!.amount).toBe(0);
  });
});
