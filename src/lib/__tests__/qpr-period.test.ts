import { describe, expect, it } from "vitest";
import { periodEndMonths, qprKeyHolding, qprKeyOf, qprPeriod, qprPeriodList, quarterlyObligation } from "@/lib/obligations";
import { againstCeiling, ceilingWords, sheetCurrency } from "@/lib/project-origin";
import { breakdownsFor, buildRows, emptyQpr, photosFor, type IndicatorInfo } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";
import { result } from "./fixtures";

/**
 * The quarterly report on the donor's own periods (lib/obligations qprPeriod): calendar quarters
 * with no obligations, the same dates with only the agreement's name when its quarters are the
 * calendar's, and the agreement's own months when they are not. And the budget against the award
 * ceiling from the won proposal (lib/project-origin).
 */

const ob = (periodEnds: number[], over: Partial<{ frequency: "quarterly" | "annual"; report: "quarterly" | "financial" }> = {}) => ({
  name: "Quarterly progress report",
  report: "quarterly" as "quarterly" | "financial",
  frequency: "quarterly" as const,
  periodEnds,
  daysAfter: 30,
  dueDates: [],
  ...over,
});
const FEB = periodEndMonths("quarterly", 2); // quarters Feb to Apr, May to Jul, Aug to Oct, Nov to Jan
const OCT = periodEndMonths("quarterly", 10); // Oct to Dec: calendar quarters

describe("qprPeriod: a quarter key and the period it stands for", () => {
  it("with no obligations is the calendar quarter, as before", () => {
    expect(qprPeriod("2026-Q4", null, "2026-10-01", "2028-12-31")).toEqual({ quarter: "2026-Q4", ...quarterRange("2026-Q4"), label: "Q4 2026", name: null, number: null, calendar: true });
  });

  it("with agreement quarters on the calendar's months keeps the dates and adds the agreement's name", () => {
    const p = qprPeriod("2027-Q1", ob(OCT), "2026-10-01", "2028-12-31");
    expect(p).toMatchObject({ ...quarterRange("2027-Q1"), name: "Quarterly progress report", number: 2, calendar: true });
  });

  it("with agreement quarters off the calendar is the agreement's months, under the quarter its last day is in", () => {
    const p = qprPeriod("2026-Q2", ob(FEB), "2026-02-01", "2028-01-31");
    expect(p).toMatchObject({ from: "2026-02-01", to: "2026-04-30", label: "Feb to Apr 2026", number: 1, calendar: false });
    expect(qprPeriod("2027-Q1", ob(FEB), "2026-02-01", "2028-01-31")).toMatchObject({ from: "2026-11-01", to: "2027-01-31", label: "Nov 2026 to Jan 2027", number: 4 });
  });

  it("maps each period to its own key and back, one after another", () => {
    const keys = ["2026-Q2", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2"];
    const periods = keys.map((k) => qprPeriod(k, ob(FEB), "2026-02-01", "2028-01-31"));
    expect(periods.map(qprKeyOf)).toEqual(keys);
    for (let k = 1; k < periods.length; k++) expect(periods[k].from > periods[k - 1].to).toBe(true);
  });

  it("cuts a period to the project's dates, but keeps its key", () => {
    // The project starts on 1 October, inside the August to October quarter.
    expect(qprPeriod("2026-Q4", ob(FEB), "2026-10-01", "2028-12-31")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "Aug to Oct 2026", number: 1 });
  });

  it("finds the key of the period holding a day", () => {
    expect(qprKeyHolding(ob(FEB), "2026-11-20")).toBe("2027-Q1");
    expect(qprKeyHolding(ob(OCT), "2026-11-20")).toBe("2026-Q4");
    expect(qprKeyHolding(null, "2026-11-20")).toBe("2026-Q4");
  });

  it("lists the agreement's periods to choose from, newest first; none to list for calendar quarters", () => {
    expect(qprPeriodList(ob(FEB), "2026-10-01", "2028-12-31", "2026-11-20")?.map((p) => [p.quarter, p.label])).toEqual([
      ["2027-Q1", "Nov 2026 to Jan 2027"],
      ["2026-Q4", "Aug to Oct 2026"],
    ]);
    expect(qprPeriodList(ob(OCT), "2026-10-01", "2028-12-31", "2026-11-20")).toBeNull();
    expect(qprPeriodList(null, "2026-10-01", "2028-12-31", "2026-11-20")).toBeNull();
  });

  it("follows a narrative quarterly report before a financial one, and ignores other frequencies", () => {
    const fin = { ...ob(OCT), report: "financial" as const, name: "Financial report" };
    const narrative = ob(FEB);
    expect(quarterlyObligation([fin, narrative])).toBe(narrative);
    expect(quarterlyObligation([ob([12], { frequency: "annual" })])).toBeNull();
  });
});

