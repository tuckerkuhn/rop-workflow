import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { demoReportQuarter, lastEndedQuarter, seedDemoReport } from "@/server/demo-report";
import { donorReport, donorView } from "@/server/donor-view-store";
import { projectByCode } from "@/server/field-store";
import { loadCopies } from "@/server/qpr-store";
import { ready } from "@/server/__tests__/test-db";

/** The demo opens a donor's account on a released report and their own grant's spending (server/demo-report). */
const code = "A-2027";
const elena = userById("elena")!;
let projectId = "";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  projectId = (await projectByCode(code)).id;
}, 120_000);

describe("which quarter the demo releases", () => {
  it("is the last quarter that has ended, once the project has run through one", () => {
    expect(lastEndedQuarter("2027-01-10")).toBe("2026-Q4");
    expect(lastEndedQuarter("2026-11-20")).toBe("2026-Q3");
    expect(demoReportQuarter("2026-10-01", "2026-11-20")).toBeNull();
    expect(demoReportQuarter("2026-10-01", "2027-01-10")).toBe("2026-Q4");
    expect(demoReportQuarter(null, "2027-01-10")).toBeNull();
  });
});

describe("the demo donor's account", { timeout: 60_000 }, () => {
  it("before a quarter has ended: no report, nothing released", async () => {
    expect(await seedDemoReport(projectId, "2026-11-20")).toBeNull();
    expect((await loadCopies(code, "2026-Q3")).length).toBe(0);
  });

  it("on the morning of the demo: the 2026-Q4 report is released, with the grant's lines and its cost share", async () => {
    expect(await seedDemoReport(projectId, "2027-01-10")).toBe("2026-Q4");
    const v = await donorView(code, elena);
    // Loading the demo on a later day also releases that day's last ended quarter.
    expect(v.reports.map((r) => r.quarter)).toContain("2026-Q4");
    expect(v.money).not.toBeNull();
    const funded = v.money!.funded.lines.map((l) => l.code);
    expect(funded).toContain("2.1");
    expect(funded).not.toContain("1.1");
    expect(funded).not.toContain("5.1");
    expect(v.money!.share?.lines.map((l) => l.code)).toEqual(["1.1", "1.2"]);
    const report = await donorReport(code, "2026-Q4", elena);
    expect(report).not.toBeNull();
  });
});
