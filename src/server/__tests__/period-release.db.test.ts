import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
// The annual report's check (server/preflight) is tested on its own; here it lets the release through.
vi.mock("@/server/preflight", async (orig) => ({ ...(await orig<typeof import("@/server/preflight")>()), preflight: vi.fn(async () => ({ items: [], ready: [] })) }));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DONOR_FUNDING_KEY } from "@/lib/donor-funding";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { GET, POST } from "@/app/api/projects/[code]/period-report/route";
import { userById } from "@/lib/demo";
import { PERIOD_COPIES } from "@/lib/period-report";
import { seedDatabase } from "@/server/demo-seed";
import { donorPeriodReport, donorView, releasedPhoto } from "@/server/donor-view-store";
import { projectByCode } from "@/server/field-store";
import { periodCopy, periodReport } from "@/server/period-report-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Releasing the annual and final reports to the donor, as quarterly reports are released: only
 * the person who releases reports, logged and frozen so later changes do not reach the donor.
 */
const code = "A-2027";
const elena = userById("elena")!;
let projectId = "";

const url = (q: string) => `http://test/api/projects/${code}/period-report?${q}`;
const ctx = { params: Promise.resolve({ code }) };
const release = async (as: string, q = "kind=annual&year=2026") => {
  const res = await POST(new Request(url(q), { method: "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify({ action: "release" }) }), ctx);
  return { status: res.status, body: (await res.json()) as { error?: string; released?: { by: string; at: string } | null; mayRelease?: boolean } };
};
const released = async () => (await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "period_released")))).length;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  projectId = (await projectByCode(code)).id;
  await db.delete(s.projectState).where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, PERIOD_COPIES)));
}, 120_000);

describe("releasing an annual or final report", { timeout: 60_000 }, () => {
  it("lets only the person who releases reports release it, once, logged", async () => {
    expect((await release("nadia")).status).toBe(403);
    expect((await release("omar")).status).toBe(403);
    expect((await release("elena")).status).not.toBe(200);
    expect(await periodCopy(code, { kind: "annual", year: 2026 })).toBeNull();
    expect(await released()).toBe(0);

    const r = await release("marcus");
    expect(r.status).toBe(200);
    expect(r.body.released?.by).toBe("marcus");
    expect(r.body.mayRelease).toBe(false);
    expect(await released()).toBe(1);
    const [entry] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, "period_released")));
    expect(entry.detail).toMatchObject({ by: "marcus", report: "Annual report 2026", key: "year:2026" });

    // A release is final: a second one is refused and not logged.
    expect((await release("marcus")).status).toBe(409);
    expect(await released()).toBe(1);
    expect((await release("marcus", "kind=weekly")).status).toBe(400);
  });

  it("lists the released annual report for the donor but not the final report that was not released", async () => {
    const v = await donorView(code, elena);
    expect(v.periods.map((p) => p.slug)).toEqual(["annual-2026"]);
    expect(v.periods[0].label).toBe("Annual report 2026");
    expect(await donorPeriodReport(code, "final", elena)).toBeNull();
    expect(await donorPeriodReport(code, "annual-2025", elena)).toBeNull();
    expect(await donorPeriodReport(code, "nonsense", elena)).toBeNull();

    const r = (await donorPeriodReport(code, "annual-2026", elena))!;
    expect(r.report.label).toBe("Annual report 2026");
    expect(r.report.rows.length).toBeGreaterThan(0);
    expect(r.report.project.donor).toBe(elena.org);
    // Only text from released quarters. Nobody is named: no lesson writer, no farmer.
    expect(r.report.narrative.every((sec) => sec.parts.every((x) => !("released" in x)))).toBe(true);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/byName|"by"/);
    const names = (await db.select({ name: s.farmerPii.fullName }).from(s.farmerPii).innerJoin(s.farmers, eq(s.farmers.id, s.farmerPii.farmerId)).where(eq(s.farmers.projectId, projectId))).map((x) => x.name);
    for (const name of names) expect(text).not.toContain(name);
    expect(await releasedPhoto(code, "final", "f".repeat(64))).toBe(false);
    expect(await releasedPhoto(code, "annual-2026", "f".repeat(64))).toBe(false);
  });

  // Decision AF, 25 Nov 2026: a donor's annual report gives the lines their grant pays, with the whole agreement as context.
  it("gives a donor the lines their grant pays first, and the whole agreement as one line of context", async () => {
    const r = (await donorPeriodReport(code, "annual-2026", elena))!.report;
    expect(r.spend).toMatchObject({ currency: "USD", budget: 346200, withOverhead: true, grant: { approved: 193200, indirectShown: false } });
    expect(r.spend!.grant!.spent).toBeGreaterThan(0);
    expect(r.spend!.grant!.spent).toBeLessThan(r.spend!.cumulative);
    // The same approved figure her quarterly report gives for her grant.
    const quarterly = (await donorView(code, elena)).money;
    if (quarterly) expect(quarterly.total.approved).toBe(193200);
    // Nobody has said what a donor funds: no grant figure is made up. The whole agreement is given alone.
    const book = await loadProjectState(projectId, DONOR_FUNDING_KEY, {});
    await saveProjectState(projectId, DONOR_FUNDING_KEY, {});
    try {
      const bare = (await donorPeriodReport(code, "annual-2026", elena))!.report;
      expect(bare.spend).toMatchObject({ budget: 346200, grant: null });
    } finally {
      await saveProjectState(projectId, DONOR_FUNDING_KEY, book);
    }
  });

  it("keeps what the donor received when the project changes afterwards", async () => {
    const before = (await donorPeriodReport(code, "annual-2026", elena))!.report;
    const [ind] = await db.select().from(s.indicators).where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.source, "results"), eq(s.indicators.inQuarterlyReport, true))).limit(1);
    await db.update(s.indicators).set({ target: String(Number(ind.target) * 3 + 1000), forecast: {}, name: `${ind.name} (renamed)` }).where(eq(s.indicators.id, ind.id));
    try {
      const live = await periodReport(code, { kind: "annual", year: 2026 });
      expect(live.rows.find((r) => r.code === ind.code)!.name).toBe(`${ind.name} (renamed)`);
      const after = (await donorPeriodReport(code, "annual-2026", elena))!.report;
      expect(after).toEqual(before);
      expect(after.rows.find((r) => r.code === ind.code)!.name).toBe(ind.name);
      // Staff see the frozen copy too, with who released it.
      const res = await GET(new Request(url("kind=annual&year=2026"), { headers: { "x-demo-user": "nadia" } }), ctx);
      const v = (await res.json()) as { rows: { code: string; name: string }[]; released: { by: string } | null };
      expect(v.released?.by).toBe("marcus");
      expect(v.rows.find((r) => r.code === ind.code)!.name).toBe(ind.name);
    } finally {
      await db.update(s.indicators).set({ target: ind.target, forecast: ind.forecast, name: ind.name }).where(eq(s.indicators.id, ind.id));
    }
  });

  it("releases the final report the same way, with no report check to pass", async () => {
    expect((await release("nadia", "kind=final")).status).toBe(403);
    expect((await release("marcus", "kind=final")).status).toBe(200);
    expect((await donorView(code, elena)).periods.map((p) => p.slug).sort()).toEqual(["annual-2026", "final"]);
  });
});
