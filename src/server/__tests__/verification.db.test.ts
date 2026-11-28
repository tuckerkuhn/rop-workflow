import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { drawThisMonth, recordVisit, verificationView } from "@/server/verification-store";

/** MF-10: MEL draws this month's sample once; each visit is recorded by its assignee; the share visited is tracked. */
const code = "A-2027";
beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("the monthly verification sample", { timeout: 60_000 }, () => {
  it("is drawn once, assigned away from the collector, and its visits recorded by the assignee", async () => {
    await expect(drawThisMonth(code, userById("hamid")!)).rejects.toThrow(/MEL or the project manager/);
    const s = await drawThisMonth(code, userById("omar")!);
    expect(s.visits.length).toBeGreaterThanOrEqual(1);
    expect((await drawThisMonth(code, userById("nadia")!)).visits).toEqual(s.visits);
    const v = s.visits.find((x) => x.assignee)!;
    expect(v.assignee).not.toBe(v.collector);
    const someoneElse = ["omar", "nadia", "farida"].find((id) => id !== v.assignee)!;
    await expect(recordVisit(code, s.month, v.farmer, "confirmed", "Plot and package as recorded.", userById(someoneElse)!)).rejects.toThrow();
    await recordVisit(code, s.month, v.farmer, "confirmed", "Plot and package as recorded.", userById(v.assignee!)!);
    const view = await verificationView(code, userById("omar")!);
    expect(view.months[0].done).toBe(Math.round((1 / s.visits.length) * 100));
  });
});
