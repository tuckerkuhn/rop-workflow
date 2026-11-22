import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { seedDatabase } from "@/server/demo-seed";
import { endTrial, planDetails, startTrial } from "@/server/plans";
import { ready } from "@/server/__tests__/test-db";

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("giving every organization a trial", { timeout: 60_000 }, () => {
  it("puts them on the paid plan's features until the end date, and ending it puts them back", async () => {
    expect((await planDetails(null)).plan).toBe("free");
    const given = await startTrial(2, { all: true }, new Date("2026-11-21T20:00:00Z"));
    expect(given.length).toBeGreaterThan(0);
    expect(given.every((o) => o.until === "2027-01-21T20:00:00.000Z")).toBe(true);
    const d = await planDetails(null);
    expect(d.plan).toBe("paid");
    expect(d.trialEndsAt).toBe("2027-01-21T20:00:00.000Z");
    // A shorter trial given later keeps the longer one.
    await startTrial(1, { all: true }, new Date("2026-11-21T20:00:00Z"));
    expect((await planDetails(null)).trialEndsAt).toBe("2027-01-21T20:00:00.000Z");
    await endTrial({ all: true });
    expect(await planDetails(null)).toEqual({ plan: "free", trialEndsAt: null });
  });
});
