import { describe, expect, it } from "vitest";
import { donorFundingSchema, donorMoney, fundingFor, grantTotal, roleOf, type LineInfo } from "@/lib/donor-funding";
import type { Spend } from "@/lib/qpr";

/** What each donor funds, and the money a donor is shown from a released report's figures. */

const info: LineInfo[] = [
  { code: "1.1", description: "Seedlings", activityCode: "1.1.1", activity: "Distribute seedlings" },
  { code: "1.2", description: "Training", activityCode: "1.2.1", activity: "Train farmers" },
  { code: "2.1", description: "Staff", activityCode: null, activity: null },
  { code: "3.1", description: "Partner contribution", activityCode: null, activity: null },
];
const spend = (over: Partial<Spend> = {}): Spend => ({
  currency: "USD",
  budget: 1080,
  cumulative: 432,
  quarter: 216,
  withOverhead: true,
  source: { kind: "import", files: [] },
  phases: [{ period: "Jan 2026 – Dec 2026", budget: 1080, actual: 432 }],
  missingMonths: [],
  byLine: { "1.1": { budget: 400, actual: 200, quarter: 100 }, "1.2": { budget: 300, actual: 100, quarter: 50 }, "2.1": { budget: 200, actual: 80, quarter: 40 }, "3.1": { budget: 100, actual: 20, quarter: 10 } },
  ...over,
});

describe("which setting applies to a donor", () => {
  it("is the saved one", () => {
    expect(fundingFor({ a: { lines: ["1.1"], share: [] } }, "a", 2)).toEqual({ lines: ["1.1"], share: [] });
  });
  it("is the whole budget for a project's only donor with nothing saved", () => {
    expect(fundingFor({}, "a", 1)).toEqual({ lines: "all", share: [] });
  });
  it("is nothing when several donors share a project and nobody has said", () => {
    expect(fundingFor({}, "a", 2)).toBeNull();
    expect(fundingFor({ b: { lines: "all", share: [] } }, "a", 2)).toBeNull();
  });
});

describe("a budget line's place in a donor's view", () => {
  it("is paid by the grant, cost share or not theirs", () => {
    const f = { lines: ["1.1", "1.2"], share: ["3.1"] };
    expect(roleOf(f, "1.1")).toBe("funded");
    expect(roleOf(f, "3.1")).toBe("share");
    expect(roleOf(f, "2.1")).toBeNull();
  });
  it("counts a cost-share line once, as cost share, even with the whole budget", () => {
    expect(roleOf({ lines: "all", share: ["3.1"] }, "3.1")).toBe("share");
    expect(roleOf({ lines: ["3.1"], share: ["3.1"] }, "3.1")).toBe("share");
    expect(roleOf({ lines: "all", share: ["3.1"] }, "1.1")).toBe("funded");
  });
});

describe("a donor's money from a released report", () => {
  it("lists every line of a grant that pays for the whole budget, in the budget's order", () => {
    const m = donorMoney(spend(), { lines: "all", share: [] }, info);
    expect(m.funded.lines.map((l) => l.code)).toEqual(["1.1", "1.2", "2.1", "3.1"]);
    expect(m.funded).toMatchObject({ approved: 1000, spent: 400, inQuarter: 200 });
    expect(m.funded.lines[0]).toMatchObject({ description: "Seedlings", activity: "Distribute seedlings", approved: 400, spent: 200, inQuarter: 100 });
    expect(m.share).toBeNull();
  });
  it("gives indirect costs as the report's total less its lines, and adds them to the grant's total", () => {
    const m = donorMoney(spend(), { lines: "all", share: [] }, info);
    expect(m.indirect).toEqual({ approved: 80, spent: 32 });
    expect(m.indirectNote).toBeNull();
    expect(grantTotal(m)).toEqual({ approved: 1080, spent: 432 });
  });
  it("shows only the chosen lines to a donor who funds part of the budget, with no indirect figure", () => {
    const m = donorMoney(spend(), { lines: ["1.2", "1.1"], share: [] }, info);
    expect(m.funded.lines.map((l) => l.code)).toEqual(["1.1", "1.2"]);
    expect(m.funded).toMatchObject({ approved: 700, spent: 300, inQuarter: 150 });
    expect(m.indirect).toBeNull();
    expect(m.indirectNote).toBe("partial");
    expect(grantTotal(m)).toEqual({ approved: 700, spent: 300 });
  });
  it("keeps cost share in its own block, out of the grant's totals", () => {
    const m = donorMoney(spend(), { lines: "all", share: ["3.1"] }, info);
    expect(m.funded.lines.map((l) => l.code)).toEqual(["1.1", "1.2", "2.1"]);
    expect(m.funded.approved).toBe(900);
    expect(m.share).toMatchObject({ approved: 100, spent: 20, inQuarter: 10 });
    expect(m.share!.lines.map((l) => l.code)).toEqual(["3.1"]);
  });
  it("gives no indirect figure when the report's figures have none, or cover more than one phase", () => {
    const direct = donorMoney(spend({ withOverhead: false, budget: 1000, cumulative: 400 }), { lines: "all", share: [] }, info);
    expect(direct.indirect).toBeNull();
    expect(direct.indirectNote).toBe("none");
    const phases = donorMoney(spend({ phases: [{ period: "a", budget: 500, actual: 300 }, { period: "b", budget: 580, actual: 132 }] }), { lines: "all", share: [] }, info);
    expect(phases.indirect).toBeNull();
    expect(phases.indirectNote).toBe("phases");
  });
  it("keeps the report's currency and says where the figures came from", () => {
    const m = donorMoney(spend({ currency: "AFN", source: { kind: "budget", at: "2026-10-01" } }), { lines: "all", share: [] }, info);
    expect(m.currency).toBe("AFN");
    expect(m.fromImport).toBe(false);
    expect(donorMoney(spend(), { lines: "all", share: [] }, info).fromImport).toBe(true);
  });
  it("still lists a line the report has and the budget no longer does, last and under its code", () => {
    const m = donorMoney(spend({ byLine: { ...spend().byLine, "9.9": { budget: 50, actual: 5, quarter: 0 } } }), { lines: "all", share: [] }, info);
    expect(m.funded.lines.at(-1)).toMatchObject({ code: "9.9", description: "9.9", activity: null, approved: 50 });
  });
});

describe("the saved shape", () => {
  it("accepts the whole budget or a list of lines, and defaults cost share to none", () => {
    expect(donorFundingSchema.parse({ lines: "all" })).toEqual({ lines: "all", share: [] });
    expect(donorFundingSchema.parse({ lines: ["1.1"], share: ["3.1"] })).toEqual({ lines: ["1.1"], share: ["3.1"] });
    expect(donorFundingSchema.safeParse({ lines: "some" }).success).toBe(false);
  });
});
