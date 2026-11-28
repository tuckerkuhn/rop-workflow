import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { perUsd, registerRates } from "@/lib/fx";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { loadFx, ratesNow, recordRate } from "@/server/fx-store";

/** MF-11: finance records the month's rate; everything in that month uses it. */
const month = new Date().toISOString().slice(0, 7);
beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("monthly exchange rates", { timeout: 60_000 }, () => {
  it("finance records a month's rate, replaces it with a reason kept in the log, and every reader uses it", async () => {
    await expect(recordRate({ currency: "AFN", month, perUsd: 68, source: "Central bank" }, userById("farida")!)).rejects.toThrow(/Only finance/);
    await recordRate({ currency: "AFN", month, perUsd: 68, source: "Da Afghanistan Bank, first working day" }, userById("yusuf")!);
    await recordRate({ currency: "AFN", month, perUsd: 68.5, source: "Da Afghanistan Bank, corrected" }, userById("yusuf")!);
    await recordRate({ currency: "GTQ", month, perUsd: 7.7, source: "Banco de Guatemala" }, userById("yusuf")!);
    expect((await loadFx()).rates.filter((r) => r.month === month)).toHaveLength(2);
    registerRates([]);
    await ratesNow();
    expect(perUsd("AFN")).toBe(68.5);
    expect(perUsd("GTQ")).toBe(7.7);
  });
});
