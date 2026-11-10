import { describe, expect, it } from "vitest";
import { breakdownsFor, buildRows, checksFor, emptyQpr, prevQuarterOf, suggestStatus, yearShare, type IndicatorInfo, type Spend } from "@/lib/qpr";
import { result } from "./fixtures";

const ind = (over: Partial<IndicatorInfo> = {}): IndicatorInfo => ({ code: "IND-1", donorCode: "1.1.1-A", name: "Farmers trained", unit: "farmers", target: 300, yearTargets: { "2026": 100, "2027": 300 }, result: "Output 1.1", disaggregation: ["sex"], budgetRef: null, ...over });
const spend = (over: Partial<Spend> = {}): Spend => ({ currency: "USD", budget: 1000, cumulative: 400, quarter: 100, withOverhead: false, source: { kind: "budget", at: null }, phases: [], missingMonths: [], byLine: {}, ...over });
const Q = "2026-Q3";

describe("yearShare: this year's part of a running target", () => {
  it("is this year's total less last year's", () => {
    expect(yearShare(ind(), 2026)).toBe(100);
    expect(yearShare(ind(), 2027)).toBe(200);
  });
  it("falls back to the whole target when the year has none", () => {
    expect(yearShare(ind({ yearTargets: {} }), 2026)).toBe(300);
  });
  it("is never negative", () => {
    expect(yearShare(ind({ yearTargets: { "2026": 100, "2027": 50 } }), 2027)).toBe(0);
  });
});

describe("suggestStatus", () => {
  it("target reached: completed", () => expect(suggestStatus(100, 100, 2)).toBe("completed"));
  it("nothing planned and nothing done: not started", () => expect(suggestStatus(0, 0, 2)).toBe("not_started"));
  it("Q4 short of target: delayed, or not implemented when nothing happened", () => {
    expect(suggestStatus(40, 100, 4)).toBe("delayed");
    expect(suggestStatus(0, 100, 4)).toBe("not_implemented");
  });
  it("before the planned window: not started, not late", () => expect(suggestStatus(0, 100, 1, false, [3, 4])).toBe("not_started"));
  it("in the window's last quarter with nothing: delayed", () => expect(suggestStatus(0, 100, 3, false, [2, 3])).toBe("delayed"));
  it("after the window closed short: delayed", () => expect(suggestStatus(10, 100, 3, true, [1, 2])).toBe("delayed"));
  it("no workplan link before Q4: on track once anything is recorded", () => {
    expect(suggestStatus(10, 100, 2)).toBe("on_track");
    expect(suggestStatus(0, 100, 2)).toBe("not_started");
  });
  it("a monthly review inside the quarter does not call work late yet", () => {
    expect(suggestStatus(0, 100, 3, false, [3], false)).toBe("not_started");
    expect(suggestStatus(10, 100, 4, true, null, false)).toBe("on_track");
  });
});

describe("buildRows: the indicator table", () => {
  const results = [
    result({ date: "2026-02-10", value: 20, female: 8, male: 12, province: "Kandahar" }),
    result({ date: "2026-07-10", value: 30, female: 10, male: 20, province: "Kandahar" }),
    result({ date: "2026-09-30", value: 5, female: 5, male: 0, province: "Helmand" }),
    result({ date: "2026-08-01", value: 99, female: 99, male: 0, status: "pending" }),
    result({ date: "2026-10-01", value: 7, female: 3, male: 4, province: "Kandahar" }),
    result({ date: "2026-08-01", value: 1000, indicator: "IND-2" }),
  ];
  const [row] = buildRows([ind()], results, Q, emptyQpr("Sandbox"));
  it("counts the quarter and the year to the quarter's end, accepted only", () => {
    expect(row.quarter).toBe(35);
    expect(row.year).toBe(55);
    expect(row.yearTarget).toBe(100);
  });
  it("keeps women and men separate, for the quarter", () => {
    expect(row.women).toBe(15);
    expect(row.men).toBe(20);
  });
  it("counts records, proof files and records still open", () => {
    expect(row.records).toEqual({ quarter: 2, year: 3, files: 2, open: 1 });
  });
  it("names the provinces when every counted record has one", () => {
    expect([...row.provinces].sort()).toEqual(["Helmand", "Kandahar"]);
  });
  it("names no province when a counted record has none", () => {
    const [r] = buildRows([ind()], [...results, result({ date: "2026-08-20", value: 1 })], Q, emptyQpr("Sandbox"));
    expect(r.provinces).toEqual([]);
  });
  it("suggests a status and writes a comment that starts with it", () => {
    expect(row.suggested).toBe("on_track");
    expect(row.comment.startsWith("On track:")).toBe(true);
    expect(row.comment).toContain("55 of 100 farmers");
    expect(row.comment).toContain("15 women, 20 men");
    expect(row.edited).toBe(false);
  });
  it("keeps the team's own status and comment", () => {
    const saved = { ...emptyQpr("Sandbox"), rows: { "IND-1": { status: "delayed" as const, comment: "Delayed: rain.", by: "t", at: "2026-10-01" } } };
    const [r] = buildRows([ind()], results, Q, saved);
    expect(r.status).toBe("delayed");
    expect(r.comment).toBe("Delayed: rain.");
    expect(r.edited).toBe(true);
  });
  it("reads the planned quarters of this year from the workplan", () => {
    const [r] = buildRows([ind({ workplanCode: "1.1.1.3" })], results, Q, emptyQpr("Sandbox"), { "1.1.1.3": ["2026-07-01", "2026-10-01", "2027-01-01"] });
    expect(r.planned).toEqual([3, 4]);
  });
});

