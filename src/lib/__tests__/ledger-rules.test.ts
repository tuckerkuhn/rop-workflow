import { describe, expect, it } from "vitest";
import { allocateCents, convertCents, donorReceipt, fromCents, LedgerRuleError, payment, reversal, toCents, totals } from "@/lib/ledger/rules";
import { DEFAULT_CHART, expenseCodeForKind } from "@/lib/ledger/chart";

const USD = "USD";
const base = { functionalCurrency: USD, date: "2027-01-05", memo: "Seed for the January planting" };

describe("money in cents, never floats", () => {
  it("reads and writes decimal strings exactly", () => {
    expect(toCents("1234.5")).toBe(BigInt(123450));
    expect(toCents("0.01")).toBe(BigInt(1));
    expect(toCents(12)).toBe(BigInt(1200));
    expect(fromCents(BigInt(123450))).toBe("1234.50");
    expect(fromCents(BigInt(-5))).toBe("-0.05");
    // Sixteen digits do not fit a float without loss; they fit here.
    expect(fromCents(toCents("99999999999999.99"))).toBe("99999999999999.99");
  });
  it("refuses fractions of a cent and words", () => {
    expect(() => toCents("1.005")).toThrow(LedgerRuleError);
    expect(() => toCents("ten")).toThrow(LedgerRuleError);
  });
  it("converts with the rate, half a cent rounding away from zero", () => {
    expect(convertCents(BigInt(100), "0.01428571")).toBe(BigInt(1)); // 1.00 AFN at 0.01428571 = 0.0142857 USD, rounds to 0.01
    expect(convertCents(BigInt(1000000), "0.01428571")).toBe(BigInt(14286)); // 10,000.00 AFN = 142.8571 USD, so 142.86
    expect(convertCents(BigInt(50), "0.5")).toBe(BigInt(25));
    expect(convertCents(BigInt(1), "0.5")).toBe(BigInt(1)); // 0.005 rounds up to 0.01
  });
  it("shares a total across parts so the cents add up exactly", () => {
    // Three equal parts of 1.00: 0.34 + 0.33 + 0.33, the extra cent to the first.
    expect(allocateCents(BigInt(100), [BigInt(1), BigInt(1), BigInt(1)])).toEqual([BigInt(34), BigInt(33), BigInt(33)]);
    expect(allocateCents(BigInt(0), [BigInt(5), BigInt(5)])).toEqual([BigInt(0), BigInt(0)]);
    const parts = allocateCents(BigInt(142857), [BigInt(333333), BigInt(333333), BigInt(333334)]);
    expect(parts.reduce((a, b) => a + b, BigInt(0))).toBe(BigInt(142857));
  });
});

describe("record a payment", () => {
  it("debits the expense with its donor, project and budget line and credits the bank", () => {
    const e = payment({
      ...base,
      paidFrom: "bank",
      currency: USD,
      fxRate: "1",
      expenses: [{ accountId: "program", amount: "250.00", donorId: "d1", projectId: "p1", budgetLineId: "b1" }],
    });
    expect(e.kind).toBe("payment");
    expect(e.lines).toHaveLength(2);
    const [exp, bank] = e.lines;
    expect(exp).toMatchObject({ accountId: "program", debit: "250.00", credit: "0.00", functionalDebit: "250.00", functionalCredit: "0.00", donorId: "d1", projectId: "p1", budgetLineId: "b1" });
    expect(bank).toMatchObject({ accountId: "bank", debit: "0.00", credit: "250.00", functionalCredit: "250.00", projectId: "p1" });
    expect(totals(e.lines).balanced).toBe(true);
  });

  it("balances in the functional currency when a rate leaves fractions of a cent", () => {
    // 3 lines of 3,333.33 AFN at 0.01428571: each is 47.619...; the bank side is 142.857 → 142.86.
    const e = payment({
      ...base,
      paidFrom: "bank",
      currency: "AFN",
      fxRate: "0.01428571",
      expenses: [
        { accountId: "program", amount: "3333.33", budgetLineId: "b1" },
        { accountId: "program", amount: "3333.33", budgetLineId: "b2" },
        { accountId: "ops", amount: "3333.34", budgetLineId: "b3" },
      ],
    });
    const t = totals(e.lines);
    expect(t.balanced).toBe(true);
    expect(t.functionalCredit).toBe("142.86");
    expect(t.functionalDebit).toBe("142.86");
    // Each line is still within a cent of its own amount times the rate.
    for (const l of e.lines.slice(0, 3)) {
      const exact = Number(l.debit) * 0.01428571;
      expect(Math.abs(Number(l.functionalDebit) - exact)).toBeLessThan(0.01);
    }
    expect(e.lines.every((l) => l.currency === "AFN" && l.fxRate === "0.01428571")).toBe(true);
  });

  it("refuses a rate other than 1 for the functional currency, a zero amount or a missing rate", () => {
    const ok = { ...base, paidFrom: "bank", expenses: [{ accountId: "program", amount: "10" }] };
    expect(() => payment({ ...ok, currency: USD, fxRate: "1.1" })).toThrow(/rate/);
    expect(() => payment({ ...ok, currency: "AFN", fxRate: "0" })).toThrow(/rate/);
    expect(() => payment({ ...ok, currency: USD, fxRate: "1", expenses: [{ accountId: "program", amount: "0" }] })).toThrow(/more than zero/);
    expect(() => payment({ ...ok, currency: USD, fxRate: "1", expenses: [] })).toThrow();
    expect(() => payment({ ...ok, currency: USD, fxRate: "1", date: "5 Jan" })).toThrow(/date/);
  });
});

