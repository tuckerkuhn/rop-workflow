import { describe, expect, it } from "vitest";
import { defaultMeasure, measured, measureOf, measureValue, yearPart } from "@/lib/measure";
import { buildPeriodRows } from "@/lib/period-report";
import { buildRows, emptyQpr, type IndicatorInfo } from "@/lib/qpr";
import { totalsOf } from "@/lib/results";
import { result } from "./fixtures";

/** Synthetic figures only. */
const counts = { baseline: null, unit: "farmers" };
const income = { baseline: 1200, unit: "% vs baseline" };
const yieldKg = { baseline: 800, unit: "kg per hectare" };

describe("measured: the figure to report for one target", () => {
  const list = [
    result({ date: "2026-03-10", value: 1000 }),
    result({ date: "2026-09-20", value: 1500 }),
    result({ date: "2026-06-05", value: 1300 }),
    // Not accepted: never the figure.
    result({ date: "2026-10-01", value: 9999, status: "pending" }),
    result({ date: "2026-10-02", value: 8888, status: "queried" }),
  ];

  it("sum: adds every accepted result, exactly as totalsOf", () => {
    const m = measured(counts, list, "sum");
    expect(m.value).toBe(3800);
    expect(m.reported).toBe(3800);
    expect(m.state).toBe("ok");
    const { value, female, male, youth, womenLed, menLed, provinces, records, files } = m;
    expect({ value, female, male, youth, womenLed, menLed, provinces, records, files }).toEqual(totalsOf(list));
    expect(measured(counts, list, "sum", "2026-04-01", "2026-06-30").value).toBe(1300);
  });

  it("latest: the most recent accepted result, in the range asked", () => {
    expect(measureValue(counts, list, "latest")).toBe(1500);
    expect(measureValue(counts, list, "latest", undefined, "2026-06-30")).toBe(1300);
    const m = measured(counts, list, "latest");
    expect(m.records).toBe(1);
    expect(m.date).toBe("2026-09-20");
  });

  it("latest: two on the same day, the one recorded last", () => {
    const same = [result({ date: "2026-05-01", value: 40, at: "2026-05-01T08:00:00Z" }), result({ date: "2026-05-01", value: 55, at: "2026-05-02T08:00:00Z" })];
    expect(measureValue(counts, same, "latest")).toBe(55);
  });

  it("change with a percent unit: the percent change from the baseline", () => {
    // (1500 - 1200) / 1200 = 25%
    expect(measureValue(income, list, "change")).toBe(25);
    expect(measureValue(income, list, "change", undefined, "2026-03-31")).toBe(-16.7);
  });

  it("change with any other unit: the difference from the baseline", () => {
    expect(measureValue(yieldKg, list, "change")).toBe(700);
  });

  it("change with no baseline: no figure, Baseline needed (not 0)", () => {
    const m = measured({ baseline: null, unit: "% vs baseline" }, list, "change");
    expect(m.reported).toBeNull();
    expect(m.state).toBe("baseline_needed");
    expect(m.note).toBe("Baseline needed");
    // A percent change from a baseline of 0 cannot be worked out either.
    expect(measured({ baseline: 0, unit: "%" }, list, "change").note).toBe("Baseline needed");
    // A difference from 0 can.
    expect(measureValue({ baseline: 0, unit: "kg" }, list, "change")).toBe(1500);
  });

  it("latest or change with no accepted result: No survey yet", () => {
    const none = [result({ value: 50, status: "pending" })];
    for (const m of ["latest", "change"] as const) {
      const x = measured(income, none, m);
      expect(x.reported).toBeNull();
      expect(x.note).toBe("No survey yet");
    }
    expect(measured(income, [], "latest").state).toBe("no_survey");
    // A sum with nothing is simply 0.
    expect(measured(counts, [], "sum")).toMatchObject({ value: 0, reported: 0, note: null });
  });
});

