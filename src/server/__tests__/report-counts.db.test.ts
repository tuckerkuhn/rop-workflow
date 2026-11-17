import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { loadHome } from "@/server/home-store";
import { nextReport, reportQuarter } from "@/server/next-report";
import { reportDeadline } from "@/server/preflight";
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
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("counts of what blocks the next report", { timeout: 60_000 }, () => {
  it("are the same on the Progress summary as in pre-flight", async () => {
    const nr = await nextReport(code);
    expect(nr.blocking).toBeGreaterThan(0);
    const concern = (await loadProgressSummary(code, nadia)).concerns.find((c) => c.key === "stops");
    expect(concern?.text).toBe(`${nr.blocking} ${nr.blocking === 1 ? "thing blocks" : "things block"} the ${nr.quarter.replace("-", " ")} report`);
    expect(concern?.href).toMatch(/preflight/);
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
});
