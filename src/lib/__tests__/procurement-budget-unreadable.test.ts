import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/server/policy-store", () => ({ projectRules: async () => ({ lines: [] }) }));
vi.mock("@/server/hr-store", () => ({ loadHr: async () => null }));
vi.mock("@/server/suppliers-store", () => ({ loadSuppliers: async () => null }));
vi.mock("@/server/solo", () => ({ soloFor: async () => ({ on: false, blocked: null }) }));
vi.mock("@/server/plan-store", () => ({ loadBudget: async () => Promise.reject(new Error("connection lost")) }));
vi.mock("@/server/procurement-plan-store", () => ({ loadPlan: async () => [], lineMoneyOf: () => [] }));

import { loadProcurementContext } from "@/server/procurement-guard";
import { HttpError } from "@/server/guard";

/** Code review of ISS-07: a budget that cannot be read stops the save instead of letting the money checks pass. */
describe("a purchase save when the budget cannot be read", () => {
  it("is refused with a plain reason on a real project", async () => {
    const err = await loadProcurementContext("SFTP-2026", "org", []).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect((err as HttpError).message).toContain("budget could not be read");
  });
});
