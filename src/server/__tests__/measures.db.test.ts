import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { ResultInput } from "@/lib/results";
import { seedDatabase } from "@/server/demo-seed";
import { periodReport } from "@/server/period-report-store";
import { preflight } from "@/server/preflight";
import { loadProgress } from "@/server/progress-store";
import { qprData } from "@/server/qpr-store";
import { addResult, reviewResult } from "@/server/results-store";
import { loadTargetDetails, saveTargetDetails } from "@/server/target-details";
import { loadFramework } from "@/server/framework-store";
import { loadReview } from "@/server/monthly-review-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * An outcome measured by a survey against its baseline: until its measure is set, every figure is
 * the sum it always was; once set to "change", the quarterly table, the annual report and Progress
 * give the change from the baseline, or say "Baseline needed" and pre-flight lists it to fix.
 * Synthetic figures only.
 */
const code = "TEST-MEASURE";
const marcus = userById("marcus")!;
const omar = userById("omar")!;
const Q = "2026-Q3";
let projectId = "";
const input = (o: Partial<ResultInput> & Pick<ResultInput, "indicator" | "value" | "date">): ResultInput => ({ province: "Kabul", note: "End of season household survey, sample of 120 farmers.", files: [{ hash: "e".repeat(64), name: "survey.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 2000 }], ...o });
const details = (o: Partial<Parameters<typeof saveTargetDetails>[1]> = {}) => ({ indicator: "IND-2", baseline: null, breakdown: [], verification: "", budgetRef: "", workplanCode: "", inQuarterlyReport: true, ...o });
const row = async (c: string) => (await qprData(code, Q)).rows.find((r) => r.code === c)!;

beforeAll(async () => {
  await ready;
  await seedDatabase();
  const [org] = await db.select().from(s.organizations);
  const [project] = await db.insert(s.projects).values({ organizationId: org.id, code, name: "Test measure project", country: "AF", stage: "Execute", kind: "real", startDate: "2026-01-01", endDate: "2027-12-31" }).returning();
  projectId = project.id;
  await db.insert(s.indicators).values([
    { projectId, code: "IND-1", name: "Farmers trained", unit: "farmers", target: "300", forecast: { "2026": 100 }, level: "output", source: "results", frequency: "quarterly", position: 0 },
    { projectId, code: "IND-2", name: "Change in net farm income", unit: "% vs baseline", target: "25", forecast: { "2026": 25 }, level: "outcome", source: "results", frequency: "quarterly", position: 1 },
  ]);
  for (const r of [input({ indicator: "IND-1", value: 40, date: "2026-08-10" }), input({ indicator: "IND-1", value: 15, date: "2026-09-02" }), input({ indicator: "IND-2", value: 1500, date: "2026-08-20" })]) {
    const x = await addResult(code, r, "omar");
    await reviewResult(code, x.id, "accepted", "nadia", null);
  }
}, 120_000);

describe("a project with no measures document", { timeout: 60_000 }, () => {
  it("adds up every target as before and keeps the rows as they were", async () => {
    expect(await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, "measures")))).toEqual([]);
    const [a, b] = [await row("IND-1"), await row("IND-2")];
    expect(a.quarter).toBe(55);
    expect(b.year).toBe(1500);
    for (const r of [a, b]) {
      expect(r).not.toHaveProperty("measure");
      expect(r).not.toHaveProperty("note");
    }
    const t = await loadTargetDetails(code, marcus);
    expect(t.targets.map((x) => x.measure)).toEqual(["sum", "sum"]);
    const p = await loadProgress(code, marcus);
    expect(p.indicators.map((i) => i.total)).toEqual([55, 1500]);
    expect(p.indicators[1]).not.toHaveProperty("measure");
  });
});

describe("a target measured as a change from its baseline", { timeout: 60_000 }, () => {
  it("only someone who may edit targets sets the measure", async () => {
    expect(await saveTargetDetails(code, details({ measure: "change" }), omar)).toMatchObject({ status: 403 });
  });

  it("with no baseline shows Baseline needed while pre-flight lists it to fix on Target details", async () => {
    expect(await saveTargetDetails(code, details({ measure: "change" }), marcus)).toBeNull();
    const audit = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "target_details_set")));
    expect(audit.map((a) => (a.detail as { changes: unknown }).changes)).toEqual([{ measure: { from: "sum", to: "change" } }]);
    expect((await loadTargetDetails(code, marcus)).targets.map((x) => x.measure)).toEqual(["sum", "change"]);

    const r = await row("IND-2");
    expect(r.note).toEqual({ quarter: "Baseline needed", year: "Baseline needed" });
    // The target that adds up is untouched.
    expect(await row("IND-1")).not.toHaveProperty("note");
    const pf = await preflight(code, { kind: "qpr", quarter: Q });
    const item = pf.items.find((i) => i.key === "pf.c.baselineNeeded");
    expect(item).toMatchObject({ group: "fix", href: "/progress/targets#target-IND-2" });
    const p = (await loadProgress(code, marcus)).indicators[1];
    expect(p).toMatchObject({ total: null, measure: "change", measureState: "baseline_needed" });
    // The monthly review and the results framework (and the indicator table built from it) say the same.
    expect((await loadReview(code, "2026-09", marcus)).indicators.find((i) => i.code === "IND-2")).toMatchObject({ note: "Baseline needed", measure: "change" });
    expect((await loadReview(code, "2026-09", marcus)).indicators.find((i) => i.code === "IND-1")).not.toHaveProperty("note");
    const fw = await loadFramework(code, marcus);
    expect(fw.unplaced.find((l) => l.code === "IND-2")).toMatchObject({ note: "Baseline needed" });
    expect(fw.unplaced.find((l) => l.code === "IND-1")).not.toHaveProperty("note");
  });

  it("with its baseline gives the percent change everywhere the figure is read", async () => {
    expect(await saveTargetDetails(code, details({ baseline: 1200, measure: "change" }), marcus)).toBeNull();
    const r = await row("IND-2");
    // (1500 - 1200) / 1200
    expect(r.quarter).toBe(25);
    expect(r.year).toBe(25);
    expect(r.yearTarget).toBe(25);
    expect(r.note).toEqual({ quarter: null, year: null });
    const pf = await preflight(code, { kind: "qpr", quarter: Q });
    expect(pf.items.some((i) => i.key === "pf.c.baselineNeeded")).toBe(false);
    const annual = (await periodReport(code, { kind: "annual", year: 2026 })).rows.find((x) => x.code === "IND-2")!;
    expect(annual).toMatchObject({ achieved: 25, target: 25, verdict: "met" });
    expect((await loadProgress(code, marcus)).indicators[1].total).toBe(25);
    expect((await loadReview(code, "2026-09", marcus)).indicators.find((i) => i.code === "IND-2")).toMatchObject({ year: 25, quarterValue: 25 });
  });
});
