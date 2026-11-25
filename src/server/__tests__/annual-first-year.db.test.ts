import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { seedDatabase } from "@/server/demo-seed";
import { preflight } from "@/server/preflight";
import { ready } from "@/server/__tests__/test-db";

/**
 * The demo project began on 1 October 2026. Its annual report for 2026 waits only for the
 * quarterly reports of quarters the project ran in: the three quarters before it began have no
 * report, and used to block the annual report for good.
 */
const code = "A-2027";
const waitsFor = async () => (await preflight(code, { kind: "annual", year: 2026 })).items.filter((i) => i.key === "pf.c.quarterOpen").map((i) => ({ group: i.group, q: i.vars?.q }));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T12:00:00Z"), shouldAdvanceTime: true });
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);
afterAll(() => vi.useRealTimers());

describe("the annual report of a project's first year", { timeout: 60_000 }, () => {
  it("is not held back by quarters that ended before the project began", async () => {
    expect(await waitsFor()).toEqual([]);
  });

  it("waits for the report of the quarter the project began in, once that quarter has ended", async () => {
    vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
    expect(await waitsFor()).toEqual([{ group: "blocks", q: "2026 Q4" }]);
  });
});
