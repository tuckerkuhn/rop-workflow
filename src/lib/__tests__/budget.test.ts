import { describe, expect, it } from "vitest";
import { addMonths, num, parseBudget, quarterEnd, quarterStart, text } from "@/lib/budget";

describe("budget sheet helpers", () => {
  it("reads numbers and refuses text", () => {
    expect(num("1,250.50")).toBe(1250.5);
    expect(num(42)).toBe(42);
    expect(num("")).toBeNull();
    expect(num("12 units")).toBeNull();
    expect(num(Number.NaN)).toBeNull();
    expect(text("  a   b ")).toBe("a b");
  });
  it("steps months across a year", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(quarterEnd("2026-10-01")).toBe("2026-12-31");
    expect(quarterEnd("2027-01-01")).toBe("2027-03-31");
  });
  it("reads the quarter a heading names", () => {
    expect(quarterStart("Oct-Dec'26")).toBe("2026-10-01");
    expect(quarterStart("Jan - Mar 2027")).toBe("2027-01-01");
    expect(quarterStart("Q1 2027")).toBe("2027-01-01");
    expect(quarterStart("2027 Q3")).toBe("2027-07-01");
    expect(quarterStart("Nov-Jan'27")).toBe("2026-11-01");
    expect(quarterStart("Oct 2026 - Jun 2027")).toBeNull();
    expect(quarterStart("Total")).toBeNull();
  });
});

describe("parseBudget: a donor's budget sheet", () => {
  const grid = [
    ["Sandbox project budget (USD)"],
    ["Code", "Activity", "Description", "Unit", "Quantity", "Unit cost", "Total", "Oct-Dec'26", "Jan-Mar'27"],
    ["PRG-1.1", "1.1", "Farmer training", "session", 10, 100, 1000, 400, 600],
    ["PRG-1.2", "1.2", "Hand tools", "set", 50, 10, 500, 500, 0],
    ["Total", "", "", "", "", "", 1500, 900, 600],
  ];
  const parsed = parseBudget(grid);
  it("finds the header row and the lines", () => {
    expect(parsed).not.toBeNull();
    expect(parsed!.headerRow).toBe(1);
    expect(parsed!.lines.map((l) => l.code)).toEqual(["PRG-1.1", "PRG-1.2"]);
  });
  it("reads each line's amount, never the sheet's total row as a line", () => {
    const sum = parsed!.lines.reduce((t, l) => t + (l.total ?? 0), 0);
    expect(sum).toBe(1500);
    expect(parsed!.lines.some((l) => /^total$/i.test(l.code ?? ""))).toBe(false);
  });
  it("keeps each line's row in the sheet as its source", () => {
    expect(parsed!.rows).toEqual([3, 4]);
  });
});
