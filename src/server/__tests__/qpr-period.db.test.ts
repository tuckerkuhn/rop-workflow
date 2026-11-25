import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { GET as budgetRoute } from "@/app/api/projects/[code]/budget/route";
import { periodEndMonths, type SavedObligation } from "@/lib/obligations";
import { ceilingWords, ORIGIN_KEY } from "@/lib/project-origin";
import { quarterRange } from "@/lib/results";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { reportQuarter } from "@/server/next-report";
import { saveObligations } from "@/server/obligations-store";
import { loadBudget } from "@/server/plan-store";
import { preflight } from "@/server/preflight";
import { budgetCeiling } from "@/server/project-origin";
import { saveProjectState } from "@/server/project-state";
import { qprData, qprPeriodsFor } from "@/server/qpr-store";

/**
 * The quarterly report on the donor's own periods, and the budget against the award ceiling. The
 * demo project starts on 1 October 2026; its accepted results fall in October and November.
 */
const code = "A-2027";
let projectId = "";

const ob = (periodEnds: number[]): SavedObligation => ({
  donorId: null,
  report: "quarterly",
  name: "Quarterly progress report",
  frequency: "quarterly",
  periodEnds,
  daysAfter: 30,
  dueDates: [],
  format: "",
  formatFile: null,
  source: "Agreement, clause 8.2",
  by: "nadia",
  at: "2026-10-01T00:00:00Z",
});
/** What the report counts, without the parts that name the period. */
const counted = (d: Awaited<ReturnType<typeof qprData>>) => ({ rows: d.rows.map((r) => [r.code, r.quarter, r.year, r.records]), spend: d.spend, updates: d.updates, photos: d.photos.length, breakdowns: d.breakdowns, checks: d.checks.map((c) => c.text) });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T12:00:00Z"), shouldAdvanceTime: true });
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  projectId = (await projectByCode(code)).id;
  await db.delete(s.projectState).where(and(eq(s.projectState.projectId, projectId), like(s.projectState.key, "qpr%")));
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("the quarterly report on the donor's own periods", { timeout: 60_000 }, () => {
  let before: ReturnType<typeof counted>;

  it("with no obligations counts the calendar quarter, as before", async () => {
    await saveObligations(projectId, []);
    const d = await qprData(code, "2026-Q4");
    expect(d.period).toEqual({ quarter: "2026-Q4", ...quarterRange("2026-Q4"), label: "Q4 2026", name: null, number: null, calendar: true });
    expect(await qprPeriodsFor(code)).toBeNull();
    expect(await reportQuarter(code, "2026-11-20")).toBe("2026-Q4");
    before = counted(d);
    expect(d.rows.find((r) => r.code === "IND-1")!.quarter).toBeGreaterThan(0);
  });

  it("with agreement quarters on the calendar's months changes only the name shown", async () => {
    await saveObligations(projectId, [ob(periodEndMonths("quarterly", 10))]);
    const d = await qprData(code, "2026-Q4");
    expect(d.period).toMatchObject({ ...quarterRange("2026-Q4"), name: "Quarterly progress report", number: 1, calendar: true });
    expect(counted(d)).toEqual(before);
    expect(await qprPeriodsFor(code)).toBeNull();
    expect((await preflight(code, { kind: "qpr", quarter: "2026-Q4" })).label).toBe("Quarterly report 2026 Q4");
  });

  it("with agreement quarters off the calendar counts results, spending and updates by the period's real dates", async () => {
    // Quarters from February: August to October (cut to the project's start), then November to January.
    await saveObligations(projectId, [ob(periodEndMonths("quarterly", 2))]);
    const oct = await qprData(code, "2026-Q4");
    const nov = await qprData(code, "2027-Q1");
    expect(oct.period).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "Aug to Oct 2026", calendar: false });
    expect(nov.period).toMatchObject({ from: "2026-11-01", to: "2027-01-31", label: "Nov 2026 to Jan 2027", calendar: false });
    const accepted = (d: typeof oct, ind: string) => d.results.filter((r) => r.indicator === ind && r.status === "accepted" && r.date >= d.period.from && r.date <= d.period.to).reduce((t, r) => t + r.value, 0);
    for (const d of [oct, nov]) for (const r of d.rows) expect(r.quarter).toBe(accepted(d, r.code));
    // October and November together are what the calendar quarter counted.
    const ind1 = (d: typeof oct) => d.rows.find((r) => r.code === "IND-1")!.quarter;
    expect(ind1(oct) + ind1(nov)).toBe(before.rows.find((r) => r[0] === "IND-1")![1]);
    expect(ind1(oct)).toBeLessThan(before.rows.find((r) => r[0] === "IND-1")![1] as number);
    for (const d of [oct, nov]) expect(d.updates.every((u) => u.date >= d.period.from && u.date <= d.period.to)).toBe(true);
    // The spending's months are the period's: November to January can be missing only months that are over.
    expect(nov.spend.missingMonths.every((m) => /Nov 2026/.test(m))).toBe(true);
    expect((await qprPeriodsFor(code, "2026-11-20"))?.map((p) => p.quarter)).toEqual(["2027-Q1", "2026-Q4"]);
    // The next report: October's, still within its 30 days; the label names the months.
    expect(await reportQuarter(code, "2026-11-20")).toBe("2026-Q4");
    expect((await preflight(code, { kind: "qpr", quarter: "2026-Q4" })).label).toBe("Quarterly report Aug to Oct 2026");
  });
});

describe("the budget against the award ceiling", { timeout: 60_000 }, () => {
  it("defaults to the award's currency and warns above the ceiling", async () => {
    const total = (await loadBudget(code)).lines.reduce((t, l) => t + l.total, 0);
    const currency = (await loadBudget(code)).currency;
    expect(await budgetCeiling(code)).toBeNull();
    await saveProjectState(projectId, ORIGIN_KEY, { proposalId: "P-1", opportunityId: null, title: "T", donor: "D", winThemes: [], documents: [], decidedAt: null, currency, ceiling: total - 1000, by: "nadia", at: "2026-10-01T00:00:00Z" });
    const res = await budgetRoute(new Request(`http://test/api/projects/${code}/budget`, { headers: { "x-demo-user": "nadia" } }), { params: Promise.resolve({ code }) });
    expect(((await res.json()) as { award: unknown }).award).toEqual({ currency, ceiling: total - 1000 });
    const c = (await budgetCeiling(code))!;
    expect(Math.round(c.over!)).toBe(1000);
    expect(ceilingWords(c).warning).toMatch(/above the award ceiling/);
  });
});