describe("record donor money received", () => {
  it("debits the bank and credits restricted revenue, both marked with the donor", () => {
    const e = donorReceipt({ ...base, depositedTo: "bank", revenueAccountId: "grants", donorId: "d1", projectId: "p1", currency: "EUR", fxRate: "1.08", amount: "10000" });
    expect(e.kind).toBe("donor_receipt");
    const [bank, rev] = e.lines;
    expect(bank).toMatchObject({ accountId: "bank", debit: "10000.00", functionalDebit: "10800.00", donorId: "d1" });
    expect(rev).toMatchObject({ accountId: "grants", credit: "10000.00", functionalCredit: "10800.00", donorId: "d1", projectId: "p1" });
    expect(totals(e.lines).balanced).toBe(true);
  });
});

describe("reverse an entry", () => {
  it("swaps every debit and credit, keeps the rate and points to the original, so the two net to zero", () => {
    const original = payment({ ...base, paidFrom: "bank", currency: "AFN", fxRate: "0.01428571", expenses: [{ accountId: "program", amount: "3333.33", donorId: "d1", budgetLineId: "b1" }, { accountId: "ops", amount: "1.01" }] });
    const r = reversal({ id: "entry-1", lines: original.lines, projectId: null }, { date: "2027-02-01", memo: "Paid twice by mistake" });
    expect(r.kind).toBe("reversal");
    expect(r.reversesId).toBe("entry-1");
    const net = new Map<string, bigint>();
    for (const l of [...original.lines, ...r.lines]) {
      const k = `${l.accountId}|${l.donorId ?? ""}|${l.budgetLineId ?? ""}`;
      net.set(k, (net.get(k) ?? BigInt(0)) + toCents(l.functionalDebit) - toCents(l.functionalCredit));
    }
    expect([...net.values()].every((v) => v === BigInt(0))).toBe(true);
    expect(r.lines[0]).toMatchObject({ debit: original.lines[0].credit, credit: original.lines[0].debit, donorId: "d1", budgetLineId: "b1" });
    expect(totals(r.lines).balanced).toBe(true);
  });
});

describe("the default chart", () => {
  it("has about 25 accounts with unique codes and an expense account for each budget line kind", () => {
    expect(DEFAULT_CHART.length).toBeGreaterThanOrEqual(22);
    expect(DEFAULT_CHART.length).toBeLessThanOrEqual(30);
    expect(new Set(DEFAULT_CHART.map((a) => a.code)).size).toBe(DEFAULT_CHART.length);
    for (const kind of ["program", "personnel", "operations"] as const) {
      const a = DEFAULT_CHART.find((x) => x.code === expenseCodeForKind(kind));
      expect(a?.type, kind).toBe("expense");
    }
  });
});
