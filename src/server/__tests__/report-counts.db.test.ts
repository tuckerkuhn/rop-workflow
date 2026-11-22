import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { loadHome } from "@/server/home-store";
import { nextReport, reportQuarter } from "@/server/next-report";
import { preflight, reportDeadline } from "@/server/preflight";
import { and, eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { periodReport } from "@/server/period-report-store";
import { addCopy, copyOf, qprData, rawQpr, saveQpr } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";
import { projectByCode } from "@/server/field-store";
import { loadProgressSummary } from "@/server/progress-summary-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * What stands between the next report and the donor is counted once, by pre-flight
 * (server/next-report). Home and the Progress summary repeat that count, never one of their own.
 */
const code = "A-2027";
const nadia = userById("nadia")!;
const omar = userById("omar")!;

beforeAll(async () => {
  // A fixed day in the demo's first quarter, so what blocks the next report never depends on when the tests run.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T12:00:00Z"), shouldAdvanceTime: true });
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  // The demo releases its last ended quarter when loaded (server/demo-report); these tests release their own.
  const { id } = await projectByCode("A-2027");
  await db.delete(s.projectState).where(and(eq(s.projectState.projectId, id), like(s.projectState.key, "qpr%")));
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("counts of what blocks the next report", { timeout: 60_000 }, () => {
  it("are the same on the Progress summary as in pre-flight", async () => {
    const nr = await nextReport(code);
    expect(nr.blocking).toBeGreaterThan(0);
    const concern = (await loadProgressSummary(code, nadia)).concerns.find((c) => c.key === "stops");
    expect(concern?.text).toBe(`${nr.blocking} ${nr.blocking === 1 ? "thing blocks" : "things block"} the ${nr.quarter.replace("-", " ")} report`);
    expect(concern?.href).toMatch(/\/progress\/report\?q=.*#checks$/);
  });

  it("are not counted separately by Home's data", async () => {
    const home = await loadHome(code, omar);
    expect(home.mel).not.toHaveProperty("stops");
    expect(home.mel).not.toHaveProperty("checks");
  });

  it("keep the quarter just ended as the next report until its donor date, then move on", async () => {
    // Early January: Q4's report is still being written, so it is "the next report", not Q1.
    expect(await reportQuarter(code, "2027-01-05")).toBe("2026-Q4");
    // Mid November: Q3's date has gone, so the next report is the quarter under way.
    expect(await reportQuarter(code, "2026-11-16")).toBe("2026-Q4");
    // Well past Q4's date (no quarterly deadline set: 60 days after the quarter), Q1 is next.
    expect(await reportQuarter(code, "2027-03-15")).toBe("2027-Q1");
  });

  it("do not take a monthly report's deadline as the quarterly one", async () => {
    const d = await reportDeadline(code, "2026-12-31", 60, "quarterlyReportDays");
    expect(d.source?.kind === "milestone" ? d.source.title : "").not.toMatch(/monthly/i);
  });

  it("name a figure changed after its quarter was released, on the annual report and its pre-flight", async () => {
    const r = (await loadResults(code)).find((x) => x.status === "accepted" && x.value > 0)!;
    const q = r.quarter;
    const project = await projectByCode(code);
    const d = await qprData(code, q);
    const saved = { ...((await rawQpr(project.id, q)) ?? d.saved), released: { by: "nadia", at: "2026-11-01T00:00:00Z" } };
    await saveQpr(code, q, saved);
    await addCopy(code, q, { kind: "release", by: "nadia", at: "2026-11-01T00:00:00Z", work: { minutes: 0, sittings: 0, first: null, last: null }, data: copyOf({ ...d, saved }) });
    const year = Number(q.slice(0, 4));
    expect((await periodReport(code, { kind: "annual", year })).changed).toEqual([]);

    // The record is corrected after release.
    const [row] = await db.select().from(s.evidence).where(eq(s.evidence.id, r.id));
    await db.update(s.evidence).set({ payload: { ...(row.payload as object), value: r.value + 5 } }).where(eq(s.evidence.id, r.id));
    const changed = (await periodReport(code, { kind: "annual", year })).changed;
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ code: r.indicator, quarter: q });
    expect(changed[0].now - changed[0].then).toBe(5);
    const pf = await preflight(code, { kind: "annual", year });
    expect(pf.items.some((i) => i.key === "pf.c.changedSince")).toBe(true);
  });
});