describe("the measure a target uses", () => {
  it("adds up unless saved otherwise", () => {
    expect(defaultMeasure({ source: "results", unit: "% vs baseline" })).toBe("sum");
    expect(measureOf(null, { code: "IND-1", source: "results", unit: "farmers" })).toBe("sum");
    expect(measureOf({ "IND-1": "latest" }, { code: "IND-1", source: "results", unit: "farmers" })).toBe("latest");
    // Something that is not a measure is ignored.
    expect(measureOf({ "IND-1": "average" }, { code: "IND-1", source: "results", unit: "farmers" })).toBe("sum");
  });
  it("a survey target takes its default from its unit", () => {
    expect(defaultMeasure({ source: "survey", unit: "% vs baseline" })).toBe("change");
    expect(defaultMeasure({ source: "survey", unit: "% of farmers" })).toBe("latest");
  });
  it("a survey figure's year target is the figure expected by year end, not a running total's difference", () => {
    const i = { target: 25, yearTargets: { "2026": 10, "2027": 25 } };
    expect(yearPart(i, 2027)).toBe(15);
    expect(yearPart({ ...i, measure: "change" }, 2027)).toBe(25);
    expect(yearPart({ ...i, measure: "latest" }, 2026)).toBe(10);
  });
});

const ind = (over: Partial<IndicatorInfo> = {}): IndicatorInfo => ({ code: "IND-5", donorCode: "G.1", name: "Change in net farm income", unit: "% vs baseline", target: 25, yearTargets: { "2026": 25 }, result: "Goal", disaggregation: null, budgetRef: null, ...over });

describe("a change target in the quarterly table", () => {
  const surveys = [result({ indicator: "IND-5", date: "2026-02-15", value: 1100 }), result({ indicator: "IND-5", date: "2026-08-20", value: 1500, female: 40, male: 60 })];

  it("shows the change from the baseline for the quarter and the year", () => {
    const [row] = buildRows([ind({ measure: "change", baseline: 1200 })], surveys, "2026-Q3", emptyQpr("Sandbox"));
    expect(row.quarter).toBe(25);
    expect(row.year).toBe(25);
    expect(row.yearTarget).toBe(25);
    expect(row.status).toBe("completed");
    expect(row.note).toEqual({ quarter: null, year: null });
    expect(row.records.quarter).toBe(1);
    expect(row.comment).toContain("the latest survey");
    expect(row.comment).toContain("against the baseline of 1,200");
  });

  it("a quarter with no survey says so, while the year keeps the latest", () => {
    const [row] = buildRows([ind({ measure: "change", baseline: 1200 })], surveys, "2026-Q2", emptyQpr("Sandbox"));
    expect(row.note).toEqual({ quarter: "No survey yet", year: null });
    // Q1's survey: (1100 - 1200) / 1200
    expect(row.year).toBe(-8.3);
  });

  it("with no baseline: Baseline needed in place of both figures", () => {
    const [row] = buildRows([ind({ measure: "change", baseline: null })], surveys, "2026-Q3", emptyQpr("Sandbox"));
    expect(row.note).toEqual({ quarter: "Baseline needed", year: "Baseline needed" });
    expect(row.year).toBe(0);
    expect(row.comment).toContain("baseline is recorded on Target details");
  });

  it("an indicator with no measure keeps exactly the row it had", () => {
    const counts = [result({ indicator: "IND-5", date: "2026-08-20", value: 30 }), result({ indicator: "IND-5", date: "2026-09-01", value: 12 })];
    const [plain] = buildRows([ind({ unit: "farmers", yearTargets: { "2026": 100, "2027": 300 }, target: 300 })], counts, "2026-Q3", emptyQpr("Sandbox"));
    const [sum] = buildRows([ind({ unit: "farmers", yearTargets: { "2026": 100, "2027": 300 }, target: 300, measure: "sum" })], counts, "2026-Q3", emptyQpr("Sandbox"));
    expect(plain.quarter).toBe(42);
    expect(plain.yearTarget).toBe(100);
    expect(plain).not.toHaveProperty("measure");
    expect(plain).not.toHaveProperty("note");
    expect(sum).toEqual(plain);
  });
});

describe("a change target in the annual report", () => {
  it("compares the latest survey with the baseline and says when it cannot", () => {
    const surveys = [result({ indicator: "IND-5", date: "2026-08-20", value: 1500 })];
    const [row] = buildPeriodRows([{ ...ind({ measure: "change" }), baseline: 1200 }], surveys, { kind: "annual", year: 2026 }, "2026-01-01", "2027-12-31");
    expect(row.achieved).toBe(25);
    expect(row.pct).toBe(100);
    expect(row.verdict).toBe("met");
    expect(row.parts.map((p) => p.value)).toEqual([0, 0, 25, 0]);
    const [none] = buildPeriodRows([{ ...ind({ measure: "change" }), baseline: null }], surveys, { kind: "annual", year: 2026 }, "2026-01-01", "2027-12-31");
    expect(none.note).toEqual({ achieved: "Baseline needed", cumulative: "Baseline needed" });
    expect(none.pct).toBeNull();
  });
});
