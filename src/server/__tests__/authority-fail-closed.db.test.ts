import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));
vi.mock("@/server/hr-store", async (orig) => ({ ...(await orig<typeof import("@/server/hr-store")>()), loadHr: () => Promise.reject(new Error("read failed")) }));

import { loadProcurementContext } from "@/server/procurement-guard";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";

/** Code review of round 2: an authority table that cannot be read stops a procurement save, never lets anyone sign. */
describe("the approval rules cannot be read", { timeout: 60_000 }, () => {
  it("the procurement check refuses rather than running on an empty table", async () => {
    await ready;
    await seedDatabase();
    await expect(loadProcurementContext("A-2027", null, [])).rejects.toThrow(/approval rules could not be read/);
  });
});
