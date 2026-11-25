import { describe, expect, it } from "vitest";
import { activityHeading, buildRows, emptyQpr, narrativeActivities, suggestComment, surveyDueIn, type IndicatorInfo } from "@/lib/qpr";
import { peopleCount, peopleList } from "@/lib/people-words";
import { dataChecks } from "@/lib/data-checks";
import { result } from "./fixtures";

/** What a walk-through of the demo quarterly report found. Synthetic figures only. */

const ind = (over: Partial<IndicatorInfo> = {}): IndicatorInfo => ({ code: "IND-1", donorCode: "1.1.1.1", name: "Farmers trained", unit: "farmers", target: 300, yearTargets: { "2026": 100 }, result: "Output 1.1", disaggregation: ["sex"], budgetRef: null, level: "output", ...over });

describe("narrative sections come only from workplan activities", () => {
  const names = new Map([
    ["1.1.1", "Train farmers in land preparation and planting"],
    ["1.1.2", "Visit farms and check readiness"],
  ]);
  const list = [
    ind(),
    ind({ code: "IND-4", donorCode: "1.1.2.1" }),
    // An outcome measured at the outcome, with the donor's outcome code.
    ind({ code: "IND-3", donorCode: "1.a", level: "outcome" }),
    // The income goal: no donor code, so its code would read "IND".
    ind({ code: "IND-5", donorCode: null, level: "goal" }),
  ];

  it("gives no section for an outcome code or a target with no donor code", () => {
    const acts = narrativeActivities(list, names);
    expect(acts).toEqual([
      { code: "1.1.1", name: "Train farmers in land preparation and planting" },
      { code: "1.1.2", name: "Visit farms and check readiness" },
    ]);
    expect(acts.map((a) => a.code)).not.toContain("1.a");
    expect(acts.map((a) => a.code)).not.toContain("IND");
  });

  it("an outcome-looking code is left out even at output level; so is an activity the workplan does not name is left out", () => {
    expect(narrativeActivities([ind({ donorCode: "1.a" }), ind({ code: "IND-9", donorCode: "2.1.1.1" })], names)).toEqual([]);
  });

  it("with no workplan names, numeric activity codes still get a section, headed by the code alone", () => {
    const acts = narrativeActivities(list, new Map());
    expect(acts.map((a) => a.code)).toEqual(["1.1.1", "1.1.2"]);
    expect(activityHeading(acts[0])).toBe("Activity 1.1.1");
    expect(activityHeading({ code: "1.1.1", name: "Train farmers" })).toBe("Activity 1.1.1: Train farmers");
  });
});

describe("a survey target before its survey is due", () => {
  const income = ind({ code: "IND-5", donorCode: null, level: "goal", unit: "% vs baseline", target: 25, yearTargets: {}, measure: "change", baseline: 410, frequency: "end_of_season" });
  const seasonEnds = ["2027-10-31"];

  it("is due at the end of its season, or every period when measured monthly or quarterly", () => {
    expect(surveyDueIn("end_of_season", "2026-10-01", "2026-12-31", seasonEnds)).toBe(false);
    expect(surveyDueIn("end_of_season", "2027-10-01", "2027-12-31", seasonEnds)).toBe(true);
    expect(surveyDueIn("quarterly", "2026-10-01", "2026-12-31", seasonEnds)).toBe(true);
    // With no seasons known, the year's last period.
    expect(surveyDueIn("end_of_season", "2026-07-01", "2026-09-30")).toBe(false);
    expect(surveyDueIn("end_of_season", "2026-10-01", "2026-12-31")).toBe(true);
  });

  it("is on track with a not-yet-measured comment, not Not implemented", () => {
    const [row] = buildRows([income], [], "2026-Q4", emptyQpr("Sandbox"), {}, undefined, seasonEnds);
    expect(row.status).toBe("on_track");
    expect(row.comment).toBe("On track. Measured by the end-of-season survey; no survey result yet.");
    expect(row.surveyDue).toEqual({ quarter: false, year: false });
  });

  it("once its season has ended with no survey, it is late as before", () => {
    const [row] = buildRows([income], [], "2027-Q4", emptyQpr("Sandbox"), {}, undefined, seasonEnds);
    expect(row.status).toBe("not_implemented");
    expect(row.comment).toContain("no survey result has been accepted yet this year");
    expect(row.surveyDue).toEqual({ quarter: true, year: true });
  });

  it("a latest target with its survey in keeps its figure", () => {
    const share = { ...income, measure: "latest" as const, unit: "% of farmers", yearTargets: { "2026": 60 } };
    const [row] = buildRows([share], [result({ indicator: "IND-5", date: "2026-11-10", value: 40 })], "2026-Q4", emptyQpr("Sandbox"), {}, undefined, seasonEnds);
    expect(row.year).toBe(40);
    expect(row.comment).toContain("the latest survey");
  });
});

describe("one woman, one man", () => {
  it("counts people in the singular for one", () => {
    expect(peopleCount(1, "women")).toBe("1 woman");
    expect(peopleCount(1, "men")).toBe("1 man");
    expect(peopleCount(1, "youth")).toBe("1 young person");
    expect(peopleCount(0, "women")).toBe("0 women");
    expect(peopleCount(2, "youth")).toBe("2 young people");
    expect(peopleList({ women: 0, men: 1 })).toBe("0 women, 1 man");
    expect(peopleList({ women: 1, men: 1, youth: 1 }, " and ")).toBe("1 woman and 1 man and 1 young person");
  });

  it("the report's comment says 1 man, not 1 men", () => {
    const [row] = buildRows([ind()], [result({ indicator: "IND-1", date: "2026-11-10", value: 1, female: 0, male: 1 })], "2026-Q4", emptyQpr("Sandbox"));
    expect(row.comment).toContain("(0 women, 1 man)");
    const [one] = buildRows([ind()], [result({ indicator: "IND-1", date: "2026-11-10", value: 1, female: 1, male: 0 })], "2026-Q4", emptyQpr("Sandbox"));
    expect(one.comment).toContain("(1 woman, 0 men)");
    expect(suggestComment({ ...row, women: 3, men: 2 }, "on_track", "Q4 2026")).toContain("(3 women, 2 men)");
  });

  it("the data check says 1 woman and 1 man", () => {
    const r = result({ indicator: "IND-1", date: "2026-11-10", value: 3, female: 1, male: 1 });
    expect(dataChecks(r, [r], { code: "IND-1", unit: "farmers", disaggregation: [] }).join(" ")).toContain("1 woman and 1 man make 2, not 3.");
  });
});