describe("the report counts by the period's real dates", () => {
  const ind: IndicatorInfo = { code: "IND-1", donorCode: "1.1.1-A", name: "Farmers trained", unit: "farmers", target: 300, yearTargets: { "2026": 300 }, result: "Output 1.1", disaggregation: [], budgetRef: null };
  const results = [
    result({ date: "2026-02-10", value: 5, status: "accepted", province: "Kandahar" }),
    result({ date: "2026-04-20", value: 7, status: "accepted", province: "Helmand" }),
    result({ date: "2026-05-15", value: 11, status: "accepted", province: "Kandahar" }),
  ];

  it("counts a calendar quarter as before when no range is given", () => {
    const [row] = buildRows([ind], results, "2026-Q2", emptyQpr("P"));
    expect(row.quarter).toBe(18);
    expect(breakdownsFor([row], results, "2026-Q2")[0].title).toMatch(/\(2026 Q2\)$/);
  });

  it("counts the agreement's months and names them", () => {
    const p = qprPeriod("2026-Q2", ob(FEB), "2026-01-01", "2028-12-31");
    const range = { from: p.from, to: p.to, label: p.label };
    const [row] = buildRows([ind], results, "2026-Q2", emptyQpr("P"), {}, range);
    expect(row.quarter).toBe(12);
    expect(row.comment).toContain("During Feb to Apr 2026");
    expect(breakdownsFor([row], results, "2026-Q2", range)[0].title).toMatch(/\(Feb to Apr 2026\)$/);
  });

  it("counts this year from 1 January when the period begins in the year before: November is not counted again in the new year", () => {
    const late = [result({ date: "2026-11-20", value: 4, status: "accepted" }), result({ date: "2027-01-05", value: 6, status: "accepted" })];
    const p = qprPeriod("2027-Q1", ob(FEB), "2026-01-01", "2028-12-31");
    const [row] = buildRows([{ ...ind, yearTargets: { "2027": 300 } }], late, "2027-Q1", emptyQpr("P"), {}, p);
    expect([row.quarter, row.year]).toEqual([10, 6]);
  });

  it("takes photos from the period, not the calendar quarter", () => {
    const withPhoto = [result({ date: "2026-02-10", value: 1, status: "accepted", files: [{ hash: "h1", name: "a.jpg", type: "image/jpeg", size: 1 }], captions: { h1: "Training" } })];
    const [row] = buildRows([ind], withPhoto, "2026-Q2", emptyQpr("P"));
    expect(photosFor([row], withPhoto, [], "2026-Q2")).toHaveLength(0);
    expect(photosFor([row], withPhoto, [], "2026-Q2", qprPeriod("2026-Q2", ob(FEB), "2026-01-01", null))).toHaveLength(1);
  });
});

describe("the budget against the award ceiling", () => {
  const award = { currency: "EUR", ceiling: 500_000 };

  it("warns when the total is above the ceiling, without blocking", () => {
    const c = againstCeiling(520_000, "EUR", award)!;
    expect(c.over).toBe(20_000);
    const w = ceilingWords(c);
    expect(w.ceiling).toBe("Award ceiling: EUR 500,000");
    expect(w.warning).toBe("The budget total is EUR 20,000 above the award ceiling. Check it against the signed agreement, which may differ from the proposal.");
    expect(w.line).toBe("Award ceiling: EUR 500,000. Budget total EUR 520,000: EUR 20,000 above it.");
  });

  it("does not warn at or under the ceiling", () => {
    expect(ceilingWords(againstCeiling(480_000, "EUR", award)!)).toMatchObject({ warning: null, line: "Award ceiling: EUR 500,000. Budget total EUR 480,000: EUR 20,000 under it." });
  });

  it("does not compare a budget in another currency, and shows nothing without a ceiling", () => {
    const c = againstCeiling(900_000, "USD", award)!;
    expect(c.over).toBeNull();
    expect(ceilingWords(c).warning).toBeNull();
    expect(againstCeiling(900_000, "EUR", { currency: "EUR", ceiling: null })).toBeNull();
    expect(againstCeiling(900_000, "EUR", null)).toBeNull();
  });

  it("defaults a sheet's currency to the award's when the sheet names none", () => {
    // The sheet reader falls back to USD when the sheet names no currency.
    expect(sheetCurrency("USD", "Code Description Quantity Unit cost Total", "EUR")).toBe("EUR");
    expect(sheetCurrency("USD", "Budget in USD Code Description Total", "EUR")).toBe("USD");
    expect(sheetCurrency("GTQ", "Total (GTQ)", "USD")).toBe("GTQ");
    expect(sheetCurrency("USD", "Code Total", null)).toBe("USD");
  });
});
