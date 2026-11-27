import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/server/field-store", () => ({ projectByCode: async () => ({}) }));

import { nextProcurementIdFrom, procurementIdOf } from "@/server/procurement-store";

/** Review round 1, ISS-11: A-2027 and the test bench each had a PR-2026-003. */
describe("a purchase number is one of a kind across the organization", () => {
  it("takes the next number after the highest used that year, on any project", () => {
    // PR-2026-003 is on another project; the next one here is 004, not a second 003.
    expect(nextProcurementIdFrom(["PR-2026-001", "PR-2026-002", "PR-2026-003", "PR-2027-016"], "2026")).toBe("PR-2026-004");
    expect(nextProcurementIdFrom(["PR-2026-001", "PR-2027-016"], "2027")).toBe("PR-2027-017");
  });
  it("starts at 001 in a year with none, and ignores numbers of another shape", () => {
    expect(nextProcurementIdFrom([], "2028")).toBe("PR-2028-001");
    expect(nextProcurementIdFrom(["UP-009", "PR-2028-01A", "XPR-2028-044"], "2028")).toBe("PR-2028-001");
    expect(procurementIdOf("2028", 1234)).toBe("PR-2028-1234");
  });
});
