import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { confirmLinks, loadTargetDetails, saveTargetDetails } from "@/server/target-details";
import { ready } from "@/server/__tests__/test-db";

/**
 * Suggested links on Target details: suggestions are shown, never saved on their own; "Use all
 * suggestions" saves only what the person confirmed, fills only empty links and logs each change
 * like a save by hand. Synthetic data only.
 */
const code = "TEST-LINKS";
const marcus = userById("marcus")!;
const omar = userById("omar")!;
let projectId = "";
const links = async () => (await db.select({ code: s.indicators.code, workplanCode: s.indicators.workplanCode, budgetRef: s.indicators.budgetRef }).from(s.indicators).where(eq(s.indicators.projectId, projectId)).orderBy(asc(s.indicators.position)));
const audit = async () => db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "target_details_set"))).orderBy(asc(s.auditLog.sequence));

beforeAll(async () => {
  await ready;
  await seedDatabase();
  const [org] = await db.select().from(s.organizations);
  const [project] = await db.insert(s.projects).values({ organizationId: org.id, code, name: "Test links project", country: "AF", stage: "Execute", kind: "real", startDate: "2026-01-01", endDate: "2027-12-31" }).returning();
  projectId = project.id;
  const ind = (n: number, o: Partial<typeof s.indicators.$inferInsert>) => ({ projectId, code: `IND-${n}`, name: `Target ${n}`, unit: "farmers", target: "100", level: "output" as const, source: "results", frequency: "quarterly" as const, position: n, ...o });
  await db.insert(s.indicators).values([
    ind(1, { donorCode: "1.2.1.1", name: "Farmer groups given certified seed" }),
    ind(2, { result: "Farmers trained in improved land preparation" }),
    ind(3, { donorCode: "1.2.1.2", name: "Trellis demonstration plots built", workplanCode: "1.2.1.2" }),
    ind(4, { result: "Women-led households report higher income" }),
  ]);
  await db.insert(s.workplanItems).values([
    { projectId, code: "1.1.1.1", activityCode: "1.1.1", title: "Train farmers in improved land preparation", org: "ROP", sort: 0 },
    { projectId, code: "1.2.1.1", activityCode: "1.2.1", title: "Distribute certified seed to farmer groups", org: "ROP", sort: 1 },
    { projectId, code: "1.2.1.2", activityCode: "1.2.1", title: "Build trellis demonstration plots", org: "ROP", sort: 2 },
  ]);
  await db.insert(s.budgetLines).values([
    { projectId, code: "PRG-1.2.1.A", activityCode: "1.2.1", description: "Certified seed for farmer groups", amount: "1000", sort: 0 },
    { projectId, code: "PRG-1.2.1.B", activityCode: "1.2.1", description: "Trellis posts for demonstration plots", amount: "2000", sort: 1 },
    { projectId, code: "PRG-1.1.1.A", activityCode: "1.1.1", description: "Trainer fees for land preparation training", amount: "500", sort: 2 },
  ]);
}, 120_000);