describe("checksFor: what stops a report", () => {
  const run = (results = [result({ date: "2026-08-01" })], saved = emptyQpr("Sandbox"), s = spend()) => {
    const rows = buildRows([ind()], results, Q, saved);
    return checksFor(rows, results, Q, saved, s, ["1.1.1"]);
  };
  const stops = (list: { level: string; text: string }[]) => list.filter((c) => c.level === "stop").map((c) => c.text);
  it("stops on a result still waiting for MEL", () => {
    expect(stops(run([result({ date: "2026-08-01", status: "pending" })])).some((t) => /waiting for MEL/.test(t))).toBe(true);
  });
  it("warns, without stopping, on an accepted result with no proof", () => {
    const out = run([result({ date: "2026-08-01", files: [], noFile: "On paper" })]);
    expect(out.find((c) => /no proof attached/.test(c.text))?.level).toBe("check");
  });
  it("stops when a row is marked Completed short of its target", () => {
    const saved = { ...emptyQpr("Sandbox"), rows: { "IND-1": { status: "completed" as const, by: "t", at: "2026-10-01" } } };
    expect(stops(run(undefined, saved)).some((t) => /marked Completed/.test(t))).toBe(true);
  });
  it("stops when an edited comment gives a percentage the figures do not", () => {
    const saved = { ...emptyQpr("Sandbox"), rows: { "IND-1": { comment: "On track: 80% of the annual target.", by: "t", at: "2026-10-01" } } };
    expect(stops(run(undefined, saved)).some((t) => /the comment says 80%/.test(t))).toBe(true);
  });
  it("stops when spending is above the budget or the quarter above the total", () => {
    expect(stops(run(undefined, undefined, spend({ cumulative: 1200 }))).some((t) => /more than the budget/.test(t))).toBe(true);
    expect(stops(run(undefined, undefined, spend({ quarter: 500 }))).some((t) => /more than cumulative/.test(t))).toBe(true);
  });
  it("stops when the spending import misses a month of the quarter", () => {
    const s = spend({ source: { kind: "import", files: [] }, missingMonths: ["2026-09"] });
    expect(stops(run(undefined, undefined, s)).some((t) => /does not include 2026-09/.test(t))).toBe(true);
  });
  it("asks for an explanation of an overspent budget line, once", () => {
    const s = spend({ byLine: { "PRG-1": { budget: 100, actual: 150, quarter: 50 } } });
    expect(run(undefined, undefined, s).some((c) => /Budget line PRG-1/.test(c.text))).toBe(true);
    const saved = { ...emptyQpr("Sandbox"), overspend: { "PRG-1": { text: "Approved realignment in August.", by: "t", at: "2026-10-01" } } };
    expect(run(undefined, saved, s).some((c) => /Budget line PRG-1/.test(c.text))).toBe(false);
  });
  it("ignores results outside the quarter", () => {
    expect(stops(run([result({ date: "2026-10-05", status: "pending" })])).some((t) => /waiting for MEL/.test(t))).toBe(false);
  });
});

describe("breakdownsFor: by place and sex", () => {
  const results = [
    result({ date: "2026-07-10", value: 30, female: 10, male: 20, province: "Kandahar", district: "Dand" }),
    result({ date: "2026-08-10", value: 5, female: 5, male: 0, province: "Helmand" }),
    result({ date: "2026-08-11", value: 4, female: 1, male: 3 }),
    result({ date: "2026-08-12", value: 50, female: 25, male: 25, province: "Helmand", status: "pending" }),
  ];
  const rows = buildRows([ind()], results, Q, emptyQpr("Sandbox"));
  const [b] = breakdownsFor(rows, results, Q);
  it("has women and men in their own columns", () => {
    expect(b.columns).toEqual(["Province", "District", "Quantity (farmers)", "Women", "Men"]);
  });
  it("totals to the indicator's own figure, with unplaced results in their own row", () => {
    const total = b.rows.at(-1)!;
    expect(total).toEqual(["Total", "", 39, 16, 23]);
    expect(total[2]).toBe(rows[0].quarter);
    expect(b.rows.some((r) => r[0] === "Not recorded" && r[2] === 4)).toBe(true);
  });
  it("leaves out an indicator with no place recorded", () => {
    const r2 = [result({ date: "2026-08-11", value: 4 })];
    expect(breakdownsFor(buildRows([ind()], r2, Q, emptyQpr("Sandbox")), r2, Q)).toEqual([]);
  });
});

describe("prevQuarterOf", () => {
  it("steps back across a year", () => {
    expect(prevQuarterOf("2026-Q3")).toBe("2026-Q2");
    expect(prevQuarterOf("2026-Q1")).toBe("2025-Q4");
  });
});
