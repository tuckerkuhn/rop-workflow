import { describe, expect, it } from "vitest";
import { ourWork } from "@/lib/budget";
import { budgetView, LIMITS, spentOver } from "@/lib/budget-view";
import { checksFor, emptyQpr, overspentLines, type Spend } from "@/lib/qpr";
import { screeningStale, supplierGaps, type Supplier } from "@/lib/suppliers";

/** Each figure has one function. These tests pin that the screens that show it agree. */

describe("overspent: one rule for the budget page, Home, the report and pre-flight", () => {
  const spend = (actual: number, budget = 1000): Spend => ({ currency: "USD", budget: 5000, cumulative: 1000, quarter: 100, withOverhead: false, source: { kind: "budget", at: null }, phases: [], missingMonths: [], byLine: { "PRG-1": { budget, actual, quarter: 0 } } });
  const flagged = (actual: number) =>
    budgetView({ lines: [{ code: "PRG-1", description: "x", activityCode: "1.1", activity: "A", kind: "program", currency: "USD", amount: 1000, schedule: {} }], imported: [{ code: "PRG-1", description: "x", budget: 1000, actual, months: {} }], months: ["2026-09"], currency: "USD", start: "2026-01-01", end: "2026-12-31", results: [] }).activities[0].lines[0].flags.some((f) => f.level === "stop");
  const inReport = (actual: number) => overspentLines(spend(actual), emptyQpr("Sandbox")).length === 1;
  const inChecks = (actual: number) => checksFor([], [], "2026-Q3", emptyQpr("Sandbox"), spend(actual), []).some((c) => /Budget line PRG-1/.test(c.text));

  it("the tolerance is half a percent of what was approved", () => {
    expect(LIMITS.overPct).toBe(0.5);
    expect(spentOver(1005, 1000)).toBe(false);
    expect(spentOver(1005.01, 1000)).toBe(true);
  });
  it.each([900, 1000, 1004, 1005, 1006, 1500])("spent %i of 1,000: every screen gives the same answer", (actual) => {
    expect(inReport(actual)).toBe(flagged(actual));
    expect(inChecks(actual)).toBe(flagged(actual));
  });
  it("a line with no budget is not called overspent in the report", () => {
    expect(overspentLines(spend(50, 0), emptyQpr("Sandbox"))).toEqual([]);
  });
});

describe("our rows in a consortium workplan: one rule", () => {
  const rows = [{ code: "1.1", org: "ROP" }, { code: "1.2", org: "FAO" }, { code: "1.3", org: "Roots of Peace" }, { code: "1.4", org: "ROP/FAO" }, { code: "1.5", org: null }];
  it("keeps rows marked as ours, however the partner column spells it", () => {
    expect(ourWork(rows).map((r) => r.code)).toEqual(["1.1", "1.3", "1.4"]);
  });
  it("keeps every row when none is marked as ours", () => {
    const all = [{ code: "1.1", org: null }, { code: "1.2", org: "" }];
    expect(ourWork(all)).toEqual(all);
  });
  it("does not take another word that contains the letters", () => {
    expect(ourWork([{ code: "1", org: "Europe Aid" }, { code: "2", org: "ROP" }]).map((r) => r.code)).toEqual(["2"]);
  });
});

describe("supplier screening out of date: one rule for the register and the procurement steps", () => {
  it("is out of date six calendar months after the screening", () => {
    expect(screeningStale("2026-01-01", "2026-06-30")).toBe(false);
    expect(screeningStale("2026-01-01", "2026-07-01")).toBe(true);
    expect(screeningStale("2026-01-31", "2026-07-30")).toBe(false);
    expect(screeningStale("2026-01-01", "2026-04-01", 3)).toBe(true);
  });
  it("the register's own list of gaps uses it", () => {
    const s = { status: "active", suspendedWhy: "", screenings: [{ date: "2026-01-01", result: "clear", byName: "t" }], licenceNo: "L1", licenceEvidence: "https://example.sharepoint.com/x" } as unknown as Supplier;
    expect(supplierGaps(s, "2026-06-30").some((g) => /Last screened/.test(g))).toBe(false);
    expect(supplierGaps(s, "2026-07-01").some((g) => /Last screened/.test(g))).toBe(true);
  });
});