describe("suggested links on Target details", { timeout: 60_000 }, () => {
  it("shows a suggestion for each target missing a link and saves nothing by itself", async () => {
    const v = await loadTargetDetails(code, marcus);
    expect(v.suggestions.map((x) => [x.indicator, x.workplan?.code ?? null, x.budget.map((b) => b.code)])).toEqual([
      ["IND-1", "1.2.1.1", ["PRG-1.2.1.A"]],
      ["IND-2", "1.1.1.1", ["PRG-1.1.1.A"]],
      ["IND-3", null, ["PRG-1.2.1.B"]],
    ]);
    expect((await links()).every((l) => l.budgetRef === null)).toBe(true);
    expect(await audit()).toEqual([]);
  });

  it("only someone who may edit targets uses a suggestion", async () => {
    expect(await confirmLinks(code, { links: [{ indicator: "IND-1", workplanCode: "1.2.1.1" }] }, omar)).toMatchObject({ status: 403 });
    expect(await audit()).toEqual([]);
  });

  it("refuses a link that is not in the plan and saves none of the list", async () => {
    expect(await confirmLinks(code, { links: [{ indicator: "IND-1", workplanCode: "1.2.1.1" }, { indicator: "IND-2", budgetRef: "NOPE" }] }, marcus)).toMatchObject({ status: 400 });
    expect((await links())[0].workplanCode).toBeNull();
  });

  it("'Use all' writes only the confirmed links, keeps one set by hand and logs each like a save", async () => {
    // Someone sets IND-2's workplan item by hand after the page loaded.
    expect(await saveTargetDetails(code, { indicator: "IND-2", baseline: null, breakdown: [], verification: "", budgetRef: "", workplanCode: "1.2.1.1", inQuarterlyReport: true }, marcus)).toBeNull();
    const before = (await audit()).length;
    expect(
      await confirmLinks(
        code,
        {
          links: [
            { indicator: "IND-1", workplanCode: "1.2.1.1", budgetRef: "PRG-1.2.1.A" },
            { indicator: "IND-2", workplanCode: "1.1.1.1", budgetRef: "PRG-1.1.1.A" },
            { indicator: "IND-3", budgetRef: "PRG-1.2.1.B" },
          ],
        },
        marcus,
      ),
    ).toBeNull();
    expect(await links()).toEqual([
      { code: "IND-1", workplanCode: "1.2.1.1", budgetRef: "PRG-1.2.1.A" },
      { code: "IND-2", workplanCode: "1.2.1.1", budgetRef: "PRG-1.1.1.A" },
      { code: "IND-3", workplanCode: "1.2.1.2", budgetRef: "PRG-1.2.1.B" },
      { code: "IND-4", workplanCode: null, budgetRef: null },
    ]);
    const added = (await audit()).slice(before).map((a) => a.detail as { code: string; changes: unknown; from: string });
    expect(added.map((d) => [d.code, d.changes, d.from])).toEqual([
      ["IND-1", { workplanCode: { from: null, to: "1.2.1.1" }, budgetRef: { from: null, to: "PRG-1.2.1.A" } }, "suggestion"],
      ["IND-2", { budgetRef: { from: null, to: "PRG-1.1.1.A" } }, "suggestion"],
      ["IND-3", { budgetRef: { from: null, to: "PRG-1.2.1.B" } }, "suggestion"],
    ]);
    // Every link set: nothing left to suggest. IND-4 never matched anything..
    expect((await loadTargetDetails(code, marcus)).suggestions).toEqual([]);
  });
});

describe("target details on a signed-off plan (decision 7, 25 Nov 2026)", { timeout: 60_000 }, () => {
  const call = async (as: string, reason?: string) => {
    const { POST } = await import("@/app/api/projects/[code]/targets/route");
    const body = { indicator: "IND-4", baseline: 12, breakdown: [], verification: "", budgetRef: "", workplanCode: "", inQuarterlyReport: true };
    const headers: Record<string, string> = { "x-demo-user": as, "content-type": "application/json", ...(reason ? { "x-change-reason": encodeURIComponent(reason) } : {}) };
    return POST(new Request(`http://test/api/projects/${code}/targets`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ code }) });
  };
  it("needs a written reason from a plan approver, and logs it", async () => {
    process.env.DEMO_SIGN_IN = "1";
    const no = await call("marcus");
    expect(no.status).toBe(409);
    expect(((await no.json()) as { needsReason?: boolean }).needsReason).toBe(true);
    expect((await call("marcus", "The baseline survey came back after sign-off.")).status).toBe(200);
    const rows = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "plan_changed_after_signoff")));
    expect(rows.at(-1)?.detail).toMatchObject({ reason: "The baseline survey came back after sign-off.", targetDetails: "IND-4" });
  });
});
