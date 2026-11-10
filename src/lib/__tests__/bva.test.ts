import { describe, expect, it } from "vitest";
import { monthOf, numberOf, readIce, spentIn } from "@/lib/bva";
import { budgetView, type BudgetLineIn } from "@/lib/budget-view";

describe("reading Finance's workbook cells", () => {
  it("reads month headings", () => {
    expect(monthOf("Jul'26 Actual")).toBe("2026-07");
    expect(monthOf("Jan-Feb'26 Actual")).toBe("2026-02");
    expect(monthOf("March'26 Actual")).toBe("2026-03");
    expect(monthOf("Oct 2026")).toBe("2026-10");
    expect(monthOf("Total Budget")).toBeNull();
  });
  it("reads numbers the way accountants write them", () => {
    expect(numberOf("(36,620)")).toBe(-36620);
    expect(numberOf("$8,011")).toBe(8011);
    expect(numberOf("-")).toBe(0);
    expect(numberOf("")).toBeNull();
    expect(numberOf({ result: 12.5 })).toBe(12.5);
    expect(numberOf({ error: "#REF!" })).toBeNull();
    expect(numberOf("n/a")).toBeNull();
  });
});

/** A small synthetic sheet in the ICE layout. */
const sheet = (over: { total?: number; dup?: boolean } = {}): unknown[][] => [
  [72, "Budget Exchange Rate"],
  ["Item No.", "Item Description", "Total Budget", "Total Actual Expenditures", "Jul'26 Actual", "Aug'26 Actual", "Sep'26 Actual"],
  [],
  ["PRG-1.1", "Training", 1000, 600, 100, 200, 300],
  [over.dup ? "PRG-1.1" : "PRG-1.2", "Tools", 500, 150, 0, 50, 100],
  ["OPS-1", "Office rent", 300, 300, 100, 100, 100],
  ["Total Costs", "", 1800, over.total ?? 1050, 200, 350, 500],
];

describe("readIce", () => {
  it("reads every line, its months and the totals", () => {
    const b = readIce(sheet(), "ICE Report");
    expect(b.problems).toEqual([]);
    expect(b.lines.map((l) => l.code)).toEqual(["PRG-1.1", "PRG-1.2", "OPS-1"]);
    expect(b.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(b.lines[0]).toMatchObject({ budget: 1000, actual: 600, months: { "2026-07": 100, "2026-08": 200, "2026-09": 300 } });
    expect(b.totals.costs).toMatchObject({ budget: 1800, actual: 1050 });
    expect(b.totals.grand).toMatchObject({ budget: 1800, actual: 1050 });
    expect(b.rate).toBe(72);
  });
  it("refuses a sheet whose lines do not add up to its own total", () => {
    expect(readIce(sheet({ total: 5000 }), "ICE Report").problems.some((p) => /add up to 1,050/.test(p))).toBe(true);
  });
  it("refuses a budget line that appears twice", () => {
    expect(readIce(sheet({ dup: true }), "ICE Report").problems).toContain("PRG-1.1 appears twice.");
  });
  it("refuses a line whose months do not add up to its total", () => {
    const rows = sheet();
    rows[3] = ["PRG-1.1", "Training", 1000, 900, 100, 200, 300];
    expect(readIce(rows, "ICE Report").problems.some((p) => /^PRG-1.1: the monthly actuals add up to 600/.test(p))).toBe(true);
  });
  it("says so when the sheet is not in this shape", () => {
    expect(readIce([["Account", "Amount"]], "Sheet1").problems[0]).toMatch(/no header row/);
  });
});

describe("spentIn: spending in a range of months", () => {
  const b = readIce(sheet(), "ICE Report");
  it("adds the months in range, both ends included", () => {
    const s = spentIn(b, "2026-08", "2026-09");
    expect(s.byLine).toEqual({ "PRG-1.1": 500, "PRG-1.2": 150, "OPS-1": 200 });
    expect(s.total).toBe(850);
  });
  it("the whole range equals the sheet's own total", () => {
    expect(spentIn(b, "2026-07", "2026-09").total).toBe(b.totals.costs!.actual);
  });
  it("is zero outside the import", () => {
    expect(spentIn(b, "2027-01", "2027-03").total).toBe(0);
  });
});

describe("budgetView: budget against spending", () => {
  const line = (code: string, over: Partial<BudgetLineIn> = {}): BudgetLineIn => ({ code, description: code, activityCode: "1.1", activity: "Training", kind: "program", currency: "USD", amount: 1000, schedule: {}, ...over });
  const view = (imported: { code: string; budget: number; actual: number }[], lines = [line("PRG-1"), line("PRG-2")]) =>
    budgetView({ lines, imported: imported.map((i) => ({ description: i.code, months: {}, ...i })), months: ["2026-07", "2026-08", "2026-09"], currency: "USD", start: "2026-01-01", end: "2026-12-31", results: [] });
  it("totals are the sum of the lines", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 400 }, { code: "PRG-2", budget: 500, actual: 100 }]);
    expect(v.totals).toMatchObject({ approved: 1500, spent: 500, revised: 2000 });
    expect(v.activities[0].spent).toBe(500);
    expect(v.activities[0].spentPct).toBe(33.3);
  });
  it("stops on a line spent above approved", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 1010 }]);
    const flags = v.activities[0].lines.find((l) => l.code === "PRG-1")!.flags;
    expect(flags[0].level).toBe("stop");
    expect(flags[0].text).toMatch(/Spent 1,010 of 1,000 approved/);
  });
  it("does not flag spending exactly at approved", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 1000 }], [line("PRG-1")]);
    expect(v.activities[0].lines[0].flags.filter((f) => f.level === "stop")).toEqual([]);
  });
  it("asks to check a forecast more than 10% above approved", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 700 }], [line("PRG-1", { schedule: { "2026-10-01": 450 } })]);
    const l = v.activities[0].lines[0];
    expect(l.forecast).toBe(1150);
    expect(l.flags.some((f) => f.level === "check" && /above the 1,000 approved/.test(f.text))).toBe(true);
  });
  it("leaves the schedule of months already imported out of the forecast", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 700 }], [line("PRG-1", { schedule: { "2026-07-01": 300, "2026-10-01": 100 } })]);
    expect(v.activities[0].lines[0].remainingPlanned).toBe(100);
  });
  it("lists spending that matches no budget line, and budget lines with no spending row", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 400 }, { code: "XYZ-9", budget: 0, actual: 75 }]);
    expect(v.notInBudget).toEqual([{ code: "XYZ-9", description: "XYZ-9", actual: 75 }]);
    expect(v.notInFile.map((l) => l.code)).toEqual(["PRG-2"]);
  });
  it("works out the share of time gone at the end of the last imported month", () => {
    const v = view([{ code: "PRG-1", budget: 1000, actual: 400 }]);
    expect(v.timeGone).toBeGreaterThan(0.74);
    expect(v.timeGone).toBeLessThan(0.76);
  });
});
