import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("@/server/field-store", () => ({ projectByCode: async () => ({}) }));

import { nextProcurementIdFrom, procurementIdOf, projectTag } from "@/server/procurement-store";

/** Review round 1, ISS-11: A-2027 and the test bench each had a PR-2026-003. Numbered per project, with its code in the number (Tucker, 27 Nov). */
describe("a purchase number is one of a kind across the organization", () => {
  it("each project numbers its own, with its code in the number", () => {
    expect(projectTag("A-2027")).toBe("A2027");
    expect(nextProcurementIdFrom(["PR-A2027-001", "PR-A2027-002", "PR-SFTP2026-003", "PR-2027-016"], "A-2027")).toBe("PR-A2027-003");
    expect(nextProcurementIdFrom(["PR-A2027-001", "PR-SFTP2026-003"], "SFTP-2026")).toBe("PR-SFTP2026-004");
  });
  it("starts at 001, and ignores numbers of another shape", () => {
    expect(nextProcurementIdFrom([], "A-2027")).toBe("PR-A2027-001");
    expect(nextProcurementIdFrom(["UP-009", "PR-A2027-01A", "XPR-A2027-044", "PR-2027-009"], "A-2027")).toBe("PR-A2027-001");
    expect(procurementIdOf("A-2027", 1234)).toBe("PR-A2027-1234");
  });
});
