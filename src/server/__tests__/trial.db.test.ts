import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { seedDatabase } from "@/server/demo-seed";
import { trialEnd } from "@/lib/plans";
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
    // From today, whatever day the tests run: a trial that already ended would leave the plan free.
    const now = new Date();
    const until = trialEnd(now, 2).toISOString();
    const given = await startTrial(2, { all: true }, now);
    expect(given.length).toBeGreaterThan(0);
    expect(given.every((o) => o.until === until)).toBe(true);
    const d = await planDetails(null);
    expect(d.plan).toBe("paid");
    expect(d.trialEndsAt).toBe(until);
    // A shorter trial given later keeps the longer one.
    await startTrial(1, { all: true }, now);
    expect((await planDetails(null)).trialEndsAt).toBe(until);
    await endTrial({ all: true });
    expect(await planDetails(null)).toEqual({ plan: "free", trialEndsAt: null });
  });
});
