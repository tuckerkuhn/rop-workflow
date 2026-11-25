import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { loadObligations } from "@/server/obligations-store";
import { preflight } from "@/server/preflight";
import { qprData } from "@/server/qpr-store";

/**
 * The demo's 2026 Q4 quarterly report, as a walk-through found it: narrative sections only for
 * workplan activities, the income survey not yet due plus a deadline from the donors' obligations.
 */
const code = "A-2027";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T12:00:00Z"), shouldAdvanceTime: true });
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
});

describe("the demo quarterly report for 2026 Q4", { timeout: 60_000 }, () => {
  it("has narrative sections only for workplan activities, with their titles", async () => {
    const d = await qprData(code, "2026-Q4");
    const codes = d.activities.map((a) => a.code);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => /^\d+\.\d+\.\d+$/.test(c))).toBe(true);
    expect(codes).not.toContain("1.a");
    expect(codes).not.toContain("IND");
    expect(d.activities.every((a) => a.name && a.name !== `Activity ${a.code}`)).toBe(true);
    // Outcome targets stay in the progress table.
    expect(d.rows.map((r) => r.code)).toEqual(expect.arrayContaining(["IND-3", "IND-5"]));
  });

  it("shows the income survey as not yet measured; pre-flight does not ask for its result", async () => {
    const d = await qprData(code, "2026-Q4");
    const income = d.rows.find((r) => r.code === "IND-5")!;
    expect(income.status).toBe("on_track");
    expect(income.comment).toBe("On track. Measured by the end-of-season survey; no survey result yet.");
    const p = await preflight(code, { kind: "qpr", quarter: "2026-Q4" });
    expect(p.items.some((i) => i.key === "pf.c.noResult" && i.vars?.code === income.donorCode)).toBe(false);
  });

  it("has the donors' obligations, so the report has a deadline", async () => {
    const project = await projectByCode(code);
    expect((await loadObligations(project.id)).map((o) => o.frequency)).toEqual(["quarterly", "annual"]);
    const p = await preflight(code, { kind: "qpr", quarter: "2026-Q4" });
    expect(p.deadline.due).toBe("2027-01-30");
  });
});
